import { Injectable, Logger } from '@nestjs/common';
import {
  CarrierOption,
  ContainerTrackingProvider,
  NormalizedTracking,
  TraqoCredentials,
  TrackingProviderError,
} from './container-tracking.provider';
import { normalizeTraqoContainerResponse } from './traqo-response.normalizer';

/**
 * Traqo Ocean (https://traqocontainer.com) REST client — the only file in
 * this module aware of Traqo's URLs, headers, or response shape. Everything
 * else (ContainerTrackingService, ContainersController, the frontend) talks
 * to the ContainerTrackingProvider interface only.
 *
 * Reference: https://traqocontainer.com/developer (audited 2026-08-24).
 *   Base URL   https://traqocontainer.com/api/v1
 *   Auth       Authorization: Bearer <TRAQO_API_KEY>
 *   Endpoint   GET /container/:number?sealine=<4-char SCAC>  (sealine required)
 *   Errors     400 bad request / 401 invalid-or-missing key / 402 payment
 *              required (shipment_limit_reached | payment_overdue) / 403
 *              developer mode not enabled / 404 not found / 429 rate limit
 *              (Retry-After header) / 502 upstream carrier error.
 *
 * Multi-account (2026-08-26): this provider is stateless w.r.t. which Traqo
 * account is used — the caller (ContainerTrackingService, via
 * TraqoAccountAllocationService) resolves a specific account's credentials
 * per call. Nothing here ever stores or logs an API key value.
 *
 * Live investigation (2026-08-26, read-only, see the multi-account plan)
 * additionally confirmed:
 *   - GET /container/:number's top-level response already carries
 *     `is_active` (0/1) and `closed_at` (timestamp|null) — the confirmed
 *     shipment-lifecycle signal, now extracted by the normalizer.
 *   - `shipment_uid` is a public-share-link token, NOT the real shipment ID.
 *     The real ID (Frappe doc `name`, e.g. "SHP-76810") lives in nested rows
 *     (containers_table[0].parent / events_table[*].shipment_id).
 *   - GET /shipments and GET /shipments/:name (using that real name, not
 *     shipment_uid) both exist and work, but are not used by this provider —
 *     detection rides the existing GET /container/:number call only.
 */
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_BASE_URL = 'https://traqocontainer.com/api/v1';

@Injectable()
export class TraqoTrackingProvider implements ContainerTrackingProvider {
  private readonly logger = new Logger(TraqoTrackingProvider.name);

  async trackContainer(
    containerNumber: string,
    sealine: string,
    credentials: TraqoCredentials,
  ): Promise<NormalizedTracking> {
    const baseUrl = this.resolveBaseUrl(credentials.baseUrl);
    const url = `${baseUrl}/container/${encodeURIComponent(containerNumber)}?sealine=${encodeURIComponent(sealine)}`;
    const body = await this.request(url, credentials.apiKey);
    try {
      return normalizeTraqoContainerResponse(body, sealine);
    } catch (e) {
      this.logger.error(
        `Failed to normalize Traqo response for container ${containerNumber}`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new TrackingProviderError(
        'invalid_response',
        'Traqo returned an unrecognized response for this container.',
      );
    }
  }

  async listCarriers(credentials: TraqoCredentials, search?: string): Promise<CarrierOption[]> {
    const baseUrl = this.resolveBaseUrl(credentials.baseUrl);
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    const body = await this.request(`${baseUrl}/carriers${qs}`, credentials.apiKey);
    const list = Array.isArray(body)
      ? body
      : Array.isArray((body as any)?.carriers)
        ? (body as any).carriers
        : Array.isArray((body as any)?.data)
          ? (body as any).data
          : [];
    return list
      .map((c: any) => ({
        scac: typeof c?.scac === 'string' ? c.scac : '',
        name: typeof c?.name === 'string' ? c.name : '',
      }))
      .filter((c: CarrierOption) => c.scac && c.name);
  }

  private resolveBaseUrl(override?: string): string {
    return (override ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private async request(url: string, apiKey: string): Promise<unknown> {
    if (!apiKey) {
      throw new TrackingProviderError(
        'missing_api_key',
        'No Traqo API key is configured for this account.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    } catch (e) {
      this.logger.error(
        `Traqo request failed: ${url.replace(/sealine=.*/, 'sealine=***')}`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new TrackingProviderError(
        'network_error',
        'Could not reach the tracking service.',
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new TrackingProviderError(
          'invalid_response',
          'Tracking service returned a malformed response.',
        );
      }
    }

    // Never forward the raw provider body upward — log it server-side only.
    const rawBody = await response.text().catch(() => '');
    this.logger.warn(`Traqo ${response.status} response: ${rawBody.slice(0, 500)}`);

    switch (response.status) {
      case 401:
        throw new TrackingProviderError('unauthorized', 'Traqo API key was rejected.');
      case 402:
        throw new TrackingProviderError(
          'payment_required',
          'Traqo tracking limit or billing status has been reached.',
        );
      case 403:
        throw new TrackingProviderError(
          'forbidden',
          'Traqo developer access is not enabled for this account.',
        );
      case 404:
        throw new TrackingProviderError('not_found', 'No tracking information was found.');
      case 429: {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
        throw new TrackingProviderError(
          'rate_limited',
          'Traqo rate limit exceeded.',
          Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        );
      }
      case 400:
        throw new TrackingProviderError('bad_request', 'Traqo rejected the container number or carrier.');
      case 502:
        throw new TrackingProviderError('upstream_error', 'Traqo\'s upstream carrier data source is unavailable.');
      default:
        throw new TrackingProviderError(
          'upstream_error',
          `Traqo returned an unexpected error (${response.status}).`,
        );
    }
  }
}
