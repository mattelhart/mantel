import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  AUTOSCROLL_MAX_PX,
  DRAG_HOLD_MS,
  DRAG_HOLD_SLOP_PX,
  DRAG_START_PX,
  REORDER_COOLDOWN_MS,
  autoScrollDelta,
  hitTest,
  reorderOver,
} from './dragSort'

export interface GhostBox {
  id: string
  left: number
  top: number
  width: number
  height: number
}

interface Session {
  id: string
  pointerId: number
  grip: boolean
  touch: boolean
  startX: number
  startY: number
  x: number
  y: number
  started: boolean
  el: HTMLElement
  order: string[]
  lastReorderAt: number
  timer: number | null
  raf: number | null
  scroller: HTMLElement | null
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [role=slider]'

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const overflow = getComputedStyle(n).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

/** Drag to reorder a group of items with pointer events, so it works the same with a
 *  finger on the Pi's touchscreen, a phone and a mouse (HTML5 drag and drop does not do
 *  touch). Put `itemProps(id)` on each item's root and `data-drag-grip` on a handle inside.
 *
 *  - A grip drags as soon as it moves a few pixels (give it `touch-action: none`).
 *  - Pressing anywhere else on an item that is not a button drags too: a mouse after a few
 *    pixels, a finger after a short hold, so scrolling by touch still works.
 *  - While dragging, `order` is the live order (the item under the pointer trades places
 *    with the dragged one), the page auto-scrolls near its top and bottom edges, and `ghost`
 *    describes the floating copy for `<DragGhost>`.
 *  - Letting go commits the new order; Escape or a cancelled pointer puts everything back. */
export function useDragSort({
  group,
  ids,
  onCommit,
  disabled = false,
}: {
  group: string
  ids: string[]
  onCommit: (ids: string[]) => void
  disabled?: boolean
}) {
  const [live, setLive] = useState<{ id: string; order: string[]; ghost: GhostBox } | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const session = useRef<Session | null>(null)
  const latest = useRef({ ids, onCommit, group })
  latest.current = { ids, onCommit, group }
  const teardown = useRef<() => void>(() => {})

  const boxes = useCallback(() => {
    const out: { id: string; box: { left: number; top: number; right: number; bottom: number } }[] = []
    document.querySelectorAll<HTMLElement>('[data-drag-id]').forEach((el) => {
      if (el.dataset.dragGroup !== latest.current.group) return
      const r = el.getBoundingClientRect()
      out.push({ id: el.dataset.dragId!, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
    })
    return out
  }, [])

  const placeGhost = useCallback(() => {
    const s = session.current
    const g = ghostRef.current
    if (s?.started && g) g.style.transform = `translate(${s.x - s.startX}px, ${s.y - s.startY}px)`
  }, [])

  const update = useCallback(() => {
    const s = session.current
    if (!s?.started) return
    placeGhost()
    const over = hitTest(boxes(), s.id, s.x, s.y)
    if (over && Date.now() - s.lastReorderAt >= REORDER_COOLDOWN_MS) {
      const next = reorderOver(s.order, s.id, over)
      if (next !== s.order) {
        s.order = next
        s.lastReorderAt = Date.now()
        setLive((cur) => (cur ? { ...cur, order: next } : cur))
      }
    }
  }, [boxes, placeGhost])

  const finish = useCallback((commit: boolean) => {
    const s = session.current
    session.current = null
    teardown.current()
    teardown.current = () => {}
    if (!s) return
    document.body.classList.remove('home-dragging')
    if (s.timer !== null) window.clearTimeout(s.timer)
    if (s.raf !== null) window.cancelAnimationFrame(s.raf)
    setLive(null)
    if (commit && s.started && s.order.join('\n') !== latest.current.ids.join('\n')) {
      latest.current.onCommit(s.order)
    }
  }, [])

  const begin = useCallback(() => {
    const s = session.current
    if (!s || s.started) return
    s.started = true
    if (s.timer !== null) window.clearTimeout(s.timer)
    s.timer = null
    s.scroller = scrollParent(s.el)
    const r = s.el.getBoundingClientRect()
    s.order = [...latest.current.ids]
    document.body.classList.add('home-dragging')
    setLive({ id: s.id, order: s.order, ghost: { id: s.id, left: r.left, top: r.top, width: r.width, height: r.height } })
    const tick = () => {
      const cur = session.current
      if (!cur?.started) return
      const sc = cur.scroller
      if (sc) {
        const isRoot = sc === document.scrollingElement || sc === document.documentElement || sc === document.body
        const top = isRoot ? 0 : sc.getBoundingClientRect().top
        const bottom = isRoot ? window.innerHeight : sc.getBoundingClientRect().bottom
        const delta = autoScrollDelta(cur.y, top, bottom, undefined, AUTOSCROLL_MAX_PX)
        if (delta) {
          sc.scrollTop += delta
          update()
        }
      }
      cur.raf = window.requestAnimationFrame(tick)
    }
    s.raf = window.requestAnimationFrame(tick)
  }, [update])

  const onPointerDown = useCallback(
    (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || session.current) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const target = event.target as HTMLElement
      const grip = !!target.closest('[data-drag-grip]')
      if (!grip && target.closest(INTERACTIVE)) return
      // An item inside another (a tile in a room) is dragged by itself, not by its room.
      event.stopPropagation()

      const touch = event.pointerType !== 'mouse'
      const s: Session = {
        id,
        pointerId: event.pointerId,
        grip,
        touch,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        started: false,
        el: event.currentTarget,
        order: [...latest.current.ids],
        lastReorderAt: 0,
        timer: null,
        raf: null,
        scroller: null,
      }
      session.current = s

      const move = (e: PointerEvent) => {
        const cur = session.current
        if (!cur || e.pointerId !== cur.pointerId) return
        cur.x = e.clientX
        cur.y = e.clientY
        const moved = Math.hypot(cur.x - cur.startX, cur.y - cur.startY)
        if (!cur.started) {
          if (cur.touch && !cur.grip) {
            // Not held long enough yet: this finger is scrolling the page.
            if (moved > DRAG_HOLD_SLOP_PX) finish(false)
          } else if (moved > DRAG_START_PX) {
            begin()
            update()
          }
          return
        }
        e.preventDefault()
        update()
      }
      const up = (e: PointerEvent) => {
        if (session.current && e.pointerId === session.current.pointerId) finish(true)
      }
      const cancel = (e: PointerEvent) => {
        if (session.current && e.pointerId === session.current.pointerId) finish(false)
      }
      // Once a drag has begun a finger must not also scroll the page.
      const touchMove = (e: TouchEvent) => {
        if (session.current?.started && e.cancelable) e.preventDefault()
      }
      const key = (e: KeyboardEvent) => {
        if (e.key === 'Escape') finish(false)
      }
      const menu = (e: Event) => {
        if (session.current) e.preventDefault()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('touchmove', touchMove, { passive: false })
      window.addEventListener('keydown', key)
      window.addEventListener('contextmenu', menu)
      teardown.current = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('touchmove', touchMove)
        window.removeEventListener('keydown', key)
        window.removeEventListener('contextmenu', menu)
      }

      if (touch && !grip) s.timer = window.setTimeout(begin, DRAG_HOLD_MS)
    },
    [begin, disabled, finish, update],
  )

  // The floating copy appears one render after the drag begins; put it under the pointer.
  useLayoutEffect(placeGhost, [live?.id, placeGhost])

  // Leaving the page (or Edit mode) mid-drag must not leave listeners or a body class behind.
  useEffect(() => () => finish(false), [finish])
  useEffect(() => {
    if (disabled) finish(false)
  }, [disabled, finish])

  return {
    /** The order to render: live while dragging, otherwise the committed one. */
    order: live?.order ?? ids,
    dragId: live?.id ?? null,
    ghost: live?.ghost ?? null,
    ghostRef,
    itemProps: (id: string) => ({
      'data-drag-group': group,
      'data-drag-id': id,
      onPointerDown: onPointerDown(id),
    }),
  }
}
