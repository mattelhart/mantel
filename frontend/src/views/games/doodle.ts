export interface Point {
  x: number
  y: number
}

export interface Stroke {
  color: string
  size: number
  points: Point[]
}

export const DOODLE_COLORS = [
  '#1c2430',
  '#c0392b',
  '#d35400',
  '#f1c40f',
  '#27ae60',
  '#2980b9',
  '#8e44ad',
  '#ffffff',
] as const

export const DOODLE_SIZES = [6, 12, 22, 36] as const

export function startStroke(strokes: Stroke[], color: string, size: number, point: Point): Stroke[] {
  return [...strokes, { color, size, points: [point] }]
}

export function addPoint(strokes: Stroke[], point: Point): Stroke[] {
  if (strokes.length === 0) return strokes
  const last = strokes[strokes.length - 1]
  const prev = last.points[last.points.length - 1]
  if (prev && prev.x === point.x && prev.y === point.y) return strokes
  return [...strokes.slice(0, -1), { ...last, points: [...last.points, point] }]
}

export function undoStroke(strokes: Stroke[]): Stroke[] {
  if (strokes.length === 0) return strokes
  return strokes.slice(0, -1)
}

export function clearStrokes(): Stroke[] {
  return []
}

/** Redraw every stroke onto a 2D canvas. Used by the pad and by tests. */
export function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = stroke.size
    const first = stroke.points[0]
    if (stroke.points.length === 1) {
      ctx.beginPath()
      ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
    }
    ctx.stroke()
  }
}
