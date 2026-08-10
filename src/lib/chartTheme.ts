/** Reads a CSS custom property's resolved value, for canvas-based charts that
 * can't consume var(--x) directly. Shared by every chart.js component so the
 * theme-resolution logic exists in exactly one place. */
export function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Categorical palette for multi-series charts (e.g. revenue by charcoal
 * type), built from the design system's existing accent/status colors so
 * category charts read as part of the same system as single-series ones. */
export function categoricalPalette(): string[] {
  return [
    cssVar('--accent', '#1D6B4A'),
    cssVar('--accent2', '#B45309'),
    cssVar('--blue', '#1D4ED8'),
    cssVar('--red', '#C0392B'),
    cssVar('--text3', '#9B9890'),
  ]
}
