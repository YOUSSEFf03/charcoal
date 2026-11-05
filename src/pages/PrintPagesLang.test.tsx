// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'

// ---------------------------------------------------------------------------
// Language support for the HTML print pages. Data hooks are mocked so no
// network layer is involved. Routes + query params exercised here:
//   /orders/:id/delivery-receipt?lang=bilingual|en|ar   (absent => bilingual)
//   /invoice/:id?lang=en|ar                             (absent => en)
//   /reports/daily/:date?lang=en|ar                     (absent => en)
// ---------------------------------------------------------------------------

const order = {
  id: 'abcdef12-0000',
  displayId: 'ORD-7',
  bagTypeId: 'bt1',
  pricePerBag: '10',
  totalKgRequested: '100',
  bagLines: [{ bagTypeId: 'bt1', quantity: 3 }],
  bagType: { nominalKg: '5' },
  charcoalType: 'Restaurant Grade',
  grade: 'A',
  shipments: [],
  client: { name: 'Acme Co', nameAr: 'شركة أكمي', address: 'Beirut' },
  currency: 'USD',
  notes: null,
}

vi.mock('../hooks/useOrders', () => ({ useOrder: () => ({ data: order, isLoading: false, isError: false }) }))
vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => ({ data: [{ id: 'bt1', nominalKg: '5' }], isLoading: false }),
}))
vi.mock('../hooks/useTranslation', () => ({ useArabicTranslations: () => new Map<string, string>() }))

const invoice = {
  id: 'inv-1',
  displayId: 'INV-100',
  issuedAt: '2026-08-03T10:00:00.000Z',
  createdAt: '2026-08-03T10:00:00.000Z',
  dueDate: null,
  currency: 'USD',
  total: '30',
  paidAmount: '10',
  balanceDue: '20',
  client: { id: 'c1', name: 'Acme Co', nameAr: 'شركة أكمي' },
  lines: [{ saleUnit: 'BAG', qty: 3, bagTypeName: '5kg bag', lineTotal: '30' }],
}
vi.mock('../hooks/useInvoices', () => ({ useInvoice: () => ({ data: invoice, isLoading: false, isError: false }) }))

const report = {
  date: '2026-08-03',
  generatedAt: '2026-08-04T08:30:00.000Z',
  summary: {
    totalSales: '100', totalCashCollected: '50', totalCashHandoverExpenses: '1', totalGeneralExpenses: '2',
    totalWorkerCost: '3', totalHandedOver: '40', saleCount: 1, paymentCount: 2,
  },
  sales: [{
    id: 's1', invoiceId: null, invoiceDisplayId: null, source: 'ORDER', date: '2026-08-03', clientId: 'c1',
    client: { id: 'c1', name: 'Acme Co' }, currency: 'USD', description: 'Charcoal', saleTotal: '100',
    paidAmount: '50', remaining: '50', status: 'PARTIAL',
  }],
  payments: [],
  expenses: { cashHandoverExpenses: [], generalExpenses: [], workerCosts: [] },
  cashHandovers: [],
  orders: { created: [], delivered: [] },
  stockMovement: { in: { rawLots: [], packedFromSessions: [] }, out: [] },
  clientReceivables: [],
  employeeSummary: [],
  exceptions: [],
}
vi.mock('../hooks/useReports', () => ({ useDailyReport: () => ({ data: report, isLoading: false, isError: false }) }))

import DeliveryReceiptPrint from './DeliveryReceiptPrint'
import InvoicePrint from './InvoicePrint'
import DailyReportPrint from './DailyReportPrint'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderAt(path: string, route: string, el: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={el} />
      </Routes>
    </MemoryRouter>,
  )
}

const RECEIPT_ROUTE = '/orders/:id/delivery-receipt'
const receipt = (qs = '') => renderAt(`/orders/o1/delivery-receipt${qs}`, RECEIPT_ROUTE, <DeliveryReceiptPrint />)
const docRoot = (c: HTMLElement) => c.querySelector('.dr-page') as HTMLElement

