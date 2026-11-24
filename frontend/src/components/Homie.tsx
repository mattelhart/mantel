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

const outings = ['bike', 'plane', 'garden', 'chase', 'rest'] as const

type Props = {
  job?: { name: string; title: string }
  onChores?: () => void
  onDeliver?: () => void
  mailFrom?: string
  holiday?: string
  star?: { name: string; color: string; earned: number }
}

export function Homie({ onDeliver, mailFrom, star, holiday, job, onChores }: Props) {
  const invitation = mailFrom ? "I've got mail from " + mailFrom + "!" : "Let's send a message, homie!"
  const congrats = star && "Nice work, " + star.name + "! +" + star.earned + " ★"
  const [right, setRight] = useState(false)
  const [trick, setTrick] = useState<typeof outings[number]>('rest')
  const [hello, setHello] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const [push, setPush] = useState<Reaction | null>(null)
  const [runningHome, setRunningHome] = useState(false)
  useEffect(() => {
    let quietSince = 0
    let returnTimer: number
    let outingTimer: number
    let awayNow = false
    function goHome() {
      if (!awayNow || tumbling) return
      awayNow = false
      setRunningHome(true)
      setTrick('rest')
      returnTimer = window.setTimeout(() => { setAway(null); setRunningHome(false) }, 280)
    }
    let stopWatching: (() => void) | undefined
    let watchingUntil = 0
    let tumbleTimer: number
    let tumbling = false
    function tumble(reaction: Reaction, origin: DOMRect) {
      const home = dock.current?.getBoundingClientRect()
      if (!home || document.hidden || document.querySelector('.saver, dialog[open], [role="dialog"]')) return
      clearTimeout(returnTimer)
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
    window.addEventListener('resize', retreat)
    document.addEventListener('visibilitychange', retreat)
    const layout = new MutationObserver(goHome)
    const main = document.querySelector('main')
    if (main) layout.observe(main, {childList: true, characterData: true, subtree: true})
    let visit = 0
    let land: number
    const stroll = window.setInterval(() => {
      if (Date.now() - quietSince < 20000 || document.hidden
          || document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') || document.querySelector('.saver, dialog[open], [role="dialog"]')
          || button.current?.matches(':focus-visible') || location.pathname.startsWith('/games')) return
      const move = outings[visit % outings.length]
      visit += 1
      const home = dock.current?.getBoundingClientRect()
      if (home?.width && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const spot = findHomieSpot()
        if (spot) {
          awayNow = true
          setAway({ ...spot, dx: home.left - spot.x, dy: home.top - spot.y })
          outingTimer = window.setTimeout(goHome, 18000)
        }
      }
      setTrick(move)
      if (move === 'bike' || move === 'chase' || move === 'rest') setRight(previous => !previous)
      land = window.setTimeout(() => setTrick('rest'), 3400)
    }, 75000)
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
      window.removeEventListener('resize', retreat)
      document.removeEventListener('visibilitychange', retreat)
      stopWatching?.()
      clearTimeout(tumbleTimer)
      layout.disconnect()
      clearTimeout(returnTimer)
      clearTimeout(outingTimer)
      clearInterval(stroll)
      clearTimeout(land)
      clearTimeout(reset)
      document.removeEventListener('click', greet, true)
    }
  }, [])
  const actor = (
    <div className="homie-yard" data-push={push?.direction} data-reaction={push?.kind} data-away={Boolean(away)} data-retreat={runningHome}
      style={away ? { left: away.x, top: away.y, '--dock-x': away.dx + 'px', '--dock-y': away.dy + 'px' } as CSSProperties : undefined} data-right={right} data-hello={hello} data-mail={Boolean(mailFrom)} data-star={Boolean(star)} data-trick={trick}>
      <button className="homie-friend" ref={button} onClick={onDeliver} aria-label={`Homie the Gnome: ${invitation}`} title={invitation}>
        <span className="homie-gnome" aria-hidden="true">
          {trick === 'bike' && <span className="homie-bike"><i /><b /><i /></span>}
          <svg className="homie-portrait" viewBox="0 0 40 51" focusable="false">
            <g stroke="#394536" strokeWidth="1.5" strokeLinejoin="round">
              <path fill="#59998a" d="M12 29 Q20 25 28 29 L34 46 Q21 51 6 46Z" />
              <path fill="#f3bc99" d="M7 22 Q19 14 32 22 L30 34 Q19 41 9 32Z" />
              <path fill="#fff1d4" d="M7 29 Q11 32 16 29 Q20 26 25 30 Q29 32 32 28 Q33 37 26 40 L27 37 Q24 44 17 46 L18 42 Q9 42 7 29Z" />
              <g className="homie-cap">
                <path fill="#c95142" d="M4 24 Q9 18 12 10 Q15 1 26 2 Q33 2 36 8 Q29 6 26 10 Q24 16 34 22 Q22 27 4 24Z" />
                {holiday && <path fill="#ffda6b" d="m18 11 1.3 3 3.4.3-2.5 2.1.8 3.2-3-1.8-2.9 1.8.8-3.2-2.5-2.1 3.4-.3Z" />}
                <path fill="#a94035" d="M5 22 Q19 19 33 21 L34 25 Q22 23 5 27Z" />
              </g>
              <g fill="#313e37" stroke="none"><circle cx="13" cy="27" r="1.6" /><circle cx="26" cy="26" r="1.6" /></g>
              {push?.kind === 'roll' && <path className="homie-grumble" fill="none" strokeLinecap="round" d="m11 24 4 2m9-1 4-2" />}
              <ellipse fill="#e99879" cx="20" cy="29" rx="5.4" ry="3.8" />
              <path fill="none" strokeLinecap="round" d="M17 35 Q20 38 23 34" />
            </g>
          </svg>
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
          <i className="homie-arm" /><i className="homie-hand"><b className="homie-letter">✉</b></i>
          <i className="homie-leg" /><i className="homie-leg homie-leg--far" />
          {star && <i className="homie-star" style={{ color: star.color }}>★</i>}
        </span>
        {push?.kind === 'roll' && <b className="homie-dropped-letter" aria-hidden="true">✉</b>}
      </button>
      {trick === 'plane' && <i className="homie-plane" aria-hidden="true" />}
      <span role="status" className="homie-cheer">{congrats || (holiday && '✦ ' + holiday)}</span>
    </div>
  )
  return <div ref={dock} className="homie-dock">{away ? createPortal(actor, document.body) : actor}
    {job && <button type="button" className="homie-chore-note" onClick={onChores}
      aria-label={`Open chores: ${job.name}, ${job.title}`}>
      <span aria-hidden="true">🌱</span>
      <span><strong>{job.name}, lend a hand?</strong><br />{job.title}</span>
    </button>}
  </div>
}
