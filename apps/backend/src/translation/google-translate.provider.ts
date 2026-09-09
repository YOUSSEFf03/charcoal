import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranslationServiceClient } from '@google-cloud/translate';
import {
  SupportedLanguage,
  TranslationProvider,
  TranslationProviderError,
  TranslationResult,
} from './translation.provider';

/**
 * Google Cloud Translation (Advanced, v3) client — the only file in this
 * module aware of Google's request/response shape, auth, or error codes.
 * Everything else (TranslationService, TranslationController) talks to the
 * TranslationProvider interface only. Mirrors TraqoTrackingProvider
 * (../containers/tracking/traqo-tracking.provider.ts), this codebase's
 * existing template for a credentialed external HTTP API integration — same
 * 15s client-side timeout, same discriminated error-kind mapping, same
 * "never forward the raw provider error upward, log server-side only" rule.
 * Replaces LibreTranslateProvider (removed) — see translation.module.ts.
 *
 * Auth: uses Application Default Credentials (ADC) via the official
 * `@google-cloud/translate` client — this provider never reads, holds, or
 * logs a credential itself. `GOOGLE_APPLICATION_CREDENTIALS` (a service-
 * account JSON file path, for local dev) is read directly by the client
 * library from the environment; nothing here proxies it. On GCP-hosted
 * infrastructure (Cloud Run, GKE with Workload Identity, etc.) ADC resolves
 * automatically from the attached service account with no env var needed.
 *
 * Endpoint: POST https://translate.googleapis.com/v3/{parent}:translateText
 * (via TranslationServiceClient.translateText — see
 * https://cloud.google.com/translate/docs/reference/rest/v3/projects/translateText,
 * audited against the installed @google-cloud/translate v9 type defs,
 * 2026-08-28). `parent` is `projects/{GOOGLE_CLOUD_PROJECT_ID}/locations/global`
 * — "global" avoids requiring a specific regional endpoint, matching this
 * feature's actual need (no data-residency requirement here).
 */
const REQUEST_TIMEOUT_MS = 15_000;
const LOCATION = 'global';

// Standard gRPC status codes (google-gax's GoogleError.code) that
// translateText/getSupportedLanguages can realistically return.
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_DEADLINE_EXCEEDED = 4;
const GRPC_PERMISSION_DENIED = 7;
const GRPC_RESOURCE_EXHAUSTED = 8;
const GRPC_UNAVAILABLE = 14;
const GRPC_UNAUTHENTICATED = 16;

@Injectable()
export class GoogleTranslateProvider implements TranslationProvider {
  private readonly logger = new Logger(GoogleTranslateProvider.name);
  private client: TranslationServiceClient | undefined;

  constructor(private readonly configService: ConfigService) {}

  private get projectId(): string | undefined {
    return this.configService.get<string>('translation.googleCloudProjectId');
  }

  // Constructed lazily (not in the constructor) and reused across calls —
  // the client library manages its own connection pooling/credential
  // caching internally. Never constructed at all if projectId is unset, so
  // an unconfigured deployment never even attempts to resolve credentials.
  private getClient(): TranslationServiceClient {
    if (!this.client) {
      this.client = new TranslationServiceClient();
    }
    return this.client;
  }

