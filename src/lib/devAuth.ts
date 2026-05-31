const KEY = '__dev_role'

export const DEV = import.meta.env.DEV

export function getDevRole(): string | null {
  if (!DEV) return null
  return sessionStorage.getItem(KEY)
}

export function setDevRole(role: string | null) {
  if (!DEV) return
  if (role) sessionStorage.setItem(KEY, role)
  else sessionStorage.removeItem(KEY)
}

export function devToken(): string | null {
  const role = getDevRole()
  return role ? `dev:${role}` : null
}