describe('DeliveryReceiptPrint languages', () => {
  it('no param: bilingual, byte-compatible markup (no dir/lang/data-lang)', () => {
    const { container } = receipt()
    const page = docRoot(container)
    expect(page.hasAttribute('dir')).toBe(false)
    expect(page.hasAttribute('lang')).toBe(false)
    expect(page.hasAttribute('data-lang')).toBe(false)
    expect(within(page).getByText('DELIVERY RECEIPT')).toBeTruthy()
    expect(within(page).getByText('سند تسليم')).toBeTruthy()
    expect(page.querySelector('.dr-bi-row')!.children.length).toBe(2)
    expect(within(page).getByText('شركة أكمي')).toBeTruthy()
    expect(page.querySelector('td.dr-c-unit')!.textContent).toBe('BAG / كيس')
    expect(page.querySelector('td.dr-c-type')!.textContent).toBe('5 KG')
  })

  it('lang=en: English only, LTR', () => {
    const { container } = receipt('?lang=en')
    const page = docRoot(container)
    expect(page.getAttribute('data-lang')).toBe('en')
    expect(page.hasAttribute('dir')).toBe(false)
    expect(within(page).getByText('DELIVERY RECEIPT')).toBeTruthy()
    expect(page.textContent).not.toMatch(/[؀-ۿ]/)
    expect(page.querySelector('td.dr-c-unit')!.textContent).toBe('BAG')
    expect(page.querySelector('.dr-bi-row')!.children.length).toBe(1)
  })

  it('lang=ar: Arabic only, rtl, real nameAr, isolated LTR numbers', () => {
    const { container } = receipt('?lang=ar')
    const page = docRoot(container)
    expect(page.getAttribute('dir')).toBe('rtl')
    expect(page.getAttribute('lang')).toBe('ar')
    expect(within(page).getByText('سند تسليم')).toBeTruthy()
    expect(within(page).getByText('شركة أكمي')).toBeTruthy()
    expect(within(page).getByText('اسم الصنف')).toBeTruthy()
    expect(page.textContent).not.toContain('DELIVERY RECEIPT')
    expect(page.querySelector('td.dr-c-unit')!.textContent).toBe('كيس')
    // English charcoal type is the fallback (glossary Arabic is intentionally empty).
    expect(page.textContent).toContain('Restaurant Grade')
    const bdis = page.querySelectorAll('bdi[dir="ltr"]')
    expect(bdis.length).toBeGreaterThan(5)
    expect(page.querySelector('.dr-c-qty bdi')!.textContent).toBe('3')
  })

  it.each([80, 150, 180, 210])('lang=ar renders at %imm', async (mm) => {
    const user = userEvent.setup()
    const { container } = receipt('?lang=ar')
    await user.click(screen.getByRole('button', { name: `${mm}mm` }))
    const page = docRoot(container)
    expect(page.getAttribute('data-w')).toBe(String(mm))
    expect(page.getAttribute('dir')).toBe('rtl')
    expect(within(page).getByText('سند تسليم')).toBeTruthy()
    // compact (80mm) drops the Type / Size column.
    expect(!!page.querySelector('.dr-c-type')).toBe(mm > 80)
  })

  it('toggle offers bilingual / EN / Arabic and switches the document', async () => {
    const user = userEvent.setup()
    const { container } = receipt()
    expect(screen.getByRole('button', { name: 'Bilingual' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'العربية' }))
    expect(docRoot(container).getAttribute('dir')).toBe('rtl')
    await user.click(screen.getByRole('button', { name: 'EN' }))
    expect(docRoot(container).getAttribute('data-lang')).toBe('en')
  })
})

