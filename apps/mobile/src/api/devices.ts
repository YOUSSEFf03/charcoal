import { api } from './client';
import type { RegisterDeviceRequest, RegisterDeviceResponse } from './types';

/**
 * POST /mobile/devices — register (or idempotently re-register) this
 * device's Expo push token. Never logs the token; the response never echoes
 * it back either (Phase C's device-registry deliberately omits it).
 */
export async function registerDevice(
  body: RegisterDeviceRequest,
): Promise<RegisterDeviceResponse> {
  const res = await api.post<RegisterDeviceResponse>('/mobile/devices', body);
  return res.data;
}
