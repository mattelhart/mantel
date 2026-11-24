import { useEffect, useRef, useState } from 'react'
import './homie.css'

// Capture the launch option before the router replaces the kiosk start URL.
const choice = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('companion')
export const showHomie = choice === null
  ? typeof sessionStorage !== 'undefined' && sessionStorage.getItem('homie.companion') === '1'
  : choice === '1'
if (choice !== null) sessionStorage.setItem('homie.companion', showHomie ? '1' : '0')

type Props = {
  onDeliver?: () => void
  mailFrom?: string
  star?: { name: string; color: string; earned: number }
}

export function Homie({ onDeliver, mailFrom, star }: Props) {
  const invitation = mailFrom ? "I've got mail from " + mailFrom + "!" : "Let's send a message, homie!"
  const congrats = star && "Nice work, " + star.name + "! +" + star.earned + " ★"
  const [right, setRight] = useState(false)
  const [trick, setTrick] = useState<'rest' | 'bike' | 'plane'>('rest')
  const [hello, setHello] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let visit = 0
    let land: number
    const stroll = window.setInterval(() => {
      if (document.hidden || document.querySelector('.saver, dialog[open], [role="dialog"]')
          || button.current?.matches(':focus-visible') || location.pathname.startsWith('/games')) return
      visit += 1
      const move = visit % 3 === 1 ? 'bike' : visit % 3 === 2 ? 'plane' : 'rest'
      setTrick(move)
      if (move !== 'plane') setRight(previous => !previous)
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
      <button className="homie-friend" ref={button} onClick={onDeliver} aria-label={invitation} title={invitation}>
        <span className="homie-cottage" aria-hidden="true">
          {trick === 'bike' && <span className="homie-bike"><i /><b /><i /></span>}
          <i className="homie-roof" /><i className="homie-eyes" /><i className="homie-smile" />
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