describe('InvoicePrint languages', () => {
  const inv = (qs = '') => renderAt(`/invoice/inv-1${qs}`, '/invoice/:id', <InvoicePrint />)

  it('no param: unchanged English, no dir/lang', () => {
    const { container } = inv()
    const card = container.querySelector('.receipt') as HTMLElement
    expect(card.hasAttribute('dir')).toBe(false)
    expect(card.hasAttribute('lang')).toBe(false)
    expect(within(card).getByText('Tax Invoice')).toBeTruthy()
    expect(within(card).getByText('FARAH CHARCOAL')).toBeTruthy()
    expect(within(card).getByText('Invoice #')).toBeTruthy()
    expect(within(card).getByText('Acme Co')).toBeTruthy()
    expect(within(card).getByText('3 Aug 2026')).toBeTruthy()
    expect(within(card).getByText('20.00 USD')).toBeTruthy()
    expect(card.querySelector('bdi')).toBeNull()
  })

  it('lang=ar: rtl, Arabic labels, nameAr, LTR-isolated numbers', () => {
    const { container } = inv('?lang=ar')
    const card = container.querySelector('.receipt') as HTMLElement
    expect(card.getAttribute('dir')).toBe('rtl')
    expect(card.getAttribute('lang')).toBe('ar')
    expect(within(card).getByText('فاتورة ضريبية')).toBeTruthy()
    expect(within(card).getByText('الرصيد المستحق')).toBeTruthy()
    expect(within(card).getByText('توقيع العميل')).toBeTruthy()
    expect(within(card).getByText('شركة أكمي')).toBeTruthy()
    expect(within(card).getByText('03/08/2026')).toBeTruthy()
    expect(card.querySelectorAll('bdi[dir="ltr"]').length).toBeGreaterThan(4)
  })

  it('lang=ar: structured items, payment status, company address; missing phone/order/price left out', () => {
    const { container } = inv('?lang=ar')
    const card = container.querySelector('.receipt') as HTMLElement
    expect(within(card).getByText('زغرتا، لبنان')).toBeTruthy()
    expect(within(card).getByText('البيان')).toBeTruthy()
    expect(within(card).getByText('5kg bag')).toBeTruthy()
    expect(card.querySelector('.inv-item-meta')!.textContent).toBe('الكمية: 3 كيس')
    expect(within(card).getByText('مبلغ مستحق على العميل')).toBeTruthy()
    expect(within(card).queryByText('الهاتف')).toBeNull()
    expect(within(card).queryByText('رقم الطلب')).toBeNull()
    expect(card.textContent).not.toContain('NaN')
    expect(card.textContent).not.toContain('—')
  })

  it('toggle switches to Arabic', async () => {
    const user = userEvent.setup()
    const { container } = inv()
    await user.click(screen.getByRole('button', { name: 'العربية' }))
    expect((container.querySelector('.receipt') as HTMLElement).getAttribute('dir')).toBe('rtl')
  })
})

describe('DailyReportPrint languages', () => {
  const rep = (qs = '') => renderAt(`/reports/daily/2026-08-03${qs}`, '/reports/daily/:date', <DailyReportPrint />)

  it('no param: unchanged English, no dir/lang', () => {
    const { container } = rep()
    const doc = container.querySelector('.day-report') as HTMLElement
    expect(doc.hasAttribute('dir')).toBe(false)
    expect(doc.hasAttribute('lang')).toBe(false)
    expect(within(doc).getByText('Full Day Report')).toBeTruthy()
    expect(within(doc).getByText('Total sales')).toBeTruthy()
    expect(within(doc).getByText('1 sale')).toBeTruthy()
    expect(within(doc).getByText('2 payments')).toBeTruthy()
    expect(within(doc).getAllByText('$100.00').length).toBeGreaterThan(0)
    expect(within(doc).getByText('No exceptions — nothing flagged for this day')).toBeTruthy()
    expect(doc.querySelector('bdi')).toBeNull()
  })

  it('lang=ar: dir=rtl lang=ar, Arabic labels, LTR-isolated amounts', () => {
    const { container } = rep('?lang=ar')
    const doc = container.querySelector('.day-report') as HTMLElement
    expect(doc.getAttribute('dir')).toBe('rtl')
    expect(doc.getAttribute('lang')).toBe('ar')
    expect(within(doc).getByText('تقرير اليوم الكامل')).toBeTruthy()
    expect(within(doc).getByText('إجمالي المبيعات')).toBeTruthy()
    expect(within(doc).getByText('المبيعات')).toBeTruthy()
    expect(within(doc).getByText('الاستثناءات')).toBeTruthy()
    expect(within(doc).getAllByText('100.00 $')[0].tagName).toBe('BDI')
    expect(within(doc).getByText('03/08/2026')).toBeTruthy()
    expect(doc.textContent).not.toContain('Total sales')
  })

  it('toggle switches to Arabic and keeps the route', async () => {
    const user = userEvent.setup()
    const { container } = rep()
    await user.click(screen.getByRole('button', { name: 'العربية' }))
    expect((container.querySelector('.day-report') as HTMLElement).getAttribute('dir')).toBe('rtl')
  })
})
