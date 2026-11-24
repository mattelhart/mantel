import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { ChoreBoard } from '../api/types'
import { doodleHref, useConversations } from '../views/messages/MessagesPage'
import { useEvents } from '../api/hooks'
import { holidaysOn } from './homieHolidays'
import { Homie } from './Homie'

type Star = { name: string; color: string; earned: number }

export function HomieDelivery({ day = new Date().toLocaleDateString('sv-SE') }: { day?: string }) {
  const start = new Date(day + 'T00:00:00Z')
  const events = useEvents(start, new Date(start.getTime() + 86400000))
  const holidays = holidaysOn(day, events.data ?? [])
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data } = useConversations()
  const board = useQuery({
    queryKey: ['chores', 'board', 'today'],
    queryFn: () => api.get<ChoreBoard>('/chores/board'),
  })
  const jobs = (board.data?.people ?? []).flatMap(person =>
    (person.chores ?? []).filter(chore => !chore.completion).map(chore => ({
      name: person.name, title: chore.title,
    })),
  )
  const [turn, setTurn] = useState(-1)
  const [showJob, setShowJob] = useState(false)
  useEffect(() => {
    if (!jobs.length || pathname.startsWith('/chores')) return
    let hide: number
    function offerJob() {
      if (document.hidden || document.querySelector('.saver, dialog[open], [role="dialog"]')
          || document.activeElement?.matches('input,textarea,[contenteditable="true"]')) return
      setTurn(n => n + 1)
      setShowJob(true)
      hide = window.setTimeout(() => setShowJob(false), 15000)
    }
    const first = window.setTimeout(offerJob, 12000)
    const again = window.setInterval(offerJob, 180000)
    return () => { clearTimeout(first); clearInterval(again); clearTimeout(hide); setShowJob(false) }
  }, [Boolean(jobs.length), pathname])
  const job = showJob && jobs.length && turn >= 0 ? jobs[turn % jobs.length] : undefined
  const previous = useRef(new Map<number, number>())
  const [stars, setStars] = useState<Star[]>([])
  useEffect(() => {
    if (!board.data) return
    const earned: Star[] = []
    for (const person of board.data.people) {
      const before = previous.current.get(person.user_id)
      if (before !== undefined && person.stars > before) {
        earned.push({ name: person.name, color: person.color, earned: person.stars - before })
      }
    }
    previous.current = new Map(board.data.people.map(p => [p.user_id, p.stars]))
    if (earned.length) setStars(queue => [...queue, ...earned])
  }, [board.data])
  const star = stars[0]
  useEffect(() => {
    if (!star) return
    const timer = setTimeout(() => setStars(queue => queue.slice(1)), 4200)
    return () => clearTimeout(timer)
  }, [star])

  const [seen, setSeen] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('homie.delivered') || '{}') || {} }
    catch { return {} }
  })
  const conversations = data?.conversations
  function remember(id: string, message: number) {
    setSeen(old => old[id] >= message ? old : { ...old, [id]: message })
  }
  useEffect(() => {
    try { localStorage.setItem('homie.delivered', JSON.stringify(seen)) } catch { /* session only */ }
  }, [seen])
  useEffect(() => {
    const open = conversations?.find(c => pathname === '/messages/' + c.id)
    if (open?.last_message) remember(open.id, open.last_message.id)
  }, [pathname, conversations])
  const mail = conversations?.filter(c => c.last_message?.direction === 'in'
    && c.last_message.id > (seen[c.id] ?? 0) && pathname !== '/messages/' + c.id)
    .sort((a, b) => b.last_message!.id - a.last_message!.id)[0]
  function deliver() {
    const message = mail?.last_message
    if (!mail || !message) { navigate('/messages'); return }
    remember(mail.id, message.id)
    navigate(message.media_url && message.media_content_type?.startsWith('image/')
      ? doodleHref(message.media_url, mail.user_id)
      : '/messages/' + mail.id)
  }
  return <Homie job={star ? undefined : job} onChores={() => navigate('/chores')} onDeliver={deliver} mailFrom={mail?.name} star={star} holiday={holidays.join(' · ')} />
}
