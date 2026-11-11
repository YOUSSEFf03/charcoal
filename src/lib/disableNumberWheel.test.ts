// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { disableNumberInputWheel } from './disableNumberWheel'

function wheel(target: Element, init: WheelEventInit = { deltaY: 100 }) {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

describe('disableNumberInputWheel', () => {
  beforeAll(() => disableNumberInputWheel())
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

  it('cancels the wheel on a number input (focused or not) and scrolls the page instead', () => {
    document.body.innerHTML = '<input type="number" value="5">'
    const input = document.querySelector('input')!
    const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    expect(wheel(input).defaultPrevented).toBe(true)
    input.focus()
    expect(wheel(input, { deltaY: -40 }).defaultPrevented).toBe(true)
    expect(input.value).toBe('5')
    expect(scroll).toHaveBeenLastCalledWith({ left: 0, top: -40 })
  })

  it('scrolls the nearest scrollable container (e.g. a modal) when it can scroll', () => {
    document.body.innerHTML = '<div id="modal" style="overflow-y:auto"><input type="number"></div>'
    const modal = document.getElementById('modal')!
    Object.defineProperty(modal, 'scrollHeight', { value: 1000 })
    Object.defineProperty(modal, 'clientHeight', { value: 300 })
    const modalScroll = vi.fn()
    modal.scrollBy = modalScroll as any
    const winScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    wheel(modal.querySelector('input')!, { deltaY: 3, deltaMode: 1 })
    expect(modalScroll).toHaveBeenCalledWith({ left: 0, top: 48 })
    expect(winScroll).not.toHaveBeenCalled()
  })

  it('leaves other inputs and ctrl+wheel zoom alone', () => {
    document.body.innerHTML = '<input type="text"><input type="number">'
    const [text, num] = Array.from(document.querySelectorAll('input'))
    expect(wheel(text).defaultPrevented).toBe(false)
    expect(wheel(num, { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false)
  })
})
