import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, authedUrl } from '../../api/client'
import { useSettings } from '../../api/hooks'
import { DoodleSurface, type DoodleSurfaceHandle } from '../games/DoodleSurface'
import { SendDoodlePicker } from './SendDoodlePicker'

export interface FamilyMessage {
  id: number
  user_id: number | null
  phone: string
  direction: 'in' | 'out'
  body: string | null
  media_url: string | null
  media_content_type: string | null
  status: string
  error_message: string | null
  created_at: string | null
}

export interface Conversation {
  id: string
  user_id: number | null
  name: string
  phone: string | null
  color: string
  avatar_emoji: string | null
  unknown: boolean
  last_message: FamilyMessage | null
  can_send?: boolean
  messages?: FamilyMessage[]
}

export interface ConversationsResponse {
  configured: boolean
  from_number: string
  quick_replies: string[]
  conversations: Conversation[]
}

const KEY = ['messages'] as const

function useConversations() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<ConversationsResponse>('/messages/conversations'),
  })
}

function useThread(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => api.get<Conversation>(`/messages/conversations/${id}`),
    enabled: Boolean(id),
  })
}

export function MessagesPage() {
  const { data, isLoading } = useConversations()
  const { data: settings } = useSettings()
  const configured = data?.configured ?? settings?.server.messages_configured ?? settings?.server.twilio_configured ?? false
  const [composing, setComposing] = useState(false)

  const conversations = data?.conversations ?? []

  return (
    <div className="messages">
      <header className="messages__bar">
        <h1 className="messages__title">Messages</h1>
        <button
          type="button"
          className="btn btn--primary messages__send-doodle"
          onClick={() => setComposing(true)}
        >
          Send doodle
        </button>
      </header>
      {isLoading && !data ? (
        <p className="hint">Loading messages…</p>
      ) : !configured ? (
        <div className="messages__empty">
          <p>Add your Twilio or Signal details in Settings to send notes and doodles to family phones.</p>
          <Link to="/settings?tab=messages" className="btn btn--primary">
            Open Messages settings
          </Link>
        </div>
      ) : (
        <>
          {conversations.length === 0 && (
            <p className="hint">
              Add a phone number to a family member in Settings → Family, then you can text them from
              here.
            </p>
          )}
          <div className="messages__list">
            {conversations.map((item) => (
              <Link key={item.id} to={`/messages/${item.id}`} className="messages__person">
                <span className="messages__avatar" style={{ background: item.color }}>
                  {item.avatar_emoji || initial(item.name)}
                </span>
                <span className="messages__meta">
                  <span className="messages__name">{item.name}</span>
                  <span className="messages__preview">{preview(item)}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
      {composing && <ListDoodleFlow onClose={() => setComposing(false)} />}
    </div>
  )
}

export function MessageThreadPage() {
  const { id } = useParams()
  const thread = useThread(id)
  const listing = useConversations()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)

  const data = thread.data
  const configured = listing.data?.configured ?? false
  const quick = listing.data?.quick_replies ?? ["Dinner's ready", 'Call me', "On my way?"]

  const send = useMutation({
    mutationFn: (payload: { user_id: number; body: string; media_base64?: string }) =>
      api.post<FamilyMessage>('/messages', payload),
    onSuccess: async () => {
      setText('')
      setError(null)
      setDrawing(false)
      await qc.invalidateQueries({ queryKey: KEY })
    },
    onError: (err: Error) => setError(err.message),
  })

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [data?.messages?.length])

  if (thread.isError) {
    return <Navigate to="/messages" replace />
  }

  if (!data) {
    return (
      <div className="messages messages--thread">
        <header className="messages__bar">
          <Link to="/messages" className="messages__back">
            <span aria-hidden>◀</span> Back
          </Link>
          <h1 className="messages__title">Messages</h1>
        </header>
        <p className="hint">Loading conversation…</p>
      </div>
    )
  }

  const canSend = Boolean(data.can_send && data.user_id && configured)

  const submit = (body: string, media?: string) => {
    if (!data.user_id) return
    const trimmed = body.trim()
    if (!trimmed && !media) return
    send.mutate({ user_id: data.user_id, body: trimmed, media_base64: media })
  }

  return (
    <div className="messages messages--thread">
      <header className="messages__bar">
        <Link to="/messages" className="messages__back">
          <span aria-hidden>◀</span> Back
        </Link>
        <div className="messages__who">
          <h1 className="messages__title">{data.name}</h1>
          {data.phone && <span className="messages__number">{data.phone}</span>}
        </div>
      </header>

      <div className="messages__thread" role="log" aria-live="polite">
        {(data.messages ?? []).length === 0 && (
          <p className="hint">No messages yet. Send a note or a doodle.</p>
        )}
        {(data.messages ?? []).map((message) => (
          <div
            key={message.id}
            className="messages__bubble"
            data-dir={message.direction}
          >
            {message.media_url && (
              <img
                className="messages__pic"
                src={authedUrl(message.media_url)}
                alt={message.direction === 'out' ? 'Sent drawing' : 'Received picture'}
              />
            )}
            {message.body && <div className="messages__text">{message.body}</div>}
            {message.direction === 'in' && message.media_url && (
              <Link
                className="messages__open-doodle"
                to={doodleHref(message.media_url, data.user_id)}
              >
                Open in Doodles
              </Link>
            )}
            <div className="messages__status">
              {formatTime(message.created_at)}
              {message.direction === 'out' ? ` · ${statusLabel(message.status)}` : ''}
              {message.error_message ? ` · ${message.error_message}` : ''}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {canSend ? (
        <form
          className="messages__compose"
          onSubmit={(event) => {
            event.preventDefault()
            submit(text)
          }}
        >
          <div className="messages__chips" role="group" aria-label="Quick replies">
            {quick.map((chip) => (
              <button key={chip} type="button" className="messages__chip" onClick={() => submit(chip)}>
                {chip}
              </button>
            ))}
          </div>
          <textarea
            ref={boxRef}
            className="messages__input"
            rows={3}
            maxLength={1000}
            placeholder="Write a note…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && (
            <p className="banner banner--warn" role="alert">
              {error}
            </p>
          )}
          <div className="messages__actions">
            <button type="button" className="btn" onClick={() => setDrawing(true)}>
              Doodle
            </button>
            <button type="submit" className="btn btn--primary" disabled={send.isPending || !text.trim()}>
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      ) : (
        <p className="hint messages__readonly">
          {data.unknown
            ? "This number isn't saved on a family member, so the wall won't send a reply."
            : 'Add a phone number for this person in Settings to send a message.'}
        </p>
      )}

      {drawing && data.user_id && (
        <DoodleComposer
          busy={send.isPending}
          onBack={() => setDrawing(false)}
          onSend={(png) => submit(text, png)}
        />
      )}
    </div>
  )
}

function ListDoodleFlow({ onClose }: { onClose: () => void }) {
  const surfaceRef = useRef<DoodleSurfaceHandle>(null)
  const [empty, setEmpty] = useState(true)
  const [png, setPng] = useState<string | null>(null)
  const onEmptyChange = useCallback((value: boolean) => setEmpty(value), [])

  if (png) {
    return (
      <SendDoodlePicker png={png} onBack={() => setPng(null)} onFinished={onClose} />
    )
  }

  return (
    <div className="messages__doodle" role="dialog" aria-label="Draw a doodle">
      <header className="messages__bar">
        <button type="button" className="messages__back" onClick={onClose}>
          <span aria-hidden>◀</span> Back
        </button>
        <h1 className="messages__title">Doodle</h1>
      </header>
      <DoodleSurface ref={surfaceRef} onEmptyChange={onEmptyChange}>
        <div className="messages__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={empty}
            onClick={() => {
              const data = surfaceRef.current?.exportPng() ?? ''
              if (data) setPng(data)
            }}
          >
            Send to…
          </button>
        </div>
      </DoodleSurface>
    </div>
  )
}

function DoodleComposer({
  busy,
  onBack,
  onSend,
}: {
  busy: boolean
  onBack: () => void
  onSend: (png: string) => void
}) {
  const surfaceRef = useRef<DoodleSurfaceHandle>(null)
  const [empty, setEmpty] = useState(true)
  const onEmptyChange = useCallback((value: boolean) => setEmpty(value), [])

  return (
    <div className="messages__doodle" role="dialog" aria-label="Draw a doodle">
      <header className="messages__bar">
        <button type="button" className="messages__back" onClick={onBack}>
          <span aria-hidden>◀</span> Back
        </button>
        <h1 className="messages__title">Doodle</h1>
      </header>
      <DoodleSurface ref={surfaceRef} onEmptyChange={onEmptyChange}>
        <div className="messages__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || empty}
            onClick={() => {
              const png = surfaceRef.current?.exportPng() ?? ''
              if (png) onSend(png)
            }}
          >
            {busy ? 'Sending…' : 'Send doodle'}
          </button>
        </div>
      </DoodleSurface>
    </div>
  )
}

function doodleHref(mediaUrl: string, userId: number | null): string {
  const params = new URLSearchParams({ media: mediaUrl })
  if (userId) params.set('replyTo', String(userId))
  return `/games/doodle?${params.toString()}`
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function preview(item: Conversation): string {
  const last = item.last_message
  if (!last) return item.phone || 'No messages yet'
  if (last.body) return last.body
  if (last.media_url) return last.direction === 'out' ? 'You sent a drawing' : 'Sent a picture'
  return item.phone || ''
}

function statusLabel(status: string): string {
  switch (status) {
    case 'queued':
    case 'accepted':
    case 'scheduled':
    case 'sending':
      return 'Sending'
    case 'sent':
      return 'Sent'
    case 'delivered':
      return 'Delivered'
    case 'read':
      return 'Read'
    case 'undelivered':
    case 'failed':
    case 'canceled':
      return 'Failed'
    default:
      return status
  }
}

function formatTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
