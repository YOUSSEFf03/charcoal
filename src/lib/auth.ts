import { useAuth } from '@clerk/clerk-react'
import { useEffect } from 'react'

// Bridges Clerk's React-only useAuth() into the plain Axios instance in api.ts.
// api.ts runs outside React, so it cannot call hooks. Instead we publish the
// token getter onto window.__clerk_token here, and the request interceptor reads it.
// Mount this hook once, high in the tree (inside ClerkProvider). See App / main.tsx.
export function useTokenSync() {
  const { getToken } = useAuth()
  useEffect(() => {
    window.__clerk_token = () => getToken()
  }, [getToken])
}
