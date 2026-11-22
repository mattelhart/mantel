import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MASONRY_UNIT, columnCount, placeMasonry, rowSpan } from './masonry'

export interface MasonryEntry {
  key: string
  wide?: boolean
  node: ReactNode
}

const MIN_COLUMN_PX = 380
const GAP_PX = 16

/** Rooms packed tightly: each card is measured and placed in the highest free spot, in the
 *  order given. Re-measures when the page resizes and when a card's height changes (a
 *  device turning on, a name wrapping, a tile hidden). The DOM keeps the given order, so
 *  Tab and D-pad focus walk the rooms in the order the family arranged them. */
export function MasonryGrid({ entries }: { entries: MasonryEntry[] }) {
  const root = useRef<HTMLDivElement | null>(null)
  const cells = useRef(new Map<string, HTMLDivElement>())
  const [columns, setColumns] = useState(1)
  const [heights, setHeights] = useState<Record<string, number>>({})

  const measure = useCallback(() => {
    const el = root.current
    if (!el) return
    const nextColumns = columnCount(el.clientWidth, MIN_COLUMN_PX, GAP_PX)
    setColumns((c) => (c === nextColumns ? c : nextColumns))
    setHeights((prev) => {
      const next: Record<string, number> = {}
      let changed = false
      for (const [key, cell] of cells.current) {
        const h = cell.offsetHeight
        next[key] = h
        if (prev[key] !== h) changed = true
      }
      if (Object.keys(prev).length !== Object.keys(next).length) changed = true
      return changed ? next : prev
    })
  }, [])

  // Measure before the browser paints, so the first frame is already packed.
  useLayoutEffect(measure)

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    observer?.observe(el)
    for (const cell of cells.current.values()) observer?.observe(cell)
    return () => {
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [measure, entries.map((e) => e.key).join('|')])

  const placed = useMemo(
    () =>
      placeMasonry(
        entries.map((e) => ({ rows: rowSpan(heights[e.key] ?? 0, GAP_PX), wide: !!e.wide })),
        columns,
      ),
    [entries, heights, columns],
  )

  return (
    <div
      ref={root}
      className="home__rooms"
      data-columns={columns}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: `${MASONRY_UNIT}px`,
        columnGap: GAP_PX,
      }}
    >
      {entries.map((entry, i) => {
        const p = placed[i]
        return (
          <div
            key={entry.key}
            ref={(node) => {
              if (node) cells.current.set(entry.key, node)
              else cells.current.delete(entry.key)
            }}
            className="home-masonry__cell"
            data-cell={entry.key}
            style={{
              gridColumn: `${p.column + 1} / span ${p.columns}`,
              gridRow: `${p.row + 1} / span ${p.rows}`,
            }}
          >
            {entry.node}
          </div>
        )
      })}
    </div>
  )
}
