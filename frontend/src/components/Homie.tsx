import { useEffect, useRef, useState } from 'react'
import './homie.css'

// Capture the launch option before the router replaces the kiosk start URL.
const choice = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('companion')
export const showHomie = choice === null
  ? typeof sessionStorage !== 'undefined' && sessionStorage.getItem('homie.companion') === '1'
  : choice === '1'
if (choice !== null) sessionStorage.setItem('homie.companion', showHomie ? '1' : '0')

export function Homie() {
  const [right, setRight] = useState(false)
  const [hello, setHello] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const stroll = window.setInterval(() => {
      if (!document.hidden && !document.querySelector('.saver, dialog[open], [role="dialog"]')
          && !button.current?.matches(':focus-visible')) setRight(previous => !previous)
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
      clearTimeout(reset)
      document.removeEventListener('click', greet, true)
    }
  }, [])
  return (
    <div className="homie-yard" data-right={right} data-hello={hello}>
      <button className="homie-friend" ref={button} aria-label="Say hello to Homie" title="Say hello to Homie">
        <span className="homie-cottage" aria-hidden="true">
          <i className="homie-roof" /><i className="homie-eyes" /><i className="homie-smile" />
          <i className="homie-hand" /><i className="homie-heart">♥</i>
        </span>
      </button>
    </div>
  )
}
