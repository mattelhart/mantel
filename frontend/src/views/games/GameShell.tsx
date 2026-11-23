import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Chrome around a game: a large Back button, a title, and an optional left
 *  gutter so a swipe from the edge is not swallowed by the game. */
export function GameShell({
  title,
  swipe,
  children,
}: {
  title: string
  swipe?: boolean
  children: ReactNode
}) {
  return (
    <div className="gameplay" data-swipe={swipe ? 'true' : undefined}>
      <header className="gameplay__bar">
        <Link to="/games" className="gameplay__back">
          <span aria-hidden>◀</span> Back
        </Link>
        <h1 className="gameplay__title">{title}</h1>
      </header>
      <div className="gameplay__stage">
        {swipe ? <div className="gameplay__gutter" aria-hidden="true" /> : null}
        <div className="gameplay__body">{children}</div>
      </div>
    </div>
  )
}

/** Vendored game, loaded same-origin in a sandboxed iframe. */
export function GameFrame({ title, src, swipe }: { title: string; src: string; swipe?: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const relay = () => {
      window.dispatchEvent(new Event('pointerdown'))
    }

    const attach = () => {
      const child = frame.contentWindow
      if (!child) return
      for (const event of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel']) {
        child.addEventListener(event, relay, { passive: true })
      }
    }

    frame.addEventListener('load', attach)
    attach()
    return () => frame.removeEventListener('load', attach)
  }, [src])

  return (
    <GameShell title={title} swipe={swipe}>
      <iframe
        ref={frameRef}
        className="gameplay__frame"
        title={title}
        src={src}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
      />
    </GameShell>
  )
}
