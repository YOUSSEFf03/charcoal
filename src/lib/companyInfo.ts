// Single source for "our company" identity on generated documents (currently
// the Client Statement of Account PDF). Settings.tsx's Company section now
// has real backend persistence (GET/PUT /settings/company-info), but this
// PDF generator is a synchronous, non-hook utility and still uses these
// static defaults rather than fetching live data — update both places
// together if the saved company info changes, or wire buildStatementPdf()
// to fetch live data as a separate follow-up.
export const COMPANY_INFO = {
  name: 'Farah Charcoal',
  address: 'Beirut, Lebanon',
  phone: '+961 1 234 567',
  email: 'contact@farahcharcoal.lb',
}
