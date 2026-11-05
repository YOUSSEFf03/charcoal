import { describe, it, expect } from 'vitest'
import { jsPDF } from 'jspdf'
import {
  buildStatementPdf,
  buildStatementPdfFile,
  statementColumnOrder,
  statementPdfFilename,
  type StatementPdfConfig,
} from './statementPdf'
import { DOC_LABELS } from './i18n/docLabels'
import { COMPANY_INFO } from './companyInfo'
import { reorderRtl, toVisualRtl, wrapRtl } from './pdfRtl'

function baseConfig(overrides: Partial<StatementPdfConfig> = {}): StatementPdfConfig {
  return {
    client: { name: 'GLOBAL CONSTRUCTION GROUP SAL', nameAr: 'مجموعة غلوبال للإنشاءات', address: null, phone: '+961 3 111 222', currency: 'USD' },
    from: '2026-07-04T00:00:00.000Z',
    to: '2026-08-19T00:00:00.000Z',
    rows: [
      { ref: 'SI-1953', rawDate: '2026-07-04T00:00:00.000Z', desc: 'Sales Invoice', debit: 9440.55, credit: 0, balance: 9440.55 },
      { ref: 'RV-543', rawDate: '2026-07-06T00:00:00.000Z', desc: 'دفعة نقدية', debit: 0, credit: 5000, balance: 4440.55 },
    ],
    openingBalance: 0,
    periodDebitTotal: 9440.55,
    periodCreditTotal: 5000,
    closingBalance: 4440.55,
    ...overrides,
  }
}

/**
 * Records every string handed to jsPDF's text() while `build` runs (autotable
 * cells included), in call order. Hooks jsPDF's public "preProcessText" event,
 * which fires with the exact string the caller passed.
 */
async function captureTextCalls(build: () => Promise<unknown>): Promise<string[]> {
  const calls: string[] = []
  const events = (jsPDF.API as unknown as { events: [string, (payload: { text: unknown }) => void][] }).events
  const hook: [string, (payload: { text: unknown }) => void] = [
    'preProcessText',
    (payload) => {
      const parts = Array.isArray(payload.text) ? payload.text : [payload.text]
      for (const part of parts) {
        const str = Array.isArray(part) ? part[0] : part
        if (typeof str === 'string') calls.push(str)
      }
    },
  ]
  events.push(hook)
  try {
    await build()
  } finally {
    events.splice(events.indexOf(hook), 1)
  }
  return calls
}

/**
 * What jsPDF finally DRAWS for each text() call: records every string with
 * the options it was passed (a "preProcessText" hook sees both), then applies
 * jsPDF's own pipeline to it — processArabic shaping, then its bidi engine
 * with those exact options. (jsPDF's event order is not guaranteed, so a
 * post-processing hook cannot reliably observe the bidi result.)
 */
async function captureDrawnText(build: () => Promise<unknown>): Promise<string[]> {
  const drawn: string[] = []
  type Payload = { text: unknown; options?: Record<string, unknown> }
  const events = (jsPDF.API as unknown as { events: [string, (payload: Payload) => void][] }).events
  const probe = new jsPDF() as unknown as { processArabic: (t: string) => string }
  const Bidi = (jsPDF as unknown as { __bidiEngine__: new (o: Record<string, unknown>) => { doBidiReorder: (t: string) => string } }).__bidiEngine__
  const hook: [string, (payload: Payload) => void] = [
    'preProcessText',
    (payload) => {
      const opts = payload.options ?? {}
      const engine = new Bidi({
        isInputVisual: typeof opts.isInputVisual === 'boolean' ? opts.isInputVisual : true,
        isOutputVisual: opts.isOutputVisual, isInputRtl: opts.isInputRtl, isOutputRtl: opts.isOutputRtl,
      })
      const parts = Array.isArray(payload.text) ? payload.text : [payload.text]
      for (const part of parts) {
        const str = Array.isArray(part) ? part[0] : part
        if (typeof str === 'string') drawn.push(engine.doBidiReorder(probe.processArabic(str)))
      }
    },
  ]
  events.push(hook)
  try {
    await build()
  } finally {
    events.splice(events.indexOf(hook), 1)
  }
  return drawn
}

