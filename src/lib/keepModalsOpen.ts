/**
 * Popups (modals) must not close when the user clicks outside them.
 *
 * Every modal in the app sits on a full-screen backdrop (`.modal-overlay`, or
 * an inline overlay marked `data-modal-overlay` in Settings.tsx) whose onClick
 * closed the modal. Users lost half-filled forms by clicking beside the
 * popup, or by selecting text in an input and releasing the mouse outside it
 * (the browser then fires the click on the backdrop). 2026-11-11.
 *
 * Global fix, installed once in main.tsx: a click whose target IS a backdrop
 * is stopped in the capture phase on window, before React's root listener
 * sees it, so no backdrop onClick ever runs. Clicks inside the modal are
 * untouched; modals close only via their ✕ / Cancel / Save buttons.
 * Slide-in side panels (`.panel-overlay`, `.panel-backdrop`) are not matched.
 */
export function isModalBackdrop(el: EventTarget | null): boolean {
  return el instanceof HTMLElement &&
    (el.classList.contains('modal-overlay') || el.hasAttribute('data-modal-overlay'))
}

export function handleBackdropClick(event: MouseEvent): void {
  if (isModalBackdrop(event.target)) event.stopPropagation()
}

export function keepModalsOpenOnOutsideClick(): void {
  window.addEventListener('click', handleBackdropClick, { capture: true })
}
