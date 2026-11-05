import { describe, expect, it } from 'vitest'
import { planPageSlices } from './pdfPaging'

describe('planPageSlices', () => {
  it('returns one slice when the content fits on a page', () => {
    expect(planPageSlices(500, 1000, [100, 200])).toEqual([[0, 500]])
  })

  it('cuts at the last safe break on each page', () => {
    // rows end every 90px; page holds 300px → cuts at 270, then 540
    const rows = Array.from({ length: 8 }, (_, i) => (i + 1) * 90)
    expect(planPageSlices(720, 300, rows)).toEqual([[0, 270], [270, 540], [540, 720]])
  })

  it('never cuts through a keep-together span', () => {
    // a candidate at 290 lies inside a row spanning 250..320 → use 250
    expect(planPageSlices(500, 300, [250, 290], [{ top: 250, bottom: 320 }])).toEqual([[0, 250], [250, 500]])
  })

  it('hard-cuts when no safe break exists in the lower half of the page', () => {
    expect(planPageSlices(700, 300, [50])).toEqual([[0, 300], [300, 600], [600, 700]])
  })

  it('covers the whole height without gaps', () => {
    const slices = planPageSlices(2500, 700, [120, 650, 680, 1300, 1390, 2000])
    expect(slices[0][0]).toBe(0)
    expect(slices[slices.length - 1][1]).toBe(2500)
    for (let i = 1; i < slices.length; i++) expect(slices[i][0]).toBe(slices[i - 1][1])
  })
})
