import { describe, expect, it } from 'vitest'
import { AUTOSCROLL_EDGE_PX, AUTOSCROLL_MAX_PX, arrayMove, autoScrollDelta, hitTest, reorderOver, sortByOrder } from './dragSort'

const box = (left: number, top: number, w = 100, h = 100) => ({ left, top, right: left + w, bottom: top + h })

describe('drag math', () => {
  it('moves an item from one place to another', () => {
    expect(arrayMove(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(arrayMove(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    const same = ['a', 'b']
    expect(arrayMove(same, 1, 1)).toBe(same)
    expect(arrayMove(same, 5, 0)).toBe(same)
    expect(arrayMove(same, 0, -1)).toBe(same)
  })

  it('finds the item under the pointer, never the one being dragged', () => {
    const boxes = [
      { id: 'a', box: box(0, 0) },
      { id: 'b', box: box(110, 0) },
      { id: 'c', box: box(0, 110) },
    ]
    expect(hitTest(boxes, 'a', 150, 50)).toBe('b')
    expect(hitTest(boxes, 'b', 50, 50)).toBe('a')
    expect(hitTest(boxes, 'a', 50, 50)).toBeNull() // over itself
    expect(hitTest(boxes, 'a', 105, 50)).toBeNull() // in the gap
    expect(hitTest(boxes, 'a', 50, 150)).toBe('c')
    expect(hitTest(boxes, 'a', 900, 900)).toBeNull()
  })

  it('drops onto another item\'s place, before or after depending on where it came from', () => {
    expect(reorderOver(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(reorderOver(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    const same = ['a', 'b']
    expect(reorderOver(same, 'a', 'zzz')).toBe(same)
    expect(reorderOver(same, 'zzz', 'a')).toBe(same)
  })

  it('scrolls near the edges, faster the closer, and not in the middle', () => {
    expect(autoScrollDelta(500, 0, 1000)).toBe(0)
    expect(autoScrollDelta(0, 0, 1000)).toBe(-AUTOSCROLL_MAX_PX)
    expect(autoScrollDelta(1000, 0, 1000)).toBe(AUTOSCROLL_MAX_PX)
    expect(autoScrollDelta(-50, 0, 1000)).toBe(-AUTOSCROLL_MAX_PX)
    const near = autoScrollDelta(AUTOSCROLL_EDGE_PX - 10, 0, 1000)
    const nearer = autoScrollDelta(10, 0, 1000)
    expect(near).toBeLessThan(0)
    expect(nearer).toBeLessThan(near)
    expect(autoScrollDelta(AUTOSCROLL_EDGE_PX, 0, 1000)).toBe(0)
  })

  it('applies an order, with anything that arrived mid-drag at the end', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const id = (x: { id: string }) => x.id
    expect(sortByOrder(items, id, ['c', 'a', 'b']).map(id)).toEqual(['c', 'a', 'b'])
    expect(sortByOrder(items, id, ['c', 'a']).map(id)).toEqual(['c', 'a', 'b'])
    expect(sortByOrder(items, id, ['c', 'gone', 'a', 'b']).map(id)).toEqual(['c', 'a', 'b'])
    expect(sortByOrder(items, id, null)).toBe(items)
  })
})
