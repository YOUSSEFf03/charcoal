// Single source for "our company" identity on generated documents (currently
// the Client Statement of Account PDF). Values mirror the existing company
// defaults already shown in Settings.tsx (src/pages/Settings.tsx) — that
// screen's Company section has no backend persistence yet (an accepted,
// deliberate no-op; see Settings.tsx), so these hardcoded defaults ARE the
// application's current authoritative company info. Update in both places
// together until Settings gains real persistence.
export const COMPANY_INFO = {
  name: 'Farah Charcoal',
  address: 'Beirut, Lebanon',
  phone: '+961 1 234 567',
  email: 'contact@farahcharcoal.lb',
}
