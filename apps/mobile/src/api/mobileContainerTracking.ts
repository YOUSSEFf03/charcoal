import { api } from './client';
import type {
  ContainerStatus,
  MobileContainer,
  MobileContainerListResponse,
  MobileTrackingEvent,
} from './types';

export interface ListContainersParams {
  page?: number;
  limit?: number;
  status?: ContainerStatus;
  search?: string;
}

/** GET /mobile/container-tracking — paginated list, matching Phase D's actual query support. */
export async function listContainers(
  params: ListContainersParams = {},
): Promise<MobileContainerListResponse> {
  const res = await api.get<MobileContainerListResponse>('/mobile/container-tracking', {
    params,
  });
  return res.data;
}

/** GET /mobile/container-tracking/:id — id is the container's UUID (also what push-notification payloads carry). */
export async function getContainer(id: string): Promise<MobileContainer> {
  const res = await api.get<MobileContainer>(`/mobile/container-tracking/${id}`);
  return res.data;
}

/**
 * GET /mobile/container-tracking/:id/events — ordered oldest-first by the
 * backend (`occurredAt: 'asc'`), the same convention the web app's tracking
 * view already relies on. Callers that want a "most recent first" timeline
 * must reverse this list themselves rather than assume ordering.
 */
export async function getContainerEvents(id: string): Promise<MobileTrackingEvent[]> {
  const res = await api.get<MobileTrackingEvent[]>(`/mobile/container-tracking/${id}/events`);
  return res.data;
}
