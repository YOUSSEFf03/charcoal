// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Coverage for the "Traqo accounts" section added to Settings (multi-account
// container tracking admin panel). All data hooks are mocked directly so
// these tests never depend on a real backend/network layer. Every other
// hook Settings.tsx calls unconditionally must still be mocked even though
// most tests here only exercise the 'traqo' section.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title }: { title?: string }) => <div>{title}</div>,
}))

const mockUseUsers = vi.fn()
const mockUseTraqoAccounts = vi.fn()
const mockUpdateTraqoAccountMutate = vi.fn()
const mockUseUpdateTraqoAccount = vi.fn(() => ({ mutate: mockUpdateTraqoAccountMutate, isPending: false }))

vi.mock('../hooks/useUsers', () => ({
  useUsers: (...args: unknown[]) => mockUseUsers(...args),
  useUpdateUserRole: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUserName: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateLocalUser: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLocalUser: () => ({ mutate: vi.fn(), isPending: false }),
}))

// Stable references: Settings.tsx has a useEffect keyed on bagTypesQ.data —
// a mock that returns a fresh `[]` literal on every call would make that
// dependency referentially unequal every render, causing an infinite
// render loop (this really happened during development — heap OOM).
const EMPTY_BAG_TYPES: unknown[] = []
const EMPTY_ACCOUNTS: unknown[] = []

vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => ({ data: EMPTY_BAG_TYPES, isLoading: false }),
  useCreateBagType: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBagType: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteBagType: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useReceivers', () => ({
  useReceivers: () => ({ receivers: [], add: vi.fn(), remove: vi.fn(), update: vi.fn(), isLoading: false }),
}))

vi.mock('../context/RateContext', () => ({
  useRate: () => ({ rate: '89,550', rawRate: 89550, setRate: vi.fn(), isSaving: false }),
}))

// Same stable-reference requirement as EMPTY_BAG_TYPES above — Settings.tsx
// has a useEffect keyed on companyInfoQ.data.
const STABLE_COMPANY_INFO = { name: '', phone: '', address: '', addressAr: '', taxNo: '', email: '', footer: '' }
const mockUseCompanyInfo = vi.fn(() => ({ data: STABLE_COMPANY_INFO, isLoading: false }))
const mockUpdateCompanyInfoMutate = vi.fn()
const mockUseUpdateCompanyInfo = vi.fn(() => ({ mutate: mockUpdateCompanyInfoMutate, isPending: false }))
const mockUseDailyWageRate = vi.fn(() => ({ data: 0, isLoading: false }))
const mockSetDailyWageMutate = vi.fn()
const mockUseSetDailyWageRate = vi.fn(() => ({ mutate: mockSetDailyWageMutate, isPending: false }))

vi.mock('../hooks/useSettings', () => ({
  useCompanyInfo: () => mockUseCompanyInfo(),
  useUpdateCompanyInfo: () => mockUseUpdateCompanyInfo(),
  useDailyWageRate: () => mockUseDailyWageRate(),
  useSetDailyWageRate: () => mockUseSetDailyWageRate(),
}))

vi.mock('../hooks/useTraqoAccounts', () => ({
  useTraqoAccounts: (...args: unknown[]) => mockUseTraqoAccounts(...args),
  useUpdateTraqoAccount: () => mockUseUpdateTraqoAccount(),
}))

const EMPTY_DEVICES: unknown[] = []
const mockUseMobileDevices = vi.fn()
const mockRevokeMobileDeviceMutate = vi.fn()
const mockUseRevokeMobileDevice = vi.fn(() => ({ mutate: mockRevokeMobileDeviceMutate, isPending: false }))

vi.mock('../hooks/useMobileDevices', () => ({
  useMobileDevices: (...args: unknown[]) => mockUseMobileDevices(...args),
  useRevokeMobileDevice: () => mockUseRevokeMobileDevice(),
}))

import Settings from './Settings'

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  )
}

const ACCOUNTS = [
  { id: 'a1', name: 'Traqo Account 1', envKeyName: 'TRAQO_API_KEY_1', keyConfigured: true, active: true, status: 'healthy', priority: 1, maxContainers: 4, activeContainers: 4, unavailableUntil: null, lastFailureAt: null, lastFailureKind: null },
  { id: 'a2', name: 'Traqo Account 2', envKeyName: 'TRAQO_API_KEY_2', keyConfigured: true, active: true, status: 'healthy', priority: 2, maxContainers: 4, activeContainers: 2, unavailableUntil: null, lastFailureAt: null, lastFailureKind: null },
  { id: 'a3', name: 'Traqo Account 3', envKeyName: 'TRAQO_API_KEY_3', keyConfigured: false, active: true, status: 'healthy', priority: 3, maxContainers: 4, activeContainers: 0, unavailableUntil: null, lastFailureAt: null, lastFailureKind: null },
]

