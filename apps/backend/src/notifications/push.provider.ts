/**
 * Provider-agnostic contract for sending push notifications — mirrors
 * containers/tracking/container-tracking.provider.ts's shape exactly
 * (interface + DI token, never a concrete class referenced directly by
 * callers) for the same reason: ContainerNotificationService depends only on
 * this interface, so swapping/adding a push provider later never touches
 * that service, the Prisma schema, or anything mobile-facing.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Small, non-sensitive payload the mobile app can use for in-app navigation (e.g. { type: 'eta_changed', containerId }). Never rawResponse, never a credential. */
  data?: Record<string, string>;
}

export interface PushSendResult {
  token: string;
  status: 'ok' | 'error';
  /**
   * True only when the provider DEFINITIVELY reports this exact token as
   * invalid/unregistered (e.g. Expo's DeviceNotRegistered ticket error) —
   * the only case ContainerNotificationService will deactivate a device for.
   * False for every transient failure (network error, 5xx, rate limit,
   * malformed response) so a healthy device is never deactivated because of
   * a temporary provider hiccup.
   */
  invalidToken: boolean;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushProvider {
  /** Never throws for a per-token delivery failure — that's reported per-entry in the returned array. May reject only for a total request-level failure (network error, malformed provider response), which the caller treats as "no device could be confirmed sent to, none marked invalid." */
  send(tokens: string[], message: PushMessage): Promise<PushSendResult[]>;
}
