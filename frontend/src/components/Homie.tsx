import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { watchForPush, type Reaction } from './homiePush'
import { findHomieSpot } from './homieSpace'
import './homie.css'

// Capture the launch option before the router replaces the kiosk start URL.
const choice = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('companion')
export const showHomie = choice === null
  ? typeof sessionStorage !== 'undefined' && sessionStorage.getItem('homie.companion') === '1'
  : choice === '1'
if (choice !== null) sessionStorage.setItem('homie.companion', showHomie ? '1' : '0')

export const outingInterval = 28000
const outings = ['bike', 'plane', 'garden', 'chase', 'visitor', 'swipe', 'nudge', 'sweep'] as const

type Props = {
  job?: { name: string; title: string }
  onChores?: () => void
  onDeliver?: () => void
  mailFrom?: string
  holiday?: string
  star?: { name: string; color: string; earned: number }
}

export function Homie({ onDeliver, mailFrom, star, holiday, job, onChores }: Props) {
  const invitation = mailFrom ? "I've got mail from " + mailFrom + "!" : "Say hello to Homie"
  const congrats = star && "Nice work, " + star.name + "! +" + star.earned + " ★"
  const [right, setRight] = useState(false)
  const [trick, setTrick] = useState<typeof outings[number] | 'rest' | 'fish'>('rest')
  const [guest, setGuest] = useState<'robin' | 'neighbour'>('robin')
  const [perch, setPerch] = useState<{ left: number; top: number } | null>(null)
  const [borrowed, setBorrowed] = useState<{ text: string; style: CSSProperties; carry: boolean } | null>(null)
  const mischiefTurn = useRef(0)
  const visitCount = useRef(0)
  useEffect(() => {
    if (trick !== 'visitor') return
    // Alternate ordinary visits with a pair of glyph routines.
    const playful = Math.floor(mischiefTurn.current++ / 2) % 2 === 1
    const carry = guest === 'robin'
    const glyph = document.querySelector<HTMLElement>(
      !carry ? '[data-homie-glyph="letter"]' : '[data-homie-glyph="digit"]',
    )
    if (playful && glyph && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const r = glyph.getBoundingClientRect()
      if (r.width && r.height && r.left >= 2 && r.right < innerWidth - 4 && r.top >= 4 && r.bottom < innerHeight - 16) {
        const font = getComputedStyle(glyph)
        const dx = r.right + 108 < innerWidth ? 42 : -42
        setBorrowed({ text: glyph.textContent ?? '', carry, style: {
          left: r.left, top: r.top, width: r.width, height: r.height, color: font.color,
          fontFamily: font.fontFamily, fontSize: font.fontSize, fontWeight: font.fontWeight,
          letterSpacing: font.letterSpacing, '--flight-x': dx + 'px',
        } as CSSProperties })
        glyph.classList.add('homie-glyph-away')
        return () => { glyph.classList.remove('homie-glyph-away'); setBorrowed(null) }
      }
    }
    const selector = guest === 'robin' ? '.airy-avatar' : '.shell__nav a[href="/chores"]'
    const choices = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
    })
    if (!choices.length) return
    const target = guest === 'robin' ? choices[visitCount.current++ % choices.length] : choices[0]
    const rect = target.getBoundingClientRect()
    setPerch({ left: Math.max(1, rect.right - 21), top: Math.max(1, rect.top - 17) })
    const icon = target.querySelector('svg, [aria-hidden="true"]') ?? target
    const animation = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? undefined
      : icon.animate(guest === 'robin'
        ? [{transform:'translateY(0)'}, {transform:'translateY(2px)'}, {transform:'translateY(0)'}]
        : [{transform:'rotate(0)'}, {transform:'rotate(-6deg)'}, {transform:'rotate(4deg)'}, {transform:'rotate(0)'}],
      {duration: 320, delay: 1100, iterations: guest === 'robin' ? 1 : 2})
    return () => { animation?.cancel(); setPerch(null) }
  }, [trick, guest])
  const [jump, setJump] = useState(0)
  const [hello, setHello] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const [walking, setWalking] = useState(false)
  const [pace, setPace] = useState(480)
  const [heading, setHeading] = useState(1)
  const [stride, setStride] = useState(0)
  const [carried, setCarried] = useState('')
  const [push, setPush] = useState<Reaction | null>(null)
  const [runningHome, setRunningHome] = useState(false)
  useEffect(() => {
    let quietSince = 0
    let outingTimer: number
    let awayNow = false
    let timer: number
    let startFrame: number
    let stolen: HTMLElement | null = null
    let nudge: Animation | undefined
    function release() {
      clearTimeout(timer)
      cancelAnimationFrame(startFrame)
      stolen?.classList.remove('homie-glyph-away')
      stolen = null
      setCarried('')
      nudge?.cancel()
      setWalking(false)
    }
    function walk(x: number, y: number, speed: number, arrived: () => void) {
      const from = button.current!.getBoundingClientRect()
      const ms = Math.max(180, Math.round(Math.hypot(x-from.left, y-from.top) / speed * 1000))
      setHeading(x < from.left ? -1 : 1)
      setPace(Math.round(105000 / speed))
      setStride(ms)
      setWalking(true)
      setAway({ x, y, dx: 0, dy: 0 })
      timer = window.setTimeout(() => { setWalking(false); arrived() }, ms)
    }
    function goHome() {
      if (!awayNow || tumbling) return
      awayNow = false
      release()
      clearTimeout(outingTimer)
      setRunningHome(true)
      setTrick('rest')
      const home = dock.current!.getBoundingClientRect()
      walk(home.left, home.top, 420, () => { setAway(null); setRunningHome(false) })
    }
    let stopWatching: (() => void) | undefined
    let watchingUntil = 0
    let tumbleTimer: number
    let tumbling = false
    function tumble(reaction: Reaction, origin: DOMRect) {
      const home = dock.current?.getBoundingClientRect()
      if (!home || document.hidden || document.querySelector('.saver, dialog[open], [role="dialog"]')) return
      release()
      clearTimeout(outingTimer)
      awayNow = true
      tumbling = true
      setAway({x: origin.left, y: origin.top, dx: home.left - origin.left, dy: home.top - origin.top})
      setRunningHome(false)
      setTrick('rest')
      setPush(reaction)
      tumbleTimer = window.setTimeout(() => {
        tumbling = false
        setPush(null)
        goHome()
      }, reaction.kind === 'roll' ? 1700 : 640)
    }
    function retreat(event: Event) {
      if (event.target instanceof Element && event.target.closest('.homie-friend')) return
      setTrick(current => ['visitor', 'swipe', 'nudge', 'sweep'].includes(current) ? 'rest' : current)
      quietSince = Date.now()
      if (tumbling) return
      if (button.current && event.type !== 'visibilitychange' && Date.now() >= watchingUntil) {
        stopWatching?.()
        stopWatching = watchForPush(button.current, tumble)
        if (stopWatching) watchingUntil = Date.now() + 500
      }
      goHome()
    }
    const activity = ['pointerdown', 'pointerup', 'dragover', 'keyup', 'keydown', 'input', 'focusin', 'wheel', 'scroll', 'click']
    for (const type of activity) document.addEventListener(type, retreat, { capture: true, passive: true })
    window.addEventListener('homie-dodge', goHome)
    window.addEventListener('resize', retreat)
    document.addEventListener('visibilitychange', retreat)
    const layout = new MutationObserver(goHome)
    const main = document.querySelector('main')
    if (main) layout.observe(main, {childList: true, characterData: true, subtree: true})
    let visit = 0
    let land: number
    const stroll = window.setInterval(() => {
      if (awayNow || Date.now() - quietSince < 12000 || document.hidden
          || document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') || document.querySelector('.saver, dialog[open], [role="dialog"]')
          || button.current?.matches(':focus-visible') || location.pathname.startsWith('/games')) return
      const scheduled = outings[visit % outings.length]
      const move = scheduled === 'sweep' && Math.floor(visit / outings.length) % 2 === 0 ? 'fish' : scheduled
      if (move === 'visitor') setGuest(Math.floor(visit / outings.length) % 2 === 0 ? 'robin' : 'neighbour')
      visit += 1
      const home = button.current?.getBoundingClientRect()
      if (home?.width && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const target = move === 'swipe' ? document.querySelector<HTMLElement>('[data-homie-glyph="letter"]')
          : move === 'nudge' ? document.querySelector<HTMLElement>('.shell__nav a[href="/chores"]') : null
        const r = target?.getBoundingClientRect()
        const stop = r?.width ? { x: Math.max(0, r.right - 8), y: Math.max(0,r.top + r.height/2 - 31) } : findHomieSpot()
        if (stop && !awayNow) {
          awayNow = true
          setStride(0)
          setRight(false)
          setAway({x: home.left, y: home.top, dx: 0, dy: 0})
          startFrame = requestAnimationFrame(() => {
            if (!button.current) return
            startFrame = requestAnimationFrame(() => walk(stop.x, stop.y, 225, () => {
              setTrick(move)
              if (target && move === 'swipe') {
                stolen = target
                target.classList.add('homie-glyph-away')
                setCarried(target.textContent ?? '')
                const hideout = findHomieSpot() ?? { x: Math.min(innerWidth-60, stop.x+130), y: stop.y }
                timer = window.setTimeout(() => walk(hideout.x, hideout.y, 350, () => {
                  timer = window.setTimeout(() => walk(stop.x, stop.y, 300, () => {
                    timer = window.setTimeout(goHome, 380)
                  }), 600)
                }), 300)
              } else {
                if (target && move === 'nudge') nudge = target.animate(
                  [{translate:'0'}, {translate:'-7px'}, {translate:'-3px'}, {translate:'-10px'}, {translate:'0'}],
                  {duration: 1900, easing:'ease-in-out'})
                outingTimer = window.setTimeout(goHome, move === 'visitor' ? 5600 : 3400)
              }
            }))
          })
          return
        }
      }
      setTrick(move)
      if (move === 'bike' || move === 'chase' || move === 'sweep') setRight(previous => !previous)
      land = window.setTimeout(() => setTrick('rest'), move === 'visitor' || move === 'swipe' ? 5600 : 3400)
    }, outingInterval)
    let reset: number
    function greet(event: Event) {
      if (!(event.target instanceof Element) || event.target.closest('.saver, dialog, [role="dialog"]')) return
      setHello(true)
      window.clearTimeout(reset)
      reset = window.setTimeout(() => setHello(false), 1800)
    }
    document.addEventListener('click', greet, true)
    return () => {
      for (const type of activity) document.removeEventListener(type, retreat, true)
      window.removeEventListener('homie-dodge', goHome)
      window.removeEventListener('resize', retreat)
      document.removeEventListener('visibilitychange', retreat)
      stopWatching?.()
      clearTimeout(tumbleTimer)
      layout.disconnect()
      release()
      clearTimeout(outingTimer)
      clearInterval(stroll)
      clearTimeout(land)
      clearTimeout(reset)
      document.removeEventListener('click', greet, true)
    }
  }, [])
  const visitor = trick === 'visitor' && <svg className="homie-visitor" data-guest={guest} viewBox="0 0 28 32" aria-hidden="true" focusable="false">
            {guest === 'robin' ? <g stroke="#473c35" strokeWidth="1.3" strokeLinejoin="round">
              <path fill="none" d="m12 24-1 4-3 1m10-6-1 5 3 1" />
              <path fill="#987557" d="M3 16 1 11l8 4q3-5 8-5 0-7 6-5 5 3 1 9-2 10-10 11-7 0-11-9Z" />
              <path fill="#db8053" stroke="none" d="M23 12q2 8-6 11-6 1-7-3 7 0 8-9Z" />
              <circle cx="22" cy="8" r="1" /><path fill="#dda041" d="m25 9 3 2-4 1Z" />
            </g> : <g stroke="#364b54" strokeWidth="1.3" strokeLinejoin="round">
              <path fill="none" strokeWidth="3" d="m10 25-1 5H6m12-5 1 5h3" />
              <path fill="#678b85" d="m9 16-3 11h17l-5-12Z" />
              <path fill="#f5e8d3" d="M6 14q6-6 15-1 0 9-9 12l1-3q-6 0-7-8Z" />
              <path fill="#5685ae" d="M3 14Q8 8 9 3q1-4 10-1-6 2-3 6l7 6q-10-3-20 0Z" />
              <ellipse fill="#e5a387" cx="17" cy="15" rx="4" ry="2.8" />
              <path fill="none" strokeLinecap="round" d="m20 21 4-4" />
            </g>}
          </svg>
  const portrait = <svg className="homie-portrait" viewBox="0 0 40 51" focusable="false">
            <g stroke="#394536" strokeWidth="1.5" strokeLinejoin="round">
              <path fill="#59998a" d="M12 29 Q20 25 28 29 L34 46 Q21 51 6 46Z" />
              <path fill="#76553b" d="m10 38 19-1 1 4-21 2Z" />
              <path fill="#cbab69" d="m24 38 4-.3.4 3-4 .3Z" />
              <path fill="#f3bc99" d="M7 22 Q19 14 32 22 L30 34 Q19 41 9 32Z" />
              <path fill="#fff1d4" d="M7 29 Q11 32 16 29 Q20 26 25 30 Q29 32 32 28 Q33 37 26 40 L27 37 Q24 44 17 46 L18 42 Q9 42 7 29Z" />
              <path fill="#dccaa9" stroke="none" d="M9 32q2 7 8 8l-1-4 4 4q5-1 10-8-1 7-6 9l2-4q-3 5-8 8l1-4q-6 0-10-9Z" />
              <g className="homie-cap">
                <path fill="#c95142" d="M4 24 Q9 18 12 10 Q15 1 26 2 Q33 2 36 8 Q29 6 26 10 Q24 16 34 22 Q22 27 4 24Z" />
                <path fill="#e07960" stroke="none" d="M9 20Q15 5 24 4q-7 4-10 13Z" />
                {holiday && <path fill="#ffda6b" d="m18 11 1.3 3 3.4.3-2.5 2.1.8 3.2-3-1.8-2.9 1.8.8-3.2-2.5-2.1 3.4-.3Z" />}
                <path fill="#a94035" d="M5 22 Q19 19 33 21 L34 25 Q22 23 5 27Z" />
              </g>
              <g fill="#313e37" stroke="none"><circle cx="13" cy="27" r="1.6" /><circle cx="26" cy="26" r="1.6" /></g>
              {push?.kind === 'roll' && <path className="homie-grumble" fill="none" strokeLinecap="round" d="m11 24 4 2m9-1 4-2" />}
              <ellipse fill="#e99879" cx="20" cy="29" rx="5.4" ry="3.8" />
              <ellipse fill="#ffd0aa" stroke="none" cx="18.5" cy="28" rx="2.6" ry="1" />
              <path fill="none" strokeLinecap="round" d="M17 35 Q20 38 23 34" />
            </g>
          </svg>

  function tapHomie() {
    setJump(n => n + 1)
    setTrick('rest')
    if (mailFrom) onDeliver?.()
  }
  const actor = (
    <div className="homie-yard" data-walking={walking} data-push={push?.direction} data-reaction={push?.kind} data-away={Boolean(away)} data-retreat={runningHome}
      style={away ? { left: away.x, top: away.y, '--stride-ms': stride + 'ms', '--step-time': pace + 'ms', '--lean': heading * 4 + 'deg', '--dock-x': away.dx + 'px', '--dock-y': away.dy + 'px' } as CSSProperties : undefined} data-right={right} data-hello={hello} data-mail={Boolean(mailFrom)} data-star={Boolean(star)} data-trick={trick}>
      <button className="homie-friend" ref={button} type="button" onClick={() => { if (away) window.dispatchEvent(new Event('homie-dodge')); tapHomie() }} aria-label={`Homie the Gnome: ${invitation}`} title={invitation}>
        <span className="homie-jump" key={jump} data-jump={jump > 0}>
        <span className="homie-gnome" aria-hidden="true">
          {trick === 'garden' && <svg className="homie-spade" viewBox="0 0 12 34" focusable="false">
            <path fill="none" stroke="#71492b" strokeWidth="2.6" d="M6 25V8C0 7 1 2 2 2h8c1 0 1 5-4 6" />
            <path fill="#83999a" stroke="#334845" d="M1 22h10v5q-1 4-5 6-4-2-5-6Z" />
          </svg>}
          {trick === 'fish' && <svg className="homie-rod" viewBox="0 0 38 34" focusable="false">
            <path fill="none" stroke="#765539" strokeWidth="2" d="M1 20Q19-1 32 4" />
            <path fill="none" stroke="#687f82" d="M32 4q-2 8 1 20" />
            <ellipse fill="#d95141" stroke="#60443e" cx="33" cy="25" rx="2" ry="3" />
            <path fill="none" stroke="#91bac0" d="M25 29q7 3 13 0" />
          </svg>}
          {trick === 'sweep' && <i className="homie-broom" />}
          {trick === 'bike' && <span className="homie-bike"><i /><b /><i /></span>}
          {portrait}
          {!perch && !borrowed && visitor}
          {trick === 'chase' && <svg className="homie-beetle" viewBox="0 0 22 15" focusable="false">
            <g stroke="#48382d" strokeWidth="1.5" strokeLinecap="round">
              <path fill="none" d="m6 9-3 3m7-2-1 3m5-4 2 3m2-7 2-3" />
              <ellipse fill="#dc8952" cx="10" cy="7" rx="7" ry="4.5" />
              <path fill="none" d="m4 6 11 1" /><circle fill="#48382d" cx="17" cy="7" r="2.3" />
            </g>
          </svg>}
          {(trick === 'garden' || star) && <svg className="homie-sprout" viewBox="0 0 20 24" focusable="false">
            <path fill="none" stroke="#476842" strokeWidth="2" d="M10 23 Q12 12 8 6" />
            <path fill="#61945c" d="M10 17 Q0 18 1 10 Q8 9 10 17 M11 13 Q11 5 19 6 Q18 13 11 13" />
            <g fill="#efae49"><circle cx="8" cy="4" r="3" /><circle cx="5" cy="7" r="3" /><circle cx="11" cy="7" r="3" /></g>
            <circle cx="8" cy="7" r="2" fill="#8e5034" />
          </svg>}
          {carried && <b className="homie-carried" aria-hidden="true">{carried}</b>}
          <i className="homie-arm" /><i className="homie-hand">{mailFrom && <b className="homie-letter">✉</b>}</i>
          <i className="homie-leg" /><i className="homie-leg homie-leg--far" />
          {star && <i className="homie-star" style={{ color: star.color }}>★</i>}
        </span>
        </span>
        {mailFrom && push?.kind === 'roll' && <b className="homie-dropped-letter" aria-hidden="true">✉</b>}
      </button>
      {trick === 'plane' && <i className="homie-plane" aria-hidden="true" />}
      <span role="status" className="homie-cheer">{congrats || (holiday && '✦ ' + holiday)}</span>
    </div>
  )
  return <div ref={dock} className="homie-dock">{away ? createPortal(actor, document.body) : actor}
    {borrowed && visitor && createPortal(<span className="homie-glyph-scene" data-carry={borrowed.carry}
      aria-hidden="true" style={borrowed.style}>
      <span className="homie-loose-glyph">{borrowed.text}</span><span className="homie-glyph-guest">{visitor}</span>
    </span>, document.body)}
    {visitor && perch && createPortal(<span className="homie-perch" style={perch}>{visitor}</span>, document.body)}
    {job && <button type="button" className="homie-chore-note" onClick={onChores}
      aria-label={`Open chores: ${job.name}, ${job.title}`}>
      <span aria-hidden="true">🌱</span>
      <span><strong>{job.name}, lend a hand?</strong><br />{job.title}</span>
    </button>}
  </div>
}
