import { QueryClient } from '@tanstack/react-query'

// Shared React Query client. Imported by main.tsx and any code that needs to
// invalidate or prefetch queries (e.g. after a mutation).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  },
})
