import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useDismissGuard } from './dismissGuard'

export function TouchSheet({ title, children, onClose }: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const panel = useRef<HTMLDialogElement>(null)
  const guard = useDismissGuard({ dirty: false, onClose })
  useLayoutEffect(() => {
    const dialog = panel.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog className="touch-sheet" ref={panel} aria-label={title} {...guard.backdropProps}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="touch-sheet__body">
      <header><h2>{title}</h2><button className="btn" onClick={onClose}>Close</button></header>
      {children}
    </div>
  </dialog>
}
