/* Masonry placement for the Home rooms. Pure, so it is tested without a browser.
 *
 * The page is a CSS grid with tiny implicit rows. Each card is measured, turned into a
 * number of rows, and placed explicitly: in the user's saved order, each card goes in the
 * highest spot (leftmost on a tie) where it fits, so a short room slides up under another
 * short room instead of waiting for a tall neighbour. A wide room needs two side-by-side
 * columns. Nothing here reorders anything: the DOM keeps the saved order. */

/** Height of one implicit grid row, in px. Smaller is tighter, larger is cheaper. */
export const MASONRY_UNIT = 4

/** How many rows a card of `height` px takes, counting the gap below it. */
export function rowSpan(height: number, gap: number, unit = MASONRY_UNIT): number {
  const h = Number.isFinite(height) && height > 0 ? height : 0
  return Math.max(1, Math.ceil((h + gap) / unit))
}

/** How many columns of at least `minColumn` px fit in `width`, never fewer than one. */
export function columnCount(width: number, minColumn: number, gap: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1
  return Math.max(1, Math.floor((width + gap) / (minColumn + gap)))
}

export interface MasonryItem {
  rows: number
  wide: boolean
}

export interface Placement {
  /** 0-based first column. */
  column: number
  /** Columns taken: 2 for a wide room when there are two or more columns, else 1. */
  columns: number
  /** 0-based first row. */
  row: number
  rows: number
}

/** Place every item, in order, at the highest free spot. */
export function placeMasonry(items: MasonryItem[], columns: number): Placement[] {
  const cols = Math.max(1, Math.floor(columns))
  const taken: boolean[][] = Array.from({ length: cols }, () => [])
  /** First taken row of column c in [from, from + rows), or -1 when the span is free. */
  const blockedAt = (c: number, from: number, rows: number) => {
    for (let r = from; r < from + rows; r++) if (taken[c][r]) return r
    return -1
  }
  /** Lowest row at which columns c .. c+span-1 are all free for `rows` rows. */
  const firstFit = (c: number, span: number, rows: number) => {
    let y = 0
    for (;;) {
      let moved = false
      for (let k = 0; k < span; k++) {
        const hit = blockedAt(c + k, y, rows)
        if (hit < 0) continue
        // Jump past the run that blocked us instead of crawling a row at a time.
        let next = hit
        while (taken[c + k][next]) next++
        y = next
        moved = true
        break
      }
      if (!moved) return y
    }
  }

  return items.map((item) => {
    const span = item.wide && cols >= 2 ? 2 : 1
    const rows = Math.max(1, Math.floor(item.rows))
    let best = { column: 0, row: Number.POSITIVE_INFINITY }
    for (let c = 0; c + span <= cols; c++) {
      const row = firstFit(c, span, rows)
      if (row < best.row) best = { column: c, row }
    }
    for (let k = 0; k < span; k++) {
      for (let r = best.row; r < best.row + rows; r++) taken[best.column + k][r] = true
    }
    return { column: best.column, columns: span, row: best.row, rows }
  })
}
