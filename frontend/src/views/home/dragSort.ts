/* The math behind drag-to-reorder. Pure, so it is tested without a browser; the pointer
 * handling that uses it is in useDragSort.ts. */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Hold this long (touch) before a press on a card's body turns into a drag. */
export const DRAG_HOLD_MS = 350
/** A finger that moves this far before the hold is up is scrolling, not dragging. */
export const DRAG_HOLD_SLOP_PX = 8
/** A mouse or a grip starts a drag after this much movement, so a click stays a click. */
export const DRAG_START_PX = 4
/** Dragging within this distance of the top or bottom edge scrolls the page. */
export const AUTOSCROLL_EDGE_PX = 90
/** Fastest auto-scroll, in px per frame. */
export const AUTOSCROLL_MAX_PX = 24
/** After a reorder, wait this long (ms) before another, so the layout can settle. */
export const REORDER_COOLDOWN_MS = 120

export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** The item under the pointer, other than the one being dragged. */
export function hitTest(boxes: { id: string; box: Box }[], dragId: string, x: number, y: number): string | null {
  for (const { id, box } of boxes) {
    if (id === dragId) continue
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return id
  }
  return null
}

/** The order after the dragged item is dropped onto `overId`'s place. */
export function reorderOver(order: string[], dragId: string, overId: string): string[] {
  const from = order.indexOf(dragId)
  const to = order.indexOf(overId)
  if (from < 0 || to < 0) return order
  return arrayMove(order, from, to)
}

/** px to scroll this frame (negative is up): zero in the middle, faster nearer the edge. */
export function autoScrollDelta(
  y: number,
  top: number,
  bottom: number,
  edge = AUTOSCROLL_EDGE_PX,
  max = AUTOSCROLL_MAX_PX,
): number {
  if (y < top + edge) return -Math.round(max * Math.min(1, (top + edge - y) / edge))
  if (y > bottom - edge) return Math.round(max * Math.min(1, (y - (bottom - edge)) / edge))
  return 0
}

/** Put `items` in `order`; anything not in `order` (it arrived mid-drag) goes last. */
export function sortByOrder<T>(items: T[], idOf: (item: T) => string, order: string[] | null | undefined): T[] {
  if (!order) return items
  const rank = new Map(order.map((id, i) => [id, i]))
  const known = items.filter((i) => rank.has(idOf(i))).sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!)
  return [...known, ...items.filter((i) => !rank.has(idOf(i)))]
}
