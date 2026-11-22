import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, authedUrl } from '../../api/client'
import { useSettings } from '../../api/hooks'
import {
  DOODLE_COLORS,
  DOODLE_SIZES,
  addPoint,
  clearStrokes,
  paint,
  startStroke,
  undoStroke,
  type Stroke,
} from '../games/doodle'

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
  const configured = data?.configured ?? settings?.server.twilio_configured ?? false

  if (isLoading && !data) {
    return (
      <div className="messages">
        <header className="messages__bar">
          <h1 className="messages__title">Messages</h1>
        </header>
        <p className="hint">Loading messages…</p>
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="messages">
        <header className="messages__bar">
          <h1 className="messages__title">Messages</h1>
        </header>
        <div className="messages__empty">
          <p>Add your Twilio details in Settings to send notes and doodles to family phones.</p>
          <Link to="/settings?tab=messages" className="btn btn--primary">
            Open Messages settings
          </Link>
        </div>
      </div>
    )
  }

  const conversations = data?.conversations ?? []

  return (
    <div className="messages">
      <header className="messages__bar">
        <h1 className="messages__title">Messages</h1>
      </header>
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

function DoodleComposer({
  busy,
  onBack,
  onSend,
}: {
  busy: boolean
  onBack: () => void
  onSend: (png: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [color, setColor] = useState<string>(DOODLE_COLORS[0])
  const [size, setSize] = useState<(typeof DOODLE_SIZES)[number]>(DOODLE_SIZES[1])
  const drawing = useRef(false)
  strokesRef.current = strokes

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint(ctx, strokesRef.current, rect.width, rect.height)
    }
    resize()
    window.addEventListener('resize', resize)
    const Observer = typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver
    const observer = Observer ? new Observer(resize) : null
    observer?.observe(canvas)
    return () => {
      window.removeEventListener('resize', resize)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    paint(ctx, strokes, rect.width, rect.height)
  }, [strokes])

  function pointFrom(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function exportPng(): string {
    const source = canvasRef.current
    if (!source) return ''
    const out = document.createElement('canvas')
    out.width = source.width
    out.height = source.height
    const ctx = out.getContext('2d')
    if (!ctx) return ''
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(source, 0, 0)
    return out.toDataURL('image/png')
  }

  return (
    <div className="messages__doodle" role="dialog" aria-label="Draw a doodle">
      <header className="messages__bar">
        <button type="button" className="messages__back" onClick={onBack}>
          <span aria-hidden>◀</span> Back
        </button>
        <h1 className="messages__title">Doodle</h1>
      </header>
      <div className="doodle">
        <div className="doodle__tools">
          <div className="doodle__colors" role="group" aria-label="Colour">
            {DOODLE_COLORS.map((value) => (
              <button
                key={value}
                type="button"
                className="doodle__swatch"
                data-on={color === value}
                aria-label={`Colour ${value}`}
                style={{ background: value }}
                onClick={() => setColor(value)}
              />
            ))}
          </div>
          <div className="doodle__sizes" role="group" aria-label="Brush size">
            {DOODLE_SIZES.map((value) => (
              <button
                key={value}
                type="button"
                className="doodle__size"
                data-on={size === value}
                aria-label={`Brush size ${value}`}
                onClick={() => setSize(value)}
              >
                <span style={{ width: value, height: value }} />
              </button>
            ))}
          </div>
          <button type="button" className="doodle__action" onClick={() => setStrokes((s) => undoStroke(s))}>
            Undo
          </button>
          <button type="button" className="doodle__action" onClick={() => setStrokes(clearStrokes())}>
            Clear
          </button>
        </div>
        <canvas
          ref={canvasRef}
          className="doodle__canvas"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            drawing.current = true
            const point = pointFrom(event)
            setStrokes((current) => startStroke(current, color, size, point))
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return
            const point = pointFrom(event)
            setStrokes((current) => addPoint(current, point))
          }}
          onPointerUp={(event) => {
            drawing.current = false
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
          onPointerCancel={(event) => {
            drawing.current = false
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
        />
        <div className="messages__actions">
          <button type="button" className="btn btn--primary" disabled={busy || strokes.length === 0} onClick={() => onSend(exportPng())}>
            {busy ? 'Sending…' : 'Send doodle'}
          </button>
        </div>
      </div>
    </div>
  )
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
