import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushMessage, PushProvider, PushSendResult } from './push.provider';

/**
 * Expo push notification REST client — the only file in this module aware
 * of Expo's URL, headers, or response shape. Everything else
 * (ContainerNotificationService, the mobile controller) talks to the
 * PushProvider interface only. Mirrors
 * containers/tracking/traqo-tracking.provider.ts's shape and its choice of
 * a raw `fetch()` call over pulling in a client SDK — the mobile app being
 * React Native + Expo (see the Phase 1 audit) makes Expo's push service the
 * natural fit, and its HTTP API is simple enough that a dependency isn't
 * needed to talk to it, exactly as Traqo's isn't.
 *
 * Reference: https://docs.expo.dev/push-notifications/sending-notifications/
 *   Endpoint  POST https://exp.host/--/api/v2/push/send
 *   Auth      Optional Bearer EXPO_ACCESS_TOKEN (enhanced security — not
 *             required for basic sends, so left optional here exactly like
 *             TRAQO_API_KEY is optional until tracking is actually used).
 *   Request   an array of { to, title, body, data }, one per token — a
 *             single POST can batch up to 100 messages.
 *   Response  { data: [{ status: 'ok' | 'error', message?, details?:
 *             { error?: 'DeviceNotRegistered' | 'MessageTooBig' | ... } }] }
 *             — one ticket per input message, in the SAME order.
 */
const REQUEST_TIMEOUT_MS = 15_000;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo batches at most 100 messages per request — send() chunks larger token lists. */
const MAX_BATCH_SIZE = 100;

interface ExpoTicket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class ExpoPushProvider implements PushProvider {
  private readonly logger = new Logger(ExpoPushProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async send(tokens: string[], message: PushMessage): Promise<PushSendResult[]> {
    if (tokens.length === 0) return [];

    const results: PushSendResult[] = [];
    for (let i = 0; i < tokens.length; i += MAX_BATCH_SIZE) {
      const batch = tokens.slice(i, i + MAX_BATCH_SIZE);
      results.push(...(await this.sendBatch(batch, message)));
    }
    return results;
  }

  private async sendBatch(tokens: string[], message: PushMessage): Promise<PushSendResult[]> {
    const accessToken = this.configService.get<string>('EXPO_ACCESS_TOKEN');
    const payload = tokens.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      // Network error / timeout — a total request-level failure. Never
      // deactivate any device for this: we have no per-token signal at all.
      this.logger.warn(`Expo push request failed: ${e instanceof Error ? e.message : String(e)}`);
      return tokens.map((token) => ({ token, status: 'error', invalidToken: false }));
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // Never log the response body — it could echo back request content.
      this.logger.warn(`Expo push API responded ${response.status}`);
      return tokens.map((token) => ({ token, status: 'error', invalidToken: false }));
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      this.logger.warn('Expo push API returned an unparsable response');
      return tokens.map((token) => ({ token, status: 'error', invalidToken: false }));
    }

    const tickets: ExpoTicket[] = Array.isArray((json as { data?: unknown })?.data)
      ? ((json as { data: ExpoTicket[] }).data)
      : [];

    return tokens.map((token, i) => {
      const ticket = tickets[i];
      const ok = ticket?.status === 'ok';
      const invalidToken = !ok && ticket?.details?.error === 'DeviceNotRegistered';
      if (!ok) {
        // Ticket-level detail only (a short error code) — never the full
        // ticket object, which could theoretically echo request data back.
        this.logger.warn(`Expo push ticket error for one device: ${ticket?.details?.error ?? ticket?.message ?? 'unknown'}`);
      }
      return { token, status: ok ? 'ok' : 'error', invalidToken };
    });
  }
}
