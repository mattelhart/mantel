import { useRef, type PointerEvent } from 'react'

const MIN_DISTANCE = 60
const MAX_OFF_AXIS = 80

/** Horizontal swipe to move through dates. Deliberately ignores mostly-vertical drags so
 *  scrolling a day column never changes the date.
 *
 *  Pointer events, not touch events: a mouse drag on a TV is the same gesture as a
 *  finger. Capture only once the drag is clearly horizontal, so a vertical drag can
 *  still scroll the day, and so releasing outside the page still counts. */
export function useSwipe(onSwipe: (direction: 1 | -1) => void) {
  const origin = useRef<{ x: number; y: number; id: number } | null>(null)

  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const target = e.target instanceof Element ? e.target : null
      // A drag that starts in a field is someone selecting text, not turning the page.
      if (target?.closest('input, textarea, select')) return
      origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    },
    onPointerMove: (e: PointerEvent) => {
      const from = origin.current
      if (!from || e.pointerId !== from.id) return
      const dx = e.clientX - from.x
      const dy = e.clientY - from.y
      if (Math.hypot(dx, dy) < 8) return
      if (Math.abs(dy) > Math.abs(dx)) {
        origin.current = null
        return
      }
      const node = e.currentTarget as HTMLElement
      if (!node.hasPointerCapture(e.pointerId)) node.setPointerCapture(e.pointerId)
    },
    onPointerUp: (e: PointerEvent) => {
      const from = origin.current
      origin.current = null
      if (!from || e.pointerId !== from.id) return
      const dx = e.clientX - from.x
      const dy = e.clientY - from.y
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dy) > MAX_OFF_AXIS) return
      onSwipe(dx < 0 ? 1 : -1)
    },
    onPointerCancel: () => {
      origin.current = null
    },
  }
}
