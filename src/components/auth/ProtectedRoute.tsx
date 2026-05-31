/**
 * ProtectedRoute — route guard for Clerk-authenticated pages.
 * ---------------------------------------------------------------------------
 * Role-checking logic:
 *
 *  1. `isLoaded` — Clerk resolves the session asynchronously. Until it is true
 *     we render a loading placeholder so we never flash a redirect (or protected
 *     content) before we actually know whether the user is signed in.
 *
 *  2. `isSignedIn` — once loaded, an unauthenticated visitor is sent to
 *     `/sign-in`. `replace` is used so the guarded URL does not pollute history
 *     (the back button won't bounce the user back into a redirect loop).
 *
 *  3. `allowedRoles` — optional. When omitted, ANY signed-in user may view the
 *     route. When provided, the user's role is read from the Clerk session
 *     token claim `sessionClaims.metadata.role` (populated from the Clerk user's
 *     publicMetadata.role via the session-token template configured in the Clerk
 *     dashboard). If that role is not in `allowedRoles`, the user is redirected
 *     to `/sign-in` rather than shown a page they are not permitted to see.
 *
 *  Role values mirror the backend Prisma `Role` enum:
 *  'owner' | 'accountant' | 'sales_rep' | 'worker' | 'driver'.
 */
import { ReactNode } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Navigate } from 'react-router-dom'
import { getDevRole, DEV } from '../../lib/devAuth'

export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: ReactNode
  allowedRoles?: string[]
}) {
  const { isLoaded, isSignedIn, sessionClaims } = useAuth()

  // Dev bypass — skip Clerk entirely in development when a dev role is set.
  if (DEV) {
    const devRole = getDevRole()
    if (devRole) {
      if (allowedRoles && !allowedRoles.includes(devRole)) {
        return <Navigate to="/sign-in" replace />
      }
      return <>{children}</>
    }
  }

  if (!isLoaded) return <div className="page-loading">Loading…</div>
  if (!isSignedIn) return <Navigate to="/sign-in" replace />

  const role = (sessionClaims as any)?.metadata?.role
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/sign-in" replace />
  }

  return <>{children}</>
}
