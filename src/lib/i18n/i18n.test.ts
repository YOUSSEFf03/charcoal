import { describe, it, expect } from 'vitest'
import { DOC_LABELS, t } from './docLabels'
import { fmtDocDate, fmtDocMoney, unitLabel, pickName } from './docFormat'
import { docDir, parseDocLang } from './docLang'
import { formatDate } from '../date'
import { formatUsd } from '../money'
import { COMPANY_INFO } from '../companyInfo'

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()

describe('DOC_LABELS', () => {
  it('has identical key sets in en and ar', () => {
    expect(Object.keys(DOC_LABELS.ar).sort()).toEqual(Object.keys(DOC_LABELS.en).sort())
  })

  it('has no empty strings and matching {placeholders} in both languages', () => {
    for (const key of Object.keys(DOC_LABELS.en) as (keyof typeof DOC_LABELS.en)[]) {
      expect(DOC_LABELS.en[key].trim(), key).not.toBe('')
      expect(DOC_LABELS.ar[key].trim(), key).not.toBe('')
      expect(placeholders(DOC_LABELS.ar[key]), key).toEqual(placeholders(DOC_LABELS.en[key]))
    }
  })

  it('reuses the existing receipt Arabic strings verbatim', () => {
    expect(t('ar', 'receipt.title')).toBe('سند تسليم')
    expect(t('ar', 'receipt.receiptNo')).toBe('رقم السند')
    expect(t('ar', 'receipt.typeSize')).toBe('النوع / الحجم')
  })

  it('t() interpolates variables and leaves unknown placeholders', () => {
    expect(t('en', 'common.pageOf', { page: 2, total: 5 })).toBe('Page 2 of 5')
    expect(t('ar', 'common.pageOf', { page: 2, total: 5 })).toBe('صفحة 2 من 5')
    expect(t('en', 'common.pageOf', { page: 2 })).toBe('Page 2 of {total}')
    expect(t('en', 'receipt.title')).toBe('DELIVERY RECEIPT')
  })
})

describe('COMPANY_INFO', () => {
  it('keeps English fields and adds Arabic ones', () => {
    expect(COMPANY_INFO.name).toBe('Farah Charcoal')
    expect(COMPANY_INFO.address).toBe('Zgharta, Lebanon')
    expect(COMPANY_INFO.nameAr).toBe('فرح للفحم')
    expect(COMPANY_INFO.addressAr).toBe('زغرتا، لبنان')
  })
})

describe('fmtDocDate', () => {
  const iso = '2026-08-03T12:00:00'
  it('en short is identical to formatDate', () => {
    expect(fmtDocDate('en', iso)).toBe(formatDate(iso))
    expect(fmtDocDate('en', iso)).toBe('3 Aug 2026')
  })
  it('en slash and ar use dd/mm/yyyy with Western digits', () => {
    expect(fmtDocDate('en', iso, { style: 'slash' })).toBe('03/08/2026')
    expect(fmtDocDate('ar', iso)).toBe('03/08/2026')
    expect(fmtDocDate('ar', iso, { style: 'short' })).toBe('03/08/2026')
  })
  it('returns the fallback for null / invalid input', () => {
    for (const lang of ['en', 'ar'] as const) {
      expect(fmtDocDate(lang, null)).toBe('—')
      expect(fmtDocDate(lang, 'nope')).toBe('—')
      expect(fmtDocDate(lang, undefined, { fallback: 'n/a' })).toBe('n/a')
    }
  })
})

describe('fmtDocMoney', () => {
  it('without currency is a plain 2dp grouped number in both languages', () => {
    expect(fmtDocMoney('en', 1234.5)).toBe('1,234.50')
    expect(fmtDocMoney('ar', 1234.5)).toBe('1,234.50')
    expect(fmtDocMoney('en', '12')).toBe('12.00')
  })
  it('en with USD matches formatUsd, including negatives', () => {
    expect(fmtDocMoney('en', 2027.97, 'USD')).toBe(formatUsd(2027.97))
    expect(fmtDocMoney('en', -200, 'USD')).toBe('-$200.00')
  })
  it('ar puts the symbol after the number; unknown currency codes follow the number in both', () => {
    expect(fmtDocMoney('ar', 1234.5, 'USD')).toBe('1,234.50 $')
    expect(fmtDocMoney('en', 1000, 'LBP')).toBe('1,000.00 LBP')
    expect(fmtDocMoney('ar', 1000, 'LBP')).toBe('1,000.00 LBP')
  })
  it('null input yields the dash fallback', () => {
    expect(fmtDocMoney('en', null)).toBe('—')
  })
})

describe('unitLabel / pickName', () => {
  it('maps units per language', () => {
    expect(unitLabel('en', 'BAG')).toBe('BAG')
    expect(unitLabel('en', 'KG')).toBe('KG')
    expect(unitLabel('ar', 'BAG')).toBe('كيس')
    expect(unitLabel('ar', 'KG')).toBe('كغ')
  })
  it('pickName prefers Arabic only in ar and only when present', () => {
    expect(pickName('ar', 'Ali', 'علي')).toBe('علي')
    expect(pickName('ar', 'Ali', null)).toBe('Ali')
    expect(pickName('ar', 'Ali', '  ')).toBe('Ali')
    expect(pickName('ar', 'Ali')).toBe('Ali')
    expect(pickName('en', 'Ali', 'علي')).toBe('Ali')
  })
})

describe('parseDocLang / docDir', () => {
  it('parses en and ar from strings with or without ?', () => {
    expect(parseDocLang('?lang=ar', 'en')).toBe('ar')
    expect(parseDocLang('lang=en&x=1', 'ar')).toBe('en')
    expect(parseDocLang(new URLSearchParams('lang=ar'), 'en')).toBe('ar')
  })
  it('falls back when absent or invalid', () => {
    expect(parseDocLang('', 'en')).toBe('en')
    expect(parseDocLang('?lang=fr', 'ar')).toBe('ar')
    expect(parseDocLang('?x=1', 'ar')).toBe('ar')
  })
  it('accepts bilingual only when allowed', () => {
    expect(parseDocLang('?lang=bilingual', 'en')).toBe('en')
    expect(parseDocLang('?lang=bilingual', 'en', true)).toBe('bilingual')
    expect(parseDocLang('', 'bilingual', true)).toBe('bilingual')
    expect(parseDocLang('?lang=zz', 'bilingual', true)).toBe('bilingual')
  })
  it('docDir is rtl only for ar', () => {
    expect(docDir('ar')).toBe('rtl')
    expect(docDir('en')).toBe('ltr')
    expect(docDir('bilingual')).toBe('ltr')
  })
})
