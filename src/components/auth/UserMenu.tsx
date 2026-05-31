import { useAuth, useUser, useClerk } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  accountant: 'Accountant',
  sales_rep: 'Sales rep',
  worker: 'Worker',
  driver: 'Driver',
}

/**
 * UserMenu — shows the signed-in user's name + role badge and a sign-out button.
 * Role is read from the Clerk session token claim `sessionClaims.metadata.role`.
 * Rendered in the Topbar's right slot so it appears on every layout page.
 */
export default function UserMenu() {
  const { user, isLoaded } = useUser()
  const { sessionClaims } = useAuth()
  const { signOut } = useClerk()
  const navigate = useNavigate()

  if (!isLoaded || !user) return null

  const role = (sessionClaims as any)?.metadata?.role as string | undefined
  const name = user.fullName || user.primaryEmailAddress?.emailAddress || 'User'

  async function handleSignOut() {
    await signOut()
    navigate('/sign-in', { replace: true })
  }

  return (
    <div className="user-menu">
      <span className="user-menu-name">{name}</span>
      {role && <span className="user-menu-role">{ROLE_LABELS[role] ?? role}</span>}
      <button className="btn" onClick={handleSignOut} title="Sign out">
        <i className="ti ti-logout" style={{ fontSize: 15 }} />
      </button>
    </div>
  )
}
