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

// Guard is checked twice:
//   1. Here — explicit, visible at the call-site boundary.
//   2. Inside getDevRole() via the module-level DEV constant.
// Vite replaces import.meta.env.DEV with the literal `false` in production
// builds, so this entire function compiles down to `return null` and is
// tree-shaken out. It can never send a dev token in a production build.
export function devToken(): string | null {
  if (!import.meta.env.DEV) return null
  const role = getDevRole()
  return role ? `dev:${role}` : null
}
