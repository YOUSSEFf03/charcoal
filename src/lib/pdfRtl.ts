// Right-to-left text preparation for jsPDF.
//
// jsPDF (v4) runs two hooks inside every text() call:
//   1. processArabic — shapes Arabic into joined presentation forms
//      (incl. the lam-alef ligature), and
//   2. a bidi engine — reorders the line. Its default is
//      isInputVisual:true / isOutputVisual:false (visual → logical).
//
// Correct use: hand jsPDF the LOGICAL string (as typed) and run its bidi
// engine logical → visual for an RTL paragraph — see {@link useRtlTextEngine}.
// Shaping then happens once, in logical order, and the engine keeps Latin and
// number runs ("01/11/2026", "BBQ Hardwood", "Whish") left-to-right inside
// the Arabic line.
//
// History (2026-11-05): we used to pre-shape + pre-reorder strings ourselves
// (toVisualRtl). With jsPDF's default bidi that reversed everything a second
// time (backwards text); with the bidi disabled jsPDF still re-ran
// processArabic on the reversed string and fused "ال" after a connecting
// letter into "لا" ("إجمالي" printed as "إجملاي"). toVisualRtl/reorderRtl are
// kept for reference/tests but are no longer used for drawing.
import type { jsPDF as JsPDFDoc } from 'jspdf'

type Dir = 'R' | 'L' | 'N'

const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/
const DIGIT_RE = /[0-9]/
// Characters that stay inside a number run when sandwiched between digits.
const NUMBER_JOINERS = new Set(['/', ',', '.', ':'])

export function hasArabic(s: string): boolean {
  return ARABIC_RE.test(s)
}

function isNumberChar(ch: string): boolean {
  return DIGIT_RE.test(ch)
}

function classify(ch: string): Dir {
  if (ARABIC_RE.test(ch)) return 'R'
  if (/[\p{L}\p{N}]/u.test(ch)) return 'L'
  return 'N'
}

/**
 * Simplified Unicode bidi for an RTL paragraph: strong runs keep their own
 * direction, neutrals take the surrounding direction when both sides agree
 * and the RTL base direction otherwise, then the run sequence is reversed
 * (and Arabic runs' characters with it) to produce left-to-right drawing order.
 */
export function reorderRtl(shaped: string): string {
  const chars = Array.from(shaped)
  const types: Dir[] = chars.map(classify)

  for (let i = 1; i < chars.length - 1; i++) {
    if (NUMBER_JOINERS.has(chars[i]) && DIGIT_RE.test(chars[i - 1]) && DIGIT_RE.test(chars[i + 1])) types[i] = 'L'
  }

  const resolved: Dir[] = [...types]
  let i = 0
  while (i < types.length) {
    if (types[i] !== 'N') { i++; continue }
    let j = i
    while (j < types.length && types[j] === 'N') j++
    // Numbers count as R when deciding what a neutral between them becomes
    // (UBA rule N1) so "from — to" date ranges keep their RTL order.
    const before = i > 0 && !isNumberChar(chars[i - 1]) ? types[i - 1] : 'R'
    const after = j < types.length && !isNumberChar(chars[j]) ? types[j] : 'R'
    const dir: Dir = before === after ? before : 'R'
    for (let k = i; k < j; k++) resolved[k] = dir
    i = j
  }

  const runs: { dir: Dir; text: string[] }[] = []
  chars.forEach((ch, idx) => {
    const last = runs[runs.length - 1]
    if (last && last.dir === resolved[idx]) last.text.push(ch)
    else runs.push({ dir: resolved[idx], text: [ch] })
  })

  return runs
    .reverse()
    .map((r) => (r.dir === 'R' ? r.text.reverse().join('') : r.text.join('')))
    .join('')
}

/** jsPDF bidi options: logical Arabic paragraph → visual drawing order. */
const RTL_LOGICAL_TO_VISUAL = { isInputVisual: false, isOutputVisual: true, isInputRtl: true, isOutputRtl: false } as const
/** jsPDF bidi options that leave the string untouched (visual → visual). */
const NO_REORDER = { isInputVisual: true, isOutputVisual: true } as const

function textHasArabic(text: unknown): boolean {
  if (typeof text === 'string') return hasArabic(text)
  if (Array.isArray(text)) return text.some((part) => textHasArabic(Array.isArray(part) ? part[0] : part))
  return false
}

/**
 * Sets up `doc.text()` for an Arabic (RTL) document: text containing Arabic is
 * passed in LOGICAL order and jsPDF shapes it once, then reorders it for an
 * RTL line; text with no Arabic (amounts, phone numbers, references) is drawn
 * exactly as given. Applied to the document instance, so it also covers text
 * drawn by plugins such as jspdf-autotable. Call once right after creating
 * the doc; never pre-reorder strings (no toVisualRtl) when using it.
 */
export function useRtlTextEngine(doc: JsPDFDoc): void {
  type TextFn = (text: unknown, x: number, y: number, options?: Record<string, unknown>, transform?: unknown) => JsPDFDoc
  const target = doc as unknown as { text: TextFn }
  const original = target.text.bind(doc) as TextFn
  target.text = (text, x, y, options, transform) =>
    original(text, x, y, { ...(options ?? {}), ...(textHasArabic(text) ? RTL_LOGICAL_TO_VISUAL : NO_REORDER) }, transform)
}

/**
 * Prepares one line for doc.text(): strings without Arabic are returned
 * untouched (they already draw correctly left-to-right), others are shaped
 * and reordered into visual order.
 */
export function toVisualRtl(doc: JsPDFDoc, s: string): string {
  if (!hasArabic(s)) return s
  const shaped = (doc as unknown as { processArabic: (t: string) => string }).processArabic(s)
  return reorderRtl(shaped)
}

/**
 * Word-wraps a *logical* Arabic string to `maxWidth` (mm, using the doc's
 * current font/size) and returns LOGICAL-order lines joined with '\n' (for a
 * doc set up with useRtlTextEngine). Wrapping must happen before reordering —
 * splitting an already-reversed line would put the end of the sentence on
 * the first line. Strings without
 * Arabic are returned unchanged so the table can wrap them normally.
 */
export function wrapRtl(doc: JsPDFDoc, s: string, maxWidth: number): string {
  if (!hasArabic(s)) return s
  const lines: string[] = []
  let current = ''
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word
    if (current && doc.getTextWidth(candidate) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  // Lines stay in logical order — useRtlTextEngine() reorders each one when drawn.
  return lines.join('\n')
}
