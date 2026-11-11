/**
 * Browsers change the value of a focused <input type="number"> when the user
 * scrolls (mouse wheel / trackpad swipe) over it, which silently corrupts
 * quantities and prices while the user only meant to scroll the page.
 *
 * Global fix: when a wheel event happens over the focused number input, blur
 * it. The value stays unchanged and the page scrolls normally.
 */
export function disableNumberInputWheel(): void {
  document.addEventListener(
    'wheel',
    (event) => {
      const active = document.activeElement
      if (
        active instanceof HTMLInputElement &&
        active.type === 'number' &&
        event.target instanceof Node &&
        active.contains(event.target)
      ) {
        active.blur()
      }
    },
    { passive: true, capture: true },
  )
}
