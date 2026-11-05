// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useDocLang } from './useDocLang'
import { DocLangToggle } from '../../components/ui/DocLangToggle'

afterEach(() => {
  cleanup()
})

function Probe({ receipt = false, fallback = 'en' }: { receipt?: boolean; fallback?: 'en' | 'ar' }) {
  const [lang, setLang] = receipt ? useDocLang({ allowBilingual: true }) : useDocLang(fallback)
  const loc = useLocation()
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="search">{loc.search}</span>
      <button onClick={() => setLang('ar')}>to-ar</button>
    </div>
  )
}

describe('useDocLang', () => {
  it('reads ?lang from the URL', () => {
    render(<MemoryRouter initialEntries={['/x?lang=ar']}><Probe /></MemoryRouter>)
    expect(screen.getByTestId('lang').textContent).toBe('ar')
  })

  it('uses the document fallback when ?lang is absent (en by default)', () => {
    render(<MemoryRouter initialEntries={['/x']}><Probe /></MemoryRouter>)
    expect(screen.getByTestId('lang').textContent).toBe('en')
    cleanup()
    render(<MemoryRouter initialEntries={['/x']}><Probe fallback="ar" /></MemoryRouter>)
    expect(screen.getByTestId('lang').textContent).toBe('ar')
  })

  it('receipt mode defaults to bilingual and accepts ?lang=bilingual', () => {
    render(<MemoryRouter initialEntries={['/x']}><Probe receipt /></MemoryRouter>)
    expect(screen.getByTestId('lang').textContent).toBe('bilingual')
    cleanup()
    render(<MemoryRouter initialEntries={['/x?lang=en']}><Probe receipt /></MemoryRouter>)
    expect(screen.getByTestId('lang').textContent).toBe('en')
  })

  it('setLang updates only the lang param, preserving others', async () => {
    render(<MemoryRouter initialEntries={['/x?a=1&lang=en']}><Probe /></MemoryRouter>)
    await userEvent.click(screen.getByText('to-ar'))
    expect(screen.getByTestId('lang').textContent).toBe('ar')
    expect(screen.getByTestId('search').textContent).toBe('?a=1&lang=ar')
  })
})

describe('DocLangToggle', () => {
  it('shows EN and Arabic only by default and reports changes', async () => {
    const seen: string[] = []
    render(<DocLangToggle value="en" onChange={(l) => seen.push(l)} />)
    expect(screen.queryByText('Bilingual')).toBeNull()
    expect(screen.getByText('EN').getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByText('العربية'))
    expect(seen).toEqual(['ar'])
  })

  it('shows Bilingual when allowed and is hidden in print', async () => {
    const seen: string[] = []
    const { container } = render(<DocLangToggle options={['en', 'ar', 'bilingual']} value="bilingual" onChange={(l) => seen.push(l)} />)
    expect(screen.getByText('Bilingual').getAttribute('aria-pressed')).toBe('true')
    expect((container.firstChild as HTMLElement).className).toContain('print:hidden')
    await userEvent.click(screen.getByText('EN'))
    expect(seen).toEqual(['en'])
  })
})
