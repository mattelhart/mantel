type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

export function pushDirection(before: Box, after: Box, homie: Box) {
  const cx = (homie.left + homie.right) / 2
  const cy = (homie.top + homie.bottom) / 2
  const hitsY = after.bottom >= homie.top - 4 && after.top <= homie.bottom + 4
  const hitsX = after.right >= homie.left - 4 && after.left <= homie.right + 4
  if (hitsY && before.right <= cx && after.right >= homie.left - 4 && after.right - before.right >= 4) return 'right'
  if (hitsY && before.left >= cx && after.left <= homie.right + 4 && before.left - after.left >= 4) return 'left'
  if (hitsX && before.bottom <= cy && after.bottom >= homie.top - 4 && after.bottom - before.bottom >= 4) return 'down'
  if (hitsX && before.top >= cy && after.top <= homie.bottom + 4 && before.top - after.top >= 4) return 'up'
  return null
}

export type Push = NonNullable<ReturnType<typeof pushDirection>>

export type Reaction = { direction: Push; kind: 'breeze' | 'roll' }

export function movementReaction(before: Box, after: Box, body: Box): Reaction | null {
  const light = Math.max(before.right - before.left, before.bottom - before.top) <= 40
  if (!light) {
    const direction = pushDirection(before, after, body)
    return direction && { direction, kind: 'roll' }
  }
  // Nearest point on the icon's trajectory. A small icon can brush past a cap
  // without its rectangle ever touching the character.
  const x = (before.left + before.right) / 2, y = (before.top + before.bottom) / 2
  const dx = (after.left + after.right) / 2 - x, dy = (after.top + after.bottom) / 2 - y
  const distance = Math.hypot(dx, dy)
  if (distance < 6) return null
  const cx = (body.left + body.right) / 2, cy = (body.top + body.bottom) / 2
  const progress = ((cx - x) * dx + (cy - y) * dy) / (distance * distance)
  if (progress <= 0) return null
  const t = Math.min(progress, 1)
  if (Math.abs(x + t * dx - cx) > (body.right-body.left)/2 + 22
      || Math.abs(y + t * dy - cy) > (body.bottom-body.top)/2 + 22) return null
  const direction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
  return { direction, kind: 'breeze' }
}

// Sample only during an interaction. Keep the original bounds so slow CSS transitions
// and small per-frame movements can build up to a perceptible nudge.
export function watchForPush(button: HTMLButtonElement, onPush: (reaction: Reaction, origin: DOMRect) => void) {
  const origin = button.getBoundingClientRect()
  if (!origin.width || !origin.height || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const body = button.querySelector('.homie-gnome')!.getBoundingClientRect()
  const neighbours = Array.from(document.querySelectorAll('button, a[href], [role="button"], svg, img, [role="img"]'))
    .filter(el => !el.closest('.homie-yard'))
    .map(el => ({ el, before: el.getBoundingClientRect() }))
    .filter(({ before: r }) => r.width && r.height && r.right >= body.left - 120 && r.left <= body.right + 120
      && r.bottom >= body.top - 120 && r.top <= body.bottom + 120)
  if (!neighbours.length) return
  const until = performance.now() + 500
  let frame = requestAnimationFrame(check)
  function check() {
    for (const { el, before } of neighbours) {
      if (!el.isConnected) continue
      const after = el.getBoundingClientRect()
      if (!after.width || !after.height) continue
      // Treat an icon travelling with its enclosing button as part of that button.
      const owner = el.parentElement?.closest('button, a[href], [role="button"]')
      const parent = owner && neighbours.find(n => n.el === owner)
      if (parent) {
        const rect = parent.el.getBoundingClientRect()
        if (Math.abs(rect.left - parent.before.left) + Math.abs(rect.top - parent.before.top) >= 3) continue
      }
      const reaction = movementReaction(before, after, body)
      if (reaction) { onPush(reaction, origin); return }
    }
    if (performance.now() < until) frame = requestAnimationFrame(check)
  }
  return () => cancelAnimationFrame(frame)
}
