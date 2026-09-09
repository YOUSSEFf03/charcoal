/**
 * Provider-agnostic contract for machine translation.
 *
 * TranslationService depends only on this interface — never on a concrete
 * provider class — so swapping the translation engine, or pointing at a
 * different instance, never touches TranslationController or any future
 * caller. Mirrors ContainerTrackingProvider in
 * ../containers/tracking/container-tracking.provider.ts, the established
 * pattern in this codebase for a "our backend calls one external HTTP API"
 * integration. See GoogleTranslateProvider for the current implementation
 * (Google Cloud Translation, v3 Advanced) — LibreTranslateProvider was the
 * previous implementation, removed 2026-08-28.
 */

export interface SupportedLanguage {
  code: string;
  name: string;
  /** Target language codes this language can be translated into. */
  targets: string[];
}

export interface TranslationResult {
  translatedText: string;
}

/**
 * Discriminates provider failures into the business-friendly buckets
 * TranslationService maps to user-facing messages. Never carries the
 * provider's raw response body or stack — those stay server-side (logged,
 * never persisted, never returned to the frontend).
 */
export type TranslationErrorKind =
  | 'network_error'
  // A real LibreTranslate 400 — invalid/unsupported source or target
  // language, or the text exceeded LT_CHAR_LIMIT. Distinct from
  // invalid_response (which means LibreTranslate's response to US was
  // unparsable): this is a permanent, actionable problem with OUR request,
  // not a transient provider issue.
  | 'bad_request'
  | 'rate_limited'
  | 'forbidden'
  | 'invalid_response'
  | 'upstream_error';

export class TranslationProviderError extends Error {
  constructor(
    public readonly kind: TranslationErrorKind,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TranslationProviderError';
  }
}

/** DI token — bind the active provider implementation to this in the module. */
export const TRANSLATION_PROVIDER = Symbol('TRANSLATION_PROVIDER');

export interface TranslationProvider {
  /** Throws TranslationProviderError on any failure. */
  translate(text: string, source: string, target: string): Promise<TranslationResult>;

  /** The languages (and valid target pairs) this instance currently supports. */
  listLanguages(): Promise<SupportedLanguage[]>;
}