describe('Settings — Traqo accounts section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUsers.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false } as any)
    mockUseUpdateTraqoAccount.mockReturnValue({ mutate: mockUpdateTraqoAccountMutate, isPending: false } as any)
  })

  it('lists nav entry "Traqo accounts" under Settings', () => {
    mockUseTraqoAccounts.mockReturnValue({ data: EMPTY_ACCOUNTS, isLoading: false, isSuccess: true } as any)
    renderSettings()
    expect(screen.getByText('Traqo accounts')).toBeInTheDocument()
  })

  it('shows each account with usage (X / 4) and status — never a key value', async () => {
    mockUseTraqoAccounts.mockReturnValue({ data: ACCOUNTS, isLoading: false, isSuccess: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Traqo accounts'))

    expect(screen.getByText('Traqo Account 1')).toBeInTheDocument()
    expect(screen.getByText(/Active containers: 4 \/ 4/)).toBeInTheDocument()
    expect(screen.getByText(/Active containers: 2 \/ 4/)).toBeInTheDocument()
    expect(screen.getByText(/Active containers: 0 \/ 4/)).toBeInTheDocument()
    expect(screen.getAllByText('Healthy').length).toBe(3)
    expect(screen.getByText('No key configured')).toBeInTheDocument() // account 3 only

    // Never renders a raw key anywhere on the page.
    expect(document.body.textContent).not.toMatch(/sk_|TRAQO_API_KEY_1=/)
  })

  it('shows a non-healthy account status distinctly (e.g. auth_failed)', async () => {
    mockUseTraqoAccounts.mockReturnValue({
      data: [{ ...ACCOUNTS[0], status: 'auth_failed' }],
      isLoading: false,
      isSuccess: true,
    } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Traqo accounts'))
    expect(screen.getByText('Auth failed')).toBeInTheDocument()
  })

  it('toggling the switch calls useUpdateTraqoAccount with the flipped active value', async () => {
    mockUseTraqoAccounts.mockReturnValue({ data: [ACCOUNTS[0]], isLoading: false, isSuccess: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Traqo accounts'))

    const toggle = screen.getByTitle('Enabled — click to disable')
    await userEvent.click(toggle)

    expect(mockUpdateTraqoAccountMutate).toHaveBeenCalledWith(
      { id: 'a1', active: false },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('shows an empty state when no accounts are configured', async () => {
    mockUseTraqoAccounts.mockReturnValue({ data: EMPTY_ACCOUNTS, isLoading: false, isSuccess: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Traqo accounts'))
    expect(screen.getByText('No Traqo accounts configured yet.')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Coverage for the "Container Mobile App" section (Phase F — device
// list/revoke admin panel for the Phase C mobile app). Mirrors the Traqo
// accounts test block above: mocked hooks, no real backend.
// ---------------------------------------------------------------------------
const DEVICES = [
  { id: 'd1', platform: 'ios', appVersion: '1.0.0', active: true, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-09-05T00:00:00.000Z' },
  { id: 'd2', platform: 'android', appVersion: '1.2.0', active: false, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z', lastSeenAt: '2026-08-25T00:00:00.000Z' },
]

describe('Settings — Container Mobile App section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUsers.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false } as any)
    mockUseTraqoAccounts.mockReturnValue({ data: EMPTY_ACCOUNTS, isLoading: false, isSuccess: true } as any)
    mockUseRevokeMobileDevice.mockReturnValue({ mutate: mockRevokeMobileDeviceMutate, isPending: false } as any)
  })

  it('lists nav entry "Container Mobile App" under Settings', () => {
    mockUseMobileDevices.mockReturnValue({ data: EMPTY_DEVICES, isLoading: false, isSuccess: true } as any)
    renderSettings()
    expect(screen.getByText('Container Mobile App')).toBeInTheDocument()
  })

  it('shows each device with platform, version, registration/last-seen dates, and active/revoked status — never a token', async () => {
    mockUseMobileDevices.mockReturnValue({ data: DEVICES, isLoading: false, isSuccess: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Container Mobile App'))

    expect(screen.getByText(/iOS · v1\.0\.0/)).toBeInTheDocument()
    expect(screen.getByText(/Android · v1\.2\.0/)).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    // "Revoked" appears twice for an inactive device (status badge + disabled button label).
    expect(screen.getAllByText('Revoked').length).toBeGreaterThanOrEqual(2)

    // Never renders a push token anywhere on the page.
    expect(document.body.textContent).not.toMatch(/ExponentPushToken|ExpoPushToken/)
  })

  it('shows an empty state when no devices have registered', async () => {
    mockUseMobileDevices.mockReturnValue({ data: EMPTY_DEVICES, isLoading: false, isSuccess: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Container Mobile App'))
    expect(screen.getByText(/No devices have registered yet/)).toBeInTheDocument()
  })

  it('shows an error state when the device list fails to load', async () => {
    mockUseMobileDevices.mockReturnValue({ data: undefined, isLoading: false, isError: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Container Mobile App'))
    expect(screen.getByText(/Couldn't load devices/)).toBeInTheDocument()
  })

  it('clicking Revoke opens a confirmation dialog explaining the real scope (push-only, not API access)', async () => {
    mockUseMobileDevices.mockReturnValue({ data: [DEVICES[0]], isLoading: false, isSuccess: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Container Mobile App'))
    await userEvent.click(screen.getByRole('button', { name: /^Revoke$/ }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    // "not" sits inside its own <strong>, splitting the sentence across text
    // nodes — check the rendered text as a whole rather than a single node.
    expect(document.body.textContent).toMatch(/It does not block the device from reading container data/)
    expect(mockRevokeMobileDeviceMutate).not.toHaveBeenCalled()
  })

  it('confirming revoke calls the mutation with the device id', async () => {
    mockUseMobileDevices.mockReturnValue({ data: [DEVICES[0]], isLoading: false, isSuccess: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Container Mobile App'))
    await userEvent.click(screen.getByRole('button', { name: /^Revoke$/ }))
    await userEvent.click(screen.getByRole('button', { name: /Revoke device/ }))

    expect(mockRevokeMobileDeviceMutate).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('the confirm button is disabled while the revoke mutation is pending (prevents double submission)', async () => {
    mockUseMobileDevices.mockReturnValue({ data: [DEVICES[0]], isLoading: false, isSuccess: true } as any)
    mockUseRevokeMobileDevice.mockReturnValue({ mutate: mockRevokeMobileDeviceMutate, isPending: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Container Mobile App'))
    await userEvent.click(screen.getByRole('button', { name: /^Revoke$/ }))

    expect(screen.getByRole('button', { name: /Revoking…/ })).toBeDisabled()
  })

  it('an already-revoked device has no active Revoke button', async () => {
    mockUseMobileDevices.mockReturnValue({ data: [DEVICES[1]], isLoading: false, isSuccess: true } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Container Mobile App'))
    expect(screen.getByRole('button', { name: /^Revoked$/ })).toBeDisabled()
  })
})

describe('Settings — Company info section (real backend persistence)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUsers.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false } as any)
    mockUseTraqoAccounts.mockReturnValue({ data: EMPTY_ACCOUNTS, isLoading: false, isSuccess: true } as any)
    mockUseCompanyInfo.mockReturnValue({ data: STABLE_COMPANY_INFO, isLoading: false } as any)
    mockUseUpdateCompanyInfo.mockReturnValue({ mutate: mockUpdateCompanyInfoMutate, isPending: false } as any)
  })

  it('loads saved company info into the form fields (Company info is the default section)', () => {
    const saved = { name: 'Farah Charcoal', phone: '+961 1 234 567', address: 'Beirut, Lebanon', addressAr: '', taxNo: 'LB-123', email: 'a@b.com', footer: 'Thank you' }
    mockUseCompanyInfo.mockReturnValue({ data: saved, isLoading: false } as any)
    renderSettings()

    expect(screen.getByDisplayValue('Farah Charcoal')).toBeInTheDocument()
    expect(screen.getByDisplayValue('+961 1 234 567')).toBeInTheDocument()
    expect(screen.getByDisplayValue('LB-123')).toBeInTheDocument()
  })

  it('clicking "Save changes" calls the real update mutation with the edited values', async () => {
    renderSettings()

    // "Company name" is the first text input in the Company info form —
    // the label isn't a real <label for> association, so query by order.
    const nameInput = screen.getAllByRole('textbox')[0]
    await userEvent.type(nameInput, 'Farah Charcoal')
    await userEvent.click(screen.getByText('Save changes'))

    expect(mockUpdateCompanyInfoMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Farah Charcoal' }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('never shows the old "not saved by the backend" message', () => {
    renderSettings()
    expect(screen.queryByText(/isn.t stored by the backend/)).not.toBeInTheDocument()
  })
})

describe('Settings — Employee wages section (global daily-wage amount)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUsers.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false } as any)
    mockUseTraqoAccounts.mockReturnValue({ data: EMPTY_ACCOUNTS, isLoading: false, isSuccess: true } as any)
    mockUseCompanyInfo.mockReturnValue({ data: STABLE_COMPANY_INFO, isLoading: false } as any)
  })

  it('shows "Not configured" when the daily wage has never been set', async () => {
    mockUseDailyWageRate.mockReturnValue({ data: 0, isLoading: false } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Employee wages'))
    expect(screen.getByText('Not configured')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('shows the configured amount once set — CASE 6\'s prerequisite', async () => {
    mockUseDailyWageRate.mockReturnValue({ data: 20, isLoading: false } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Employee wages'))
    expect(screen.getByText('$20.00')).toBeInTheDocument()
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument()
  })

  it('clicking "Update" calls the real mutation with the entered rate', async () => {
    mockUseDailyWageRate.mockReturnValue({ data: 0, isLoading: false } as any)
    renderSettings()
    await userEvent.click(screen.getByText('Employee wages'))
    const input = screen.getByPlaceholderText('e.g. 20.00')
    await userEvent.type(input, '25')
    await userEvent.click(screen.getByText('Update'))

    expect(mockSetDailyWageMutate).toHaveBeenCalledWith(
      25,
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })
})
