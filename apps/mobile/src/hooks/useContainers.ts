import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { listContainers, type ListContainersParams } from '../api/mobileContainerTracking';

export function useContainers(params: ListContainersParams) {
  return useQuery({
    queryKey: ['containers', params],
    queryFn: () => listContainers(params),
    placeholderData: keepPreviousData,
  });
}
