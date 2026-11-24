import { useEffect, useRef, useState } from 'react'
import './homie.css'

// Capture the launch option before the router replaces the kiosk start URL.
const choice = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('companion')
export const showHomie = choice === null
  ? typeof sessionStorage !== 'undefined' && sessionStorage.getItem('homie.companion') === '1'
  : choice === '1'
if (choice !== null) sessionStorage.setItem('homie.companion', showHomie ? '1' : '0')

const outings = ['bike', 'plane', 'garden', 'chase', 'rest'] as const

type Props = {
  onDeliver?: () => void
  mailFrom?: string
  star?: { name: string; color: string; earned: number }
}

export function Homie({ onDeliver, mailFrom, star }: Props) {
  const invitation = mailFrom ? "I've got mail from " + mailFrom + "!" : "Let's send a message, homie!"
  const congrats = star && "Nice work, " + star.name + "! +" + star.earned + " ★"
  const [right, setRight] = useState(false)
  const [trick, setTrick] = useState<typeof outings[number]>('rest')
  const [hello, setHello] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let visit = 0
    let land: number
    const stroll = window.setInterval(() => {
      if (document.hidden || document.querySelector('.saver, dialog[open], [role="dialog"]')
          || button.current?.matches(':focus-visible') || location.pathname.startsWith('/games')) return
      const move = outings[visit % outings.length]
      visit += 1
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
      clearInterval(stroll)
      clearTimeout(land)
      clearTimeout(reset)
      document.removeEventListener('click', greet, true)
    }
  }, [])
  return (
    <div className="homie-yard" data-right={right} data-hello={hello} data-mail={Boolean(mailFrom)} data-star={Boolean(star)} data-trick={trick}>
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
                <path fill="#a94035" d="M5 22 Q19 19 33 21 L34 25 Q22 23 5 27Z" />
              </g>
              <g fill="#313e37" stroke="none"><circle cx="13" cy="27" r="1.6" /><circle cx="26" cy="26" r="1.6" /></g>
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
          {trick === 'garden' && <svg className="homie-sprout" viewBox="0 0 20 24" focusable="false">
            <path fill="none" stroke="#476842" strokeWidth="2" d="M10 23 Q12 12 8 6" />
            <path fill="#61945c" d="M10 17 Q0 18 1 10 Q8 9 10 17 M11 13 Q11 5 19 6 Q18 13 11 13" />
            <g fill="#efae49"><circle cx="8" cy="4" r="3" /><circle cx="5" cy="7" r="3" /><circle cx="11" cy="7" r="3" /></g>
            <circle cx="8" cy="7" r="2" fill="#8e5034" />
          </svg>}
          <i className="homie-arm" /><i className="homie-hand"><b className="homie-letter">✉</b></i>
          <i className="homie-leg" /><i className="homie-leg homie-leg--far" />
          {star && <i className="homie-star" style={{ color: star.color }}>★</i>}
        </span>
      </button>
      {trick === 'plane' && <i className="homie-plane" aria-hidden="true" />}
      <span role="status" className="homie-cheer">{congrats}</span>
    </div>
  )
}
