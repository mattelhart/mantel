import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { authedUrl } from '../../api/client'
import {
  DOODLE_CHUNKY_SIZE,
  DOODLE_COLORS,
  DOODLE_SIZES,
  addPoint,
  clearStrokes,
  exportPng,
  paint,
  startStroke,
  undoStroke,
  type Stroke,
} from './doodle'

export interface DoodleSurfaceHandle {
  exportPng: () => string
  isEmpty: () => boolean
}

export const DoodleSurface = forwardRef<
  DoodleSurfaceHandle,
  {
    backgroundSrc?: string | null
    extraTools?: ReactNode
    children?: ReactNode
    onEmptyChange?: (empty: boolean) => void
    /** Hide brush-size buttons and use a chunky brush. Better for a quick drawing from Messages. */
    simpleTools?: boolean
  }
>(function DoodleSurface({ backgroundSrc, extraTools, children, onEmptyChange, simpleTools = false }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const backgroundRef = useRef<CanvasImageSource | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [background, setBackground] = useState<HTMLImageElement | null>(null)
  const [color, setColor] = useState<string>(DOODLE_COLORS[0])
  const [size, setSize] = useState<(typeof DOODLE_SIZES)[number]>(DOODLE_CHUNKY_SIZE)
  const [eraser, setEraser] = useState(false)
  const drawing = useRef(false)
  strokesRef.current = strokes
  backgroundRef.current = background

  const empty = strokes.length === 0 && !background
  useEffect(() => {
    onEmptyChange?.(empty)
  }, [empty, onEmptyChange])

  useEffect(() => {
    if (!backgroundSrc) {
      setBackground(null)
      return
    }
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) setBackground(image)
    }
    image.onerror = () => {
      if (!cancelled) setBackground(null)
    }
    image.src = authedUrl(backgroundSrc)
    return () => {
      cancelled = true
    }
  }, [backgroundSrc])

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
      paint(ctx, strokesRef.current, rect.width, rect.height, backgroundRef.current)
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
    paint(ctx, strokes, rect.width, rect.height, background)
  }, [strokes, background])

  useImperativeHandle(ref, () => ({
    exportPng: () => {
      const canvas = canvasRef.current
      return canvas ? exportPng(canvas) : ''
    },
    isEmpty: () => strokesRef.current.length === 0 && !backgroundRef.current,
  }))

  function pointFrom(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drawing.current = true
    const point = pointFrom(event)
    const brush = simpleTools ? DOODLE_CHUNKY_SIZE : size
    setStrokes((current) => startStroke(current, color, brush, point, eraser))
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const point = pointFrom(event)
    setStrokes((current) => addPoint(current, point))
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawing.current = false
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function pickColor(value: string) {
    setColor(value)
    setEraser(false)
  }

  return (
    <div className={simpleTools ? 'doodle doodle--simple' : 'doodle'}>
      <div className="doodle__tools">
        <div className="doodle__colors" role="group" aria-label="Colour">
          {DOODLE_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              className="doodle__swatch"
              data-on={!eraser && color === value}
              aria-label={`Colour ${value}`}
              style={{ background: value }}
              onClick={() => pickColor(value)}
            />
          ))}
        </div>
        {!simpleTools && (
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
        )}
        <button
          type="button"
          className="doodle__action doodle__action--eraser"
          data-on={eraser}
          aria-pressed={eraser}
          onClick={() => setEraser((on) => !on)}
        >
          Eraser
        </button>
        <button type="button" className="doodle__action" onClick={() => setStrokes((s) => undoStroke(s))}>
          Undo
        </button>
        <button type="button" className="doodle__action" onClick={() => setStrokes(clearStrokes())}>
          Clear
        </button>
        {extraTools}
      </div>
      <canvas
        ref={canvasRef}
        className="doodle__canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {children}
    </div>
  )
})
