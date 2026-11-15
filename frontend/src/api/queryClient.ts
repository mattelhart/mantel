import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'

/** Polling is the fallback for a dead stream, and it lives in one timer
 * (`useLiveUpdates`) so a reconnect does not also leave every query on a 60s
 * loop. The default here stays off; weather sets its own interval. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 15_000,
      retry: (count, err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return false
        return count < 1
      },
    },
  },
})
