import { useQuery } from '@tanstack/react-query';
import { getContainer, getContainerEvents } from '../api/mobileContainerTracking';

export function useContainerDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['container', id],
    queryFn: () => getContainer(id as string),
    enabled: !!id,
  });
}

/** Events are backend-ordered oldest-first; reverse for a newest-first timeline if desired at the call site. */
export function useTrackingEvents(id: string | undefined) {
  return useQuery({
    queryKey: ['container', id, 'events'],
    queryFn: () => getContainerEvents(id as string),
    enabled: !!id,
  });
}
