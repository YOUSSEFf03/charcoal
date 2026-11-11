/**
 * Browsers change the value of an <input type="number"> when the user scrolls
 * (mouse wheel / trackpad swipe) over it, which silently corrupts amounts,
 * quantities and prices while the user only meant to scroll the page.
 *
 * Global fix, applied once in main.tsx to every number input in the app:
 * a wheel event over a number input has its default action cancelled (so the
 * value can never step), and we scroll the nearest scrollable container —
 * a modal body, a table, or the page itself — by the same amount instead.
 *
 * (The earlier version only blurred the input when it was focused; that was
 * racy and left the value changing in some browsers. 2026-11-11.)
 */

function pixels(delta: number, mode: number): number {
  if (mode === 1) return delta * 16 // DOM_DELTA_LINE
  if (mode === 2) return delta * window.innerHeight // DOM_DELTA_PAGE
  return delta
}

function canScroll(el: Element, dx: number, dy: number): boolean {
  const s = getComputedStyle(el)
  if (dy !== 0 && /(auto|scroll|overlay)/.test(s.overflowY)) {
    if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true
  }
  if (dx !== 0 && /(auto|scroll|overlay)/.test(s.overflowX)) {
    if (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0) return true
  }
  return false
}

export function handleNumberInputWheel(event: WheelEvent): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.type !== 'number') return
  if (event.ctrlKey) return // pinch / ctrl+wheel zoom — leave it alone

  event.preventDefault()

  const dx = pixels(event.deltaX, event.deltaMode)
  const dy = pixels(event.deltaY, event.deltaMode)
  let el: Element | null = target.parentElement
  while (el && el !== document.body && el !== document.documentElement) {
    if (canScroll(el, dx, dy)) {
      el.scrollBy({ left: dx, top: dy })
      return
    }
    el = el.parentElement
  }
  window.scrollBy({ left: dx, top: dy })
}

export function disableNumberInputWheel(): void {
  // passive: false is required for preventDefault() to take effect.
  document.addEventListener('wheel', handleNumberInputWheel, { passive: false, capture: true })
}