describe('Arabic glyph order actually drawn', () => {
  // For a purely-Arabic label the correct drawing order is the shaped
  // (joined) logical string, reversed character by character — shaped ONCE.
  const shapeOnce = (s: string) => (new jsPDF() as unknown as { processArabic: (t: string) => string }).processArabic(s)
  const expectedDrawn = (s: string) => Array.from(shapeOnce(s)).reverse().join('')

  it('draws Arabic right-to-left exactly once — not backwards (regression: reversed twice)', async () => {
    const drawn = await captureDrawnText(() => buildStatementPdf(baseConfig({ lang: 'ar' })))
    const L = DOC_LABELS.ar
    expect(drawn).toContain(expectedDrawn(L['statement.title']))
    expect(drawn).toContain(expectedDrawn(L['statement.closingBalance']))
    // Table header cells (drawn by autotable) are covered too.
    expect(drawn).toContain(expectedDrawn(L['statement.col.balance']))
    // The logical (un-reordered) shaped form must never be what gets drawn.
    expect(drawn).not.toContain(shapeOnce(L['statement.title']))
  })

  it('never fuses "ال" into a lam-alef ligature (regression: "إجمالي" printed as "إجملاي")', async () => {
    const drawn = await captureDrawnText(() => buildStatementPdf(baseConfig({ lang: 'ar' })))
    expect(drawn).toContain(expectedDrawn(DOC_LABELS.ar['statement.totalDebit']))
    expect(drawn).toContain(expectedDrawn(DOC_LABELS.ar['statement.totalCredit']))
  })

  it('keeps Latin/number runs left-to-right inside an Arabic line (dates in the period line)', async () => {
    const drawn = await captureDrawnText(() => buildStatementPdf(baseConfig({ lang: 'ar' })))
    const period = drawn.find((s) => s.includes('04/07/2026'))
    expect(period).toBeDefined()
    // Both dates survive intact (no digit run reversed), start date before the end date in reading order (rightmost first).
    expect(period).toContain('19/08/2026')
    expect(period!.indexOf('04/07/2026')).toBeGreaterThan(period!.indexOf('19/08/2026'))
  })
})

describe('statementColumnOrder', () => {
  it('keeps English left-to-right and mirrors Arabic exactly', () => {
    expect(statementColumnOrder('en')).toEqual(['ref', 'date', 'desc', 'debit', 'credit', 'balance'])
    expect(statementColumnOrder('ar')).toEqual(['balance', 'credit', 'debit', 'desc', 'date', 'ref'])
    expect(statementColumnOrder()).toEqual(statementColumnOrder('en'))
  })
})

