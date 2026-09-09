import type { ContainerStatus } from '../api/types';

/**
 * Business status labels and colors, copied verbatim from the web app's
 * STATUS_BADGE/STRIPE_COLOR maps (`src/pages/Containers.tsx`) so the two
 * apps agree on wording for the one person who uses both.
 */
export const STATUS_LABEL: Record<ContainerStatus, string> = {
  port: 'At port',
  transit: 'In transit',
  arrived: 'Arrived',
};

export const STATUS_COLOR: Record<ContainerStatus, string> = {
  port: '#B45309',
  transit: '#1D4ED8',
  arrived: '#15803D',
};

export const STATUS_STRIPE_COLOR: Record<ContainerStatus, string> = {
  port: '#F59E0B',
  transit: '#3B82F6',
  arrived: '#22C55E',
};

/** `origin → destination` (or whichever half is known), matching routeLine() on web. */
export function routeLine(
  tracking: { origin: string | null; destination: string | null } | null | undefined,
): string | null {
  if (!tracking) return null;
  if (tracking.origin && tracking.destination) return `${tracking.origin} → ${tracking.destination}`;
  return tracking.origin ?? tracking.destination ?? null;
}