  async translate(text: string, source: string, target: string): Promise<TranslationResult> {
    const projectId = this.requireProjectId();
    const client = this.getClient();

    let response;
    try {
      [response] = await client.translateText(
        {
          parent: `projects/${projectId}/locations/${LOCATION}`,
          contents: [text],
          mimeType: 'text/plain',
          // Omitted entirely (not just set to undefined) for "auto" — Google
          // auto-detects the source language when sourceLanguageCode is
          // absent from the request, same "auto" semantics TranslateDto
          // already documents for the previous LibreTranslate provider.
          ...(source !== 'auto' ? { sourceLanguageCode: source } : {}),
          targetLanguageCode: target,
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );
    } catch (e) {
      throw this.mapError(e, 'translateText');
    }

    const translatedText = response.translations?.[0]?.translatedText;
    if (typeof translatedText !== 'string' || translatedText.length === 0) {
      this.logger.error('Google Translate translateText response missing translatedText');
      throw new TranslationProviderError(
        'invalid_response',
        'Translation service returned an unrecognized response.',
      );
    }
    return { translatedText };
  }

  async listLanguages(): Promise<SupportedLanguage[]> {
    const projectId = this.requireProjectId();
    const client = this.getClient();

    let response;
    try {
      [response] = await client.getSupportedLanguages(
        { parent: `projects/${projectId}/locations/${LOCATION}`, displayLanguageCode: 'en' },
        { timeout: REQUEST_TIMEOUT_MS },
      );
    } catch (e) {
      throw this.mapError(e, 'getSupportedLanguages');
    }

    const languages = response.languages;
    if (!Array.isArray(languages)) {
      this.logger.error('Google Translate getSupportedLanguages response missing languages array');
      throw new TranslationProviderError(
        'invalid_response',
        'Translation service returned an unrecognized response.',
      );
    }

    const codes = languages
      .map((l) => l.languageCode)
      .filter((c): c is string => typeof c === 'string' && c.length > 0);

    // Unlike LibreTranslate (only en/ar models loaded, so `targets` was a
    // real per-language restriction), Google Cloud Translation supports
    // any-to-any translation among every language this endpoint returns —
    // it exposes no per-language target restriction here, so `targets` is
    // simply every other supported code.
    return languages
      .filter((l): l is typeof l & { languageCode: string } => typeof l.languageCode === 'string' && l.languageCode.length > 0)
      .map((l) => ({
        code: l.languageCode,
        name: l.displayName || l.languageCode,
        targets: codes.filter((c) => c !== l.languageCode),
      }));
  }

  /** Checked before any network call — an unconfigured deployment fails immediately, never attempts credential resolution. */
  private requireProjectId(): string {
    const projectId = this.projectId;
    if (!projectId) {
      throw new TranslationProviderError('forbidden', 'Translation is not configured.');
    }
    return projectId;
  }

  /**
   * Maps a Google client error (or any other thrown value — e.g. a plain
   * network exception from DNS/connect failure, which carries no `.code`)
   * to the existing TranslationErrorKind taxonomy. Never includes the
   * error's own `.message` in what's thrown upward — that can carry
   * project IDs, request details, or other Google-internal specifics; it is
   * logged server-side only, same rule LibreTranslateProvider and
   * TraqoTrackingProvider both already follow.
   *
   * One deliberate gap, live-verified: if GOOGLE_CLOUD_PROJECT_ID is set but
   * no credential is resolvable at all (no GOOGLE_APPLICATION_CREDENTIALS,
   * no ADC, not running on GCP infra), google-auth-library throws its own
   * plain Error client-side, before any RPC — no numeric `.code`, so this
   * falls into the `default: upstream_error` case below rather than
   * `forbidden`. Not special-cased: the only way to detect it would be
   * matching its fixed message string ("Could not load the default
   * credentials..."), which is exactly the kind of raw-provider-text
   * parsing this codebase's providers deliberately avoid. Harmless in
   * practice — HTTP_STATUS_BY_KIND and publicMessage() in
   * translation.service.ts already map `forbidden` and `upstream_error` to
   * the identical HTTP 502 and identical public message, so the caller
   * observes no difference either way. A real Google-side auth rejection
   * (an actual bad/expired/wrong-permission credential, gRPC code 16 or 7)
   * IS still correctly bucketed as `forbidden` below.
   */
  private mapError(e: unknown, op: string): TranslationProviderError {
    const code = typeof (e as { code?: unknown })?.code === 'number' ? (e as { code: number }).code : undefined;
    this.logger.error(`Google Translate ${op} failed (code=${code ?? 'n/a'})`, e instanceof Error ? e.stack : String(e));

    switch (code) {
      case GRPC_UNAUTHENTICATED:
      case GRPC_PERMISSION_DENIED:
        // Both collapse into the existing `forbidden` kind (as
        // LibreTranslateProvider's 403 already did) — from the caller's
        // perspective both mean "this deployment's credentials were
        // rejected," a permanent configuration problem, not something the
        // end user's request can fix by retrying.
        return new TranslationProviderError('forbidden', 'Translation service rejected the request.');
      case GRPC_INVALID_ARGUMENT:
        return new TranslationProviderError(
          'bad_request',
          'The translation request was rejected — check the language codes and text length.',
        );
      case GRPC_RESOURCE_EXHAUSTED:
        return new TranslationProviderError('rate_limited', 'Translation rate limit exceeded.');
      case GRPC_DEADLINE_EXCEEDED:
      case GRPC_UNAVAILABLE:
        // Transient — matches LibreTranslateProvider's own network_error
        // for both "container unreachable" and its AbortController timeout.
        return new TranslationProviderError('network_error', 'Could not reach the translation service.');
      default:
        return new TranslationProviderError(
          'upstream_error',
          'Translation service returned an unexpected error.',
        );
    }
  }
}
