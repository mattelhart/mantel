import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { GhostBox } from './useDragSort'

/** The floating copy of whatever is being dragged. It lives on <body>, so no card's
 *  overflow or stacking can clip it, ignores the pointer, and is moved by the drag hook
 *  directly (no React render per pointer move). */
export function DragGhost({
  ghost,
  ghostRef,
  children,
}: {
  ghost: GhostBox | null
  ghostRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  if (!ghost || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={ghostRef}
      className="home-drag-ghost"
      aria-hidden="true"
      data-testid="drag-ghost"
      style={{ left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height }}
    >
      {children}
    </div>,
    document.body,
  )
}
