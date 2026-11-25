import { TouchSheet } from '../../components/TouchSheet'
import { requestId } from '../../offline/actions'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
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
const SENT_MS = 3200

export function friendlyFailureText(raw: string, name?: string | null): string {
  const text = raw.trim()
  if (!text) return ''
  if (/couldn't be sent as a picture/i.test(text)) return text
  if (/can't get Signal messages from (Mantel|Homie)/i.test(text)) return text.replace(/from Mantel/i, 'from Homie')
  if (/unregistered|isn't registered|not registered/i.test(text)) {
    const who = name?.trim() || 'They'
    return `${who} can't get Signal messages from Homie yet. Ask a grown-up for help.`
  }
  if (/phone number/i.test(text)) return 'Ask a grown-up to add a phone number first.'
  if (/ask a grown-up to finish Messages settings/i.test(text)) return text
  if (/Twilio or Signal|not configured|Settings/i.test(text)) {
    return 'Ask a grown-up to finish Messages settings, then try again.'
  }
  return "Couldn't send that. Try again in a moment."
}

export function friendlySendError(error: unknown, name?: string | null): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (raw.startsWith('Delivery unconfirmed')) return raw
  return friendlyFailureText(raw, name) || "Couldn't send that. Try again in a moment."
}

export function useConversations() {
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
          Draw a picture
        </button>
      </header>
      {isLoading && !data ? (
        <p className="hint">Loading messages…</p>
      ) : !configured ? (
        <div className="messages__empty">
          <p>Ask a grown-up to turn on Messages in Settings so you can send notes and pictures.</p>
          <Link to="/settings?tab=messages" className="btn btn--primary">
            Open Messages settings
          </Link>
        </div>
      ) : (
        <>
          {conversations.length === 0 && (
            <p className="hint">Ask a grown-up to add your family in Settings, then you can send messages.</p>
          )}
          <div className="messages__list">
            {conversations.map((item) => (
              <Link
                key={item.id}
                to={`/messages/${item.id}`}
                className="messages__person"
                data-can-send={item.phone ? 'true' : 'false'}
              >
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
  const [justSent, setJustSent] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const sentTimer = useRef<number | null>(null)

  const data = thread.data
  const configured = listing.data?.configured ?? false
  const quick = listing.data?.quick_replies ?? ["Dinner's ready", 'Call me', "On my way?"]

  const celebrateSent = useCallback(() => {
    window.dispatchEvent(new Event('homie-post'))
    setJustSent(true)
    if (sentTimer.current) window.clearTimeout(sentTimer.current)
    sentTimer.current = window.setTimeout(() => setJustSent(false), SENT_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (sentTimer.current) window.clearTimeout(sentTimer.current)
    }
  }, [])

  const [deleting, setDeleting] = useState<FamilyMessage | null>(null)
  const remove = useMutation({
    mutationFn: (messageId: number) => api.del<void>('/messages/' + messageId),
    onSuccess: async () => {
      setDeleting(null)
      await qc.invalidateQueries({ queryKey: KEY })
    },
  })

  const attempt = useRef({ payload: "", id: "" })
  const send = useMutation({
    mutationFn: (payload: { request_id: string; user_id: number; body: string; media_base64?: string }) =>
      api.post<FamilyMessage>('/messages', payload),
    onSuccess: async (row) => {
      attempt.current = { payload: "", id: "" }
      setText('')
      setError(null)
      setDrawing(false)
      if (row.status === "unconfirmed" || row.status === "failed") setError(statusLabel(row.status))
      else celebrateSent()
      await qc.invalidateQueries({ queryKey: KEY })
    },
    onError: (err: Error) => setError(friendlySendError(err)),
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
    const signature = JSON.stringify([data.user_id, trimmed, media])
    if (signature !== attempt.current.payload) attempt.current = { payload: signature, id: requestId() }
    send.mutate({ request_id: attempt.current.id, user_id: data.user_id, body: trimmed, media_base64: media })
  }

  return (
    <div className="messages messages--thread" style={{ '--person-color': data.color } as CSSProperties}>
      <header className="messages__bar">
        <Link to="/messages" className="messages__back">
          <span aria-hidden>◀</span> Back
        </Link>
        <span className="messages__avatar messages__avatar--header" style={{ background: data.color }}>
          {data.avatar_emoji || initial(data.name)}
        </span>
        <div className="messages__who">
          <h1 className="messages__title">{data.name}</h1>
        </div>
      </header>

      <div className="messages__thread" role="log" aria-live="polite">
        {(data.messages ?? []).length === 0 && (
          <p className="hint">
            {canSend ? 'No messages yet. Send a note or draw a picture.' : 'No messages yet.'}
          </p>
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
            {message.direction === 'in' && message.media_url && canSend && (
              <Link
                className="messages__open-doodle"
                to={doodleHref(message.media_url, data.user_id)}
              >
                Draw on this
              </Link>
            )}
            <div className="messages__status">
              <button className="messages__delete" type="button" onClick={() => {
                remove.reset()
                setDeleting(message)
              }}>Delete</button>
              {formatTime(message.created_at)}
              {message.direction === 'out' ? ` · ${statusLabel(message.status)}` : ''}
              {message.error_message && message.status !== 'unconfirmed' ? ` · ${friendlyFailureText(message.error_message, data.name)}` : ''}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {deleting && <TouchSheet title="Delete this message?" onClose={() => {
        if (!remove.isPending) setDeleting(null)
      }}>
        <p>This removes the message from all Homie screens. The recipient keeps their copy.</p>
        {deleting.body && <blockquote>{deleting.body}</blockquote>}
        {remove.isError && <p role="alert">Could not delete this message. Try again.</p>}
        <button className="btn" disabled={remove.isPending} onClick={() => remove.mutate(deleting.id)}>
          {remove.isPending ? 'Deleting…' : 'Delete from Homie'}
        </button>
      </TouchSheet>}
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
              <button key={chip} type="button" className="messages__chip" disabled={send.isPending} onClick={() => submit(chip)}>
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
          {justSent && !error && (
            <p className="messages__toast" role="status">
              Sent!
            </p>
          )}
          {error && (
            <p className="banner banner--warn" role="alert">
              {error}
            </p>
          )}
          <div className="messages__actions">
            <button type="button" className="btn messages__draw" onClick={() => setDrawing(true)}>
              Draw
            </button>
            <button type="submit" className="btn btn--primary" disabled={send.isPending || !text.trim()}>
              {send.isPending && !drawing ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      ) : (
        <div className="messages__need-phone">
          <p>
            {data.unknown
              ? "This isn't someone in the family, so you can't send a message."
              : `Ask a grown-up to add a phone number so you can send messages to ${data.name}.`}
          </p>
        </div>
      )}

      {drawing && data.user_id && (
        <DoodleComposer
          busy={send.isPending}
          error={error}
          onBack={() => {
            setDrawing(false)
            setError(null)
          }}
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
    <div className="messages__doodle" role="dialog" aria-label="Draw a picture">
      <header className="messages__bar">
        <button type="button" className="messages__back" onClick={onClose}>
          <span aria-hidden>◀</span> Back
        </button>
        <h1 className="messages__title">Draw a picture</h1>
      </header>
      <DoodleSurface ref={surfaceRef} simpleTools onEmptyChange={onEmptyChange}>
        <div className="messages__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={empty}
            onClick={() => {
              const data = surfaceRef.current?.exportPng() ?? ''
              if (data) setPng(data)
            }}
          >
            Send
          </button>
        </div>
      </DoodleSurface>
    </div>
  )
}

function DoodleComposer({
  busy,
  error,
  onBack,
  onSend,
}: {
  busy: boolean
  error: string | null
  onBack: () => void
  onSend: (png: string) => void
}) {
  const surfaceRef = useRef<DoodleSurfaceHandle>(null)
  const [empty, setEmpty] = useState(true)
  const onEmptyChange = useCallback((value: boolean) => setEmpty(value), [])

  return (
    <div className="messages__doodle" role="dialog" aria-label="Draw a picture">
      <header className="messages__bar">
        <button type="button" className="messages__back" onClick={onBack}>
          <span aria-hidden>◀</span> Back
        </button>
        <h1 className="messages__title">Draw a picture</h1>
      </header>
      <DoodleSurface ref={surfaceRef} simpleTools onEmptyChange={onEmptyChange}>
        {error && (
          <p className="banner banner--warn" role="alert">
            {error}
          </p>
        )}
        <div className="messages__actions">
          <button type="button" className="btn" onClick={onBack}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || empty}
            onClick={() => {
              const png = surfaceRef.current?.exportPng() ?? ''
              if (png) onSend(png)
            }}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </DoodleSurface>
    </div>
  )
}

export function doodleHref(mediaUrl: string, userId: number | null): string {
  const params = new URLSearchParams({ media: mediaUrl })
  if (userId) params.set('replyTo', String(userId))
  return `/games/doodle?${params.toString()}`
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function preview(item: Conversation): string {
  const last = item.last_message
  if (last) {
    if (last.body) return last.body
    if (last.media_url) return last.direction === 'out' ? 'You sent a drawing' : 'Sent a picture'
  }
  if (!item.phone) return 'Ask a grown-up to add a phone number'
  return 'No messages yet'
}

function statusLabel(status: string): string {
  switch (status) {
    case 'unconfirmed':
      return 'Delivery unconfirmed'
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
