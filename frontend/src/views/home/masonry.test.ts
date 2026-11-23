import { describe, expect, it } from 'vitest'
import { MASONRY_UNIT, columnCount, placeMasonry, rowSpan } from './masonry'

const item = (rows: number, wide = false) => ({ rows, wide })
const at = (p: ReturnType<typeof placeMasonry>) => p.map((x) => [x.column, x.row, x.columns])

describe('masonry math', () => {
  it('turns a height into rows, counting the gap, and never less than one', () => {
    expect(rowSpan(100, 16)).toBe(Math.ceil(116 / MASONRY_UNIT))
    expect(rowSpan(0, 16)).toBe(4)
    expect(rowSpan(-5, 0)).toBe(1)
    expect(rowSpan(Number.NaN, 8)).toBe(2)
    expect(rowSpan(101, 0, 4)).toBe(26)
  })

  it('counts the columns that fit, at least one', () => {
    expect(columnCount(1848, 380, 16)).toBe(4)
    expect(columnCount(776, 380, 16)).toBe(2)
    expect(columnCount(775, 380, 16)).toBe(1)
    expect(columnCount(360, 380, 16)).toBe(1)
    expect(columnCount(0, 380, 16)).toBe(1)
    expect(columnCount(Number.NaN, 380, 16)).toBe(1)
  })

  it('fills left to right when everything starts level', () => {
    expect(at(placeMasonry([item(10), item(10), item(10)], 3))).toEqual([[0, 0, 1], [1, 0, 1], [2, 0, 1]])
  })

  it('slides a short room up under a short room, not under a tall one', () => {
    // Austin (short), Back Entry (short), Basement (tall), Sitting Area (short) in 3 columns.
    const placed = placeMasonry([item(20), item(10), item(60), item(15)], 3)
    expect(at(placed)).toEqual([[0, 0, 1], [1, 0, 1], [2, 0, 1], [1, 10, 1]])
    // The fourth room goes under the shortest column (Back Entry), not past the tall one.
    expect(placed[3].row).toBe(10)
  })

  it('the Matt example: Back Entry under Austin, Work Area under Sitting Area', () => {
    // Order: Austin, Back Entry, Basement(tall), Sitting Area, Work Area, ...  in 4 columns.
    const rows = [30, 20, 90, 25, 40]
    const placed = placeMasonry(rows.map((r) => item(r)), 4)
    expect(placed[0]).toMatchObject({ column: 0, row: 0 })
    expect(placed[1]).toMatchObject({ column: 1, row: 0 })
    expect(placed[2]).toMatchObject({ column: 2, row: 0 })
    expect(placed[3]).toMatchObject({ column: 3, row: 0 })
    // Work Area goes into the shortest column, which is Back Entry's (20 rows), tying nothing.
    expect(placed[4]).toMatchObject({ column: 1, row: 20 })
  })

  it('ties go to the leftmost column', () => {
    expect(at(placeMasonry([item(10), item(10), item(5)], 2))).toEqual([[0, 0, 1], [1, 0, 1], [0, 10, 1]])
  })

  it('a wide room takes two side-by-side columns at the highest spot both are free', () => {
    const placed = placeMasonry([item(10), item(30), item(8, true)], 3)
    // Columns 0 and 1 end at 10 and 30; columns 1 and 2 end at 30 and 0. Best start is column 0 at row 30
    // versus column 1 at row 30: leftmost wins.
    expect(placed[2]).toMatchObject({ column: 0, columns: 2, row: 30 })
  })

  it('a wide room in one column is just a normal room', () => {
    expect(at(placeMasonry([item(10, true), item(10)], 1))).toEqual([[0, 0, 1], [0, 10, 1]])
  })

  it('later small rooms fill the gap a wide room leaves beside it', () => {
    // A is tall in column 0; B short in column 1. Wide W must start below A (row 40); the gap
    // under B (rows 10..40) is left behind, and a small room C drops into it.
    const placed = placeMasonry([item(40), item(10), item(10, true), item(12)], 2)
    expect(placed[2]).toMatchObject({ column: 0, columns: 2, row: 40 })
    expect(placed[3]).toMatchObject({ column: 1, row: 10 })
  })

  it('a room too tall for a gap goes below, not into it', () => {
    const placed = placeMasonry([item(40), item(10), item(10, true), item(40)], 2)
    expect(placed[3].row).toBeGreaterThanOrEqual(50)
  })

  it('never overlaps two rooms', () => {
    const rows = [23, 7, 61, 18, 33, 9, 44, 12, 27, 50, 5, 38]
    const wide = [false, false, true, false, false, true, false, false, false, false, false, true]
    for (const cols of [1, 2, 3, 4, 5]) {
      const placed = placeMasonry(rows.map((r, i) => item(r, wide[i])), cols)
      const cells = new Set<string>()
      for (const p of placed) {
        for (let c = p.column; c < p.column + p.columns; c++) {
          for (let r = p.row; r < p.row + p.rows; r++) {
            const key = `${c},${r}`
            expect(cells.has(key)).toBe(false)
            cells.add(key)
          }
        }
      }
    }
  })

  it('is deterministic', () => {
    const items = [item(23), item(7, true), item(61), item(18)]
    expect(placeMasonry(items, 3)).toEqual(placeMasonry(items, 3))
  })

  it('handles no rooms and a zero column count', () => {
    expect(placeMasonry([], 4)).toEqual([])
    expect(at(placeMasonry([item(5)], 0))).toEqual([[0, 0, 1]])
  })
})
