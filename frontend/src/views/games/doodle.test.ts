import { describe, expect, it } from 'vitest'
import { addPoint, clearStrokes, containRect, startStroke, undoStroke } from './doodle'

describe('doodle pad', () => {
  it('records a stroke, ignores a duplicate point, and undoes the last stroke', () => {
    let strokes = startStroke([], '#c0392b', 12, { x: 1, y: 1 })
    strokes = addPoint(strokes, { x: 4, y: 6 })
    strokes = addPoint(strokes, { x: 4, y: 6 })
    expect(strokes).toHaveLength(1)
    expect(strokes[0].points).toEqual([
      { x: 1, y: 1 },
      { x: 4, y: 6 },
    ])
    expect(strokes[0].color).toBe('#c0392b')
    expect(strokes[0].size).toBe(12)
    expect(strokes[0].erase).toBe(false)

    strokes = startStroke(strokes, '#2980b9', 6, { x: 8, y: 8 })
    expect(strokes).toHaveLength(2)
    strokes = undoStroke(strokes)
    expect(strokes).toHaveLength(1)
    expect(strokes[0].color).toBe('#c0392b')
    expect(undoStroke([])).toEqual([])
    expect(clearStrokes()).toEqual([])
    expect(addPoint([], { x: 1, y: 1 })).toEqual([])
  })

  it('records an eraser stroke separately from ink', () => {
    let strokes = startStroke([], '#1c2430', 22, { x: 2, y: 2 })
    strokes = startStroke(strokes, '#1c2430', 22, { x: 8, y: 8 }, true)
    expect(strokes).toHaveLength(2)
    expect(strokes[0].erase).toBe(false)
    expect(strokes[1].erase).toBe(true)
    expect(strokes[1].points).toEqual([{ x: 8, y: 8 }])
  })

  it('letterboxes an image inside a box without stretching', () => {
    expect(containRect(200, 100, 200, 200)).toEqual({ x: 0, y: 50, width: 200, height: 100 })
    expect(containRect(100, 200, 200, 200)).toEqual({ x: 50, y: 0, width: 100, height: 200 })
    expect(containRect(0, 0, 100, 80)).toEqual({ x: 0, y: 0, width: 100, height: 80 })
  })
})
