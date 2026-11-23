import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  DOODLE_COLORS,
  DOODLE_SIZES,
  addPoint,
  clearStrokes,
  paint,
  startStroke,
  undoStroke,
  type Stroke,
} from './doodle'

export function DoodlePad() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [color, setColor] = useState<string>(DOODLE_COLORS[0])
  const [size, setSize] = useState<(typeof DOODLE_SIZES)[number]>(DOODLE_SIZES[1])
  const drawing = useRef(false)
  strokesRef.current = strokes

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint(ctx, strokesRef.current, rect.width, rect.height)
    }

    resize()
    window.addEventListener('resize', resize)
    const Observer = typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver
    const observer = Observer ? new Observer(resize) : null
    observer?.observe(canvas)
    return () => {
      window.removeEventListener('resize', resize)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    paint(ctx, strokes, rect.width, rect.height)
  }, [strokes])

  function pointFrom(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    const point = pointFrom(event)
    setStrokes((current) => startStroke(current, color, size, point))
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const point = pointFrom(event)
    setStrokes((current) => addPoint(current, point))
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawing.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="doodle">
      <div className="doodle__tools">
        <div className="doodle__colors" role="group" aria-label="Colour">
          {DOODLE_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              className="doodle__swatch"
              data-on={color === value}
              aria-label={`Colour ${value}`}
              style={{ background: value }}
              onClick={() => setColor(value)}
            />
          ))}
        </div>
        <div className="doodle__sizes" role="group" aria-label="Brush size">
          {DOODLE_SIZES.map((value) => (
            <button
              key={value}
              type="button"
              className="doodle__size"
              data-on={size === value}
              aria-label={`Brush size ${value}`}
              onClick={() => setSize(value)}
            >
              <span style={{ width: value, height: value }} />
            </button>
          ))}
        </div>
        <button type="button" className="doodle__action" onClick={() => setStrokes((s) => undoStroke(s))}>
          Undo
        </button>
        <button type="button" className="doodle__action" onClick={() => setStrokes(clearStrokes())}>
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="doodle__canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}
