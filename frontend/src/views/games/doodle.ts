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

/** Fit an image inside a box without stretching, letterboxed in the centre. */
export function containRect(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (imageWidth <= 0 || imageHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { x: 0, y: 0, width: Math.max(0, boxWidth), height: Math.max(0, boxHeight) }
  }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height }
}

function imageSize(image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }
  }
  if (image instanceof HTMLCanvasElement) {
    return { width: image.width, height: image.height }
  }
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    return { width: image.width, height: image.height }
  }
  return { width: 0, height: 0 }
}

/** Redraw an optional background and every stroke onto a 2D canvas. */
export function paint(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  width: number,
  height: number,
  background?: CanvasImageSource | null,
) {
  ctx.clearRect(0, 0, width, height)
  if (background) {
    const size = imageSize(background)
    const box = containRect(size.width, size.height, width, height)
    ctx.drawImage(background, box.x, box.y, box.width, box.height)
  }
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

/** Flatten the visible canvas onto a white background as a PNG data URL. */
export function exportPng(source: HTMLCanvasElement): string {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d')
  if (!ctx || out.width === 0 || out.height === 0) return ''
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(source, 0, 0)
  return out.toDataURL('image/png')
}
