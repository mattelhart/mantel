import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { useSettings, useUsers } from '../../api/hooks'
import type { User } from '../../api/types'
import { friendlySendError } from './MessagesPage'

export interface SendResult {
  user: User
  ok: boolean
  error?: string
}

const CAPTION_MAX = 200

function hasPhone(user: User): boolean {
  return Boolean((user.phone && user.phone.trim()) || (user.signal_uuid && user.signal_uuid.trim()))
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function namesList(people: User[]): string {
  if (people.length === 0) return ''
  if (people.length === 1) return people[0].name
  if (people.length === 2) return `${people[0].name} and ${people[1].name}`
  return `${people
    .slice(0, -1)
    .map((p) => p.name)
    .join(', ')}, and ${people[people.length - 1].name}`
}

export function SendDoodlePicker({
  png,
  initialSelected = [],
  onBack,
  onFinished,
}: {
  png: string
  initialSelected?: number[]
  onBack: () => void
  onFinished?: () => void
}) {
  const { data: users, isLoading } = useUsers()
  const { data: settings } = useSettings()
  const configured = settings?.server.messages_configured ?? settings?.server.twilio_configured ?? false
  const qc = useQueryClient()
  const people = users ?? []
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialSelected))
  const [caption, setCaption] = useState('')
  const [results, setResults] = useState<SendResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [host, setHost] = useState<Element | null>(() =>
    typeof document === 'undefined' ? null : document.querySelector('.shell__main'),
  )
  useEffect(() => {
    setHost(document.querySelector('.shell__main'))
  }, [])

  const sendable = useMemo(() => people.filter(hasPhone), [people])
  const chosen = useMemo(
    () => people.filter((person) => selected.has(person.id) && hasPhone(person)),
    [people, selected],
  )

  const send = useMutation({
    mutationFn: async () => {
      if (!configured) {
        throw new Error('Ask a grown-up to finish Messages settings, then try again.')
      }
      if (chosen.length === 0) {
        throw new Error('Pick someone with a phone number.')
      }
      const body = caption.trim()
      const out: SendResult[] = []
      for (const user of chosen) {
        try {
          await api.post('/messages', {
            user_id: user.id,
            body,
            media_base64: png,
          })
          out.push({ user, ok: true })
        } catch (err) {
          out.push({
            user,
            ok: false,
            error: friendlySendError(err),
          })
        }
      }
      return out
    },
    onSuccess: async (out) => {
      setError(null)
      setResults(out)
      await qc.invalidateQueries({ queryKey: ['messages'] })
    },
    onError: (err: Error) => setError(friendlySendError(err)),
  })

  function toggle(user: User) {
    if (!hasPhone(user)) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(user.id)) next.delete(user.id)
      else next.add(user.id)
      return next
    })
  }

  const done = () => (onFinished ?? onBack)()
  const succeeded = results?.filter((item) => item.ok) ?? []
  const failed = results?.filter((item) => !item.ok) ?? []

  const ui = (
    <div className="doodle-send" role="dialog" aria-label="Send to family">
      <header className="doodle-send__bar">
        <button type="button" className="doodle-send__back" onClick={results ? done : onBack}>
          <span aria-hidden>◀</span> {results ? 'Done' : 'Back'}
        </button>
        <h1 className="doodle-send__title">{results ? 'Sent!' : 'Who should get this?'}</h1>
      </header>

      {!configured ? (
        <div className="doodle-send__empty">
          <p>Ask a grown-up to turn on Messages in Settings so you can send a picture.</p>
          <Link to="/settings?tab=messages" className="btn btn--primary">
            Open Messages settings
          </Link>
        </div>
      ) : results ? (
        <div className="doodle-send__done">
          {succeeded.length > 0 && <p>Sent to {namesList(succeeded.map((item) => item.user))}.</p>}
          {failed.map((item) => (
            <p key={item.user.id} className="banner banner--warn" role="alert">
              Couldn&apos;t send to {item.user.name}: {item.error}
            </p>
          ))}
          {succeeded.length === 1 && (
            <Link
              to={`/messages/user-${succeeded[0].user.id}`}
              className="btn btn--primary doodle-send__thread"
            >
              See messages
            </Link>
          )}
          {succeeded.length > 1 && (
            <div className="doodle-send__threads">
              {succeeded.map((item) => (
                <Link
                  key={item.user.id}
                  to={`/messages/user-${item.user.id}`}
                  className="btn btn--primary doodle-send__thread"
                >
                  See {item.user.name}&apos;s messages
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {isLoading && <p className="hint">Loading family…</p>}
          {!isLoading && people.length === 0 && (
            <p className="hint">Ask a grown-up to add your family in Settings, then you can send a picture.</p>
          )}
          {!isLoading && people.length > 0 && sendable.length === 0 && (
            <p className="hint">Ask a grown-up to add a phone number so someone can get a picture.</p>
          )}
          <div className="doodle-send__list">
            {people.map((person) => {
              const ready = hasPhone(person)
              const on = selected.has(person.id)
              return (
                <button
                  key={person.id}
                  type="button"
                  className={ready ? 'doodle-send__person' : 'doodle-send__person doodle-send__person--no-phone'}
                  disabled={!ready}
                  aria-pressed={ready ? on : undefined}
                  onClick={() => toggle(person)}
                >
                  <span className="doodle-send__avatar" style={{ background: person.color }}>
                    {person.avatar_emoji || initial(person.name)}
                  </span>
                  <span className="doodle-send__meta">
                    <span className="doodle-send__name">{person.name}</span>
                    <span className="doodle-send__hint">{ready ? 'Tap to pick' : 'Ask a grown-up to add a phone number'}</span>
                  </span>
                  {ready && on ? <span className="doodle-send__check" aria-hidden>✓</span> : null}
                </button>
              )
            })}
          </div>
          <form
            className="doodle-send__compose"
            onSubmit={(event) => {
              event.preventDefault()
              if (chosen.length && png) send.mutate()
            }}
          >
            <label className="doodle-send__caption">
              <span>Write a note (optional)</span>
              <input
                type="text"
                maxLength={CAPTION_MAX}
                placeholder="A short note"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
              />
            </label>
            {error && (
              <p className="banner banner--warn" role="alert">
                {error}
              </p>
            )}
            <div className="doodle-send__actions">
              <button type="button" className="btn" onClick={onBack}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={send.isPending || chosen.length === 0 || !png}
              >
                {send.isPending ? 'Sending…' : chosen.length > 1 ? `Send to ${chosen.length}` : 'Send'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  )
  return host ? createPortal(ui, host) : ui
}