describe('buildStatementPdf — lang: ar', () => {
  it('registers the embedded Arabic font (regular + bold) and does not register it for English', async () => {
    const ar = await buildStatementPdf(baseConfig({ lang: 'ar' }))
    const fonts = ar.getFontList()
    expect(Object.keys(fonts)).toContain('Amiri')
    expect(fonts.Amiri).toEqual(expect.arrayContaining(['normal', 'bold']))

    const en = await buildStatementPdf(baseConfig())
    expect(Object.keys(en.getFontList())).not.toContain('Amiri')
  })

  it('draws Arabic labels from DOC_LABELS, mirrored column headers, Arabic client name, Western digits', async () => {
    const calls = await captureTextCalls(() => buildStatementPdf(baseConfig({ lang: 'ar' })))
    const L = DOC_LABELS.ar
    // Strings reach text() in logical order (jsPDF reorders them — see pdfRtl.ts).
    const visual = (s: string) => s

    expect(calls).toContain(visual(L['statement.title']))
    expect(calls).toContain(visual(L['statement.closingBalance']))
    expect(calls).toContain(visual(COMPANY_INFO.nameAr))
    // Arabic client name is used in the title block and info panel (not the English one).
    expect(calls.some((c) => c.includes('GLOBAL CONSTRUCTION'))).toBe(false)
    expect(calls).toContain(visual('مجموعة غلوبال للإنشاءات'))

    // Header cells are emitted in the mirrored order: Balance first, Trans # last.
    const heads = ['statement.col.balance', 'statement.col.credit', 'statement.col.debit', 'statement.col.description', 'statement.col.date', 'statement.col.transNo'] as const
    const idx = heads.map((k) => calls.indexOf(visual(L[k])))
    expect(idx.every((i) => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)

    // Western digits, dd/mm/yyyy, symbol after the number; never Arabic-Indic digits.
    expect(calls).toContain('04/07/2026')
    expect(calls).toContain('9,440.55 $')
    expect(calls.join('')).not.toMatch(/[٠-٩]/)
  })

  it('prints the period as "من {from} إلى {to}" and handles open-ended periods', async () => {
    const both = await captureTextCalls(() => buildStatementPdf(baseConfig({ lang: 'ar' })))
    expect(both).toContain('فترة الكشف: من 04/07/2026 إلى 19/08/2026')
    const toOnly = await captureTextCalls(() => buildStatementPdf(baseConfig({ lang: 'ar', from: null })))
    expect(toOnly).toContain('فترة الكشف: حتى 19/08/2026')
    const none = await captureTextCalls(() => buildStatementPdf(baseConfig({ lang: 'ar', from: null, to: null })))
    expect(none).toContain('فترة الكشف: جميع الحركات')
    expect(none.join('\n')).not.toMatch(/—\s*—/)
  })

  it('cleans the phone and leaves out missing details instead of printing "—"', async () => {
    const calls = await captureTextCalls(() =>
      buildStatementPdf(baseConfig({ lang: 'ar', client: { name: 'X', nameAr: 'س', address: null, phone: '`23123123', currency: 'USD' } })),
    )
    expect(calls).toContain('23123123')
    expect(calls.some((c) => c.includes('`'))).toBe(false)
    expect(calls).not.toContain(DOC_LABELS.ar['common.address'])
    expect(calls).not.toContain('—')
  })

  it('shows labelled description lines and the Arabic summary (opening, totals, closing, status)', async () => {
    const calls = await captureTextCalls(() => buildStatementPdf(baseConfig({
      lang: 'ar',
      locationNames: ['hanmra'],
      openingBalance: 100,
      rows: [{ ref: 'SO-0691', rawDate: '2026-07-05T00:00:00.000Z', desc: 'Order Sale · 500.000 kg BBQ Hardwood Grade A - hanmra', debit: 500, credit: 0, balance: 600 }],
      periodDebitTotal: 500, periodCreditTotal: 0, closingBalance: 600,
    })))
    const joined = calls.join('\n')
    // The product line may wrap inside the description column.
    expect(joined).toMatch(/المنتج: BBQ\s+Hardwood\s+Grade\s+A/)
    expect(joined).toContain('الكمية: 500 كغ')
    expect(joined).toContain('الفرع: hanmra')
    const L = DOC_LABELS.ar
    expect(calls).toContain(L['statement.summary.opening'])
    expect(calls).toContain(L['statement.status.owed'])
    expect(calls).toContain('100.00 $')
    expect(calls).toContain('600.00 $')
  })

  it('states a credit balance in the client\'s favour, and settled at zero', async () => {
    const credit = await captureTextCalls(() => buildStatementPdf(baseConfig({ lang: 'ar', closingBalance: -50 })))
    expect(credit).toContain(DOC_LABELS.ar['statement.status.credit'])
    const settled = await captureTextCalls(() => buildStatementPdf(baseConfig({ lang: 'ar', closingBalance: 0 })))
    expect(settled).toContain(DOC_LABELS.ar['statement.status.settled'])
    const supplier = await captureTextCalls(() => buildStatementPdf(baseConfig({ lang: 'ar', partyLabel: 'Supplier' })))
    expect(supplier).not.toContain(DOC_LABELS.ar['statement.status.owed'])
  })

  it('falls back to the English name when no Arabic name is provided', async () => {
    const calls = await captureTextCalls(() =>
      buildStatementPdf(baseConfig({ lang: 'ar', client: { name: 'ACME LTD', address: null, phone: null, currency: 'USD' } })),
    )
    expect(calls).toContain('ACME LTD')
  })

  it('leaves English output untouched when lang is omitted or "en" (nameAr ignored, Helvetica only)', async () => {
    const plain = await captureTextCalls(() => buildStatementPdf(baseConfig()))
    const explicit = await captureTextCalls(() => buildStatementPdf(baseConfig({ lang: 'en' })))
    expect(explicit).toEqual(plain)
    expect(plain).toContain('STATEMENT OF ACCOUNT')
    expect(plain).toContain('Statement Period: 04 Jul 2026 — 19 Aug 2026')
    expect(plain).toContain('$9,440.55')
    expect(plain.some((c) => c.includes('مجموعة'))).toBe(false)
    const doc = await buildStatementPdf(baseConfig())
    expect(Object.keys(doc.getFontList())).not.toContain('Amiri')
  })
})

describe('buildStatementPdfFile / filenames', () => {
  it('returns a PDF File named like the download', async () => {
    const file = await buildStatementPdfFile(baseConfig())
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('application/pdf')
    expect(file.name).toBe('GLOBAL CONSTRUCTION GROUP SAL_Statement of Account.pdf')
    expect(file.size).toBeGreaterThan(1000)
  })

  it('uses the Arabic name and title for Arabic files', async () => {
    const file = await buildStatementPdfFile(baseConfig({ lang: 'ar' }))
    expect(file.name).toBe('مجموعة غلوبال للإنشاءات_كشف حساب.pdf')
    expect(statementPdfFilename('X', 'Client', 'ar')).toBe('X_كشف حساب.pdf')
    expect(statementPdfFilename('X')).toBe('X_Statement of Account.pdf')
  })
})

describe('pdfRtl', () => {
  it('leaves strings without Arabic untouched', () => {
    expect(toVisualRtl(new jsPDF(), '$1,234.50 USD')).toBe('$1,234.50 USD')
  })

  it('keeps number runs left-to-right and reverses Arabic runs and run order', () => {
    // Logical: AR1 AR2 12/08 -> visual (LTR drawing): "12/08" first, then AR2 reversed, then AR1 reversed.
    expect(reorderRtl('اب جد 12/08')).toBe('12/08 دج با')
  })

  it('keeps a "from — to" date range in RTL order', () => {
    expect(reorderRtl('ا 01/08/2026 — 19/08/2026')).toBe('19/08/2026 — 01/08/2026 ا')
  })

  it('wraps a long Arabic string into multiple visual lines', () => {
    const doc = new jsPDF()
    const out = wrapRtl(doc, 'كلمة '.repeat(30).trim(), 30)
    expect(out.split('\n').length).toBeGreaterThan(1)
  })
})
