// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { byText, click, mount, pointer, type, unmount } from '../../components/testDom'
import { MessagesPage, MessageThreadPage, friendlySendError, type ConversationsResponse } from './MessagesPage'

let listing: ConversationsResponse
let thread: Record<string, unknown>
let threads: Record<string, Record<string, unknown>>
let sent: Record<string, unknown>[]
let failNextSend = false

beforeEach(() => {
  sent = []
  failNextSend = false
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,doodle'
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      setTransform: () => undefined,
      clearRect: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      fill: () => undefined,
      arc: () => undefined,
      drawImage: () => undefined,
      fillRect: () => undefined,
      save: () => undefined,
      restore: () => undefined,
    }),
  })
  listing = {
    configured: true,
    from_number: '+18005550100',
    quick_replies: ["Dinner's ready", 'Call me', "On my way?"],
    conversations: [
      {
        id: 'user-3',
        user_id: 3,
        name: 'Austin',
        phone: '+15555550123',
        color: '#3b82f6',
        avatar_emoji: null,
        unknown: false,
        can_send: true,
        last_message: {
          id: 1,
          user_id: 3,
          phone: '+15555550123',
          direction: 'in',
          body: 'See you soon',
          media_url: null,
          media_content_type: null,
          status: 'received',
          error_message: null,
          created_at: '2026-11-22T18:00:00Z',
        },
      },
      {
        id: 'user-4',
        user_id: 4,
        name: 'Sam',
        phone: null,
        color: '#f97316',
        avatar_emoji: null,
        unknown: false,
        can_send: false,
        last_message: null,
      },
    ],
  }
  thread = {
    id: 'user-3',
    user_id: 3,
    name: 'Austin',
    phone: '+15555550123',
    color: '#3b82f6',
    avatar_emoji: null,
    unknown: false,
    can_send: true,
    messages: [
      {
        id: 1,
        user_id: 3,
        phone: '+15555550123',
        direction: 'in',
        body: 'See you soon',
        media_url: null,
        media_content_type: null,
        status: 'received',
        error_message: null,
        created_at: '2026-11-22T18:00:00Z',
      },
      {
        id: 2,
        user_id: 3,
        phone: '+15555550123',
        direction: 'out',
        body: 'For you',
        media_url: '/api/messages/2/media',
        media_content_type: 'image/png',
        status: 'delivered',
        error_message: null,
        created_at: '2026-11-22T18:01:00Z',
      },
    ],
  }
  threads = {
    'user-3': thread,
    'user-4': {
      id: 'user-4',
      user_id: 4,
      name: 'Sam',
      phone: null,
      color: '#f97316',
      avatar_emoji: null,
      unknown: false,
      can_send: false,
      messages: [],
    },
  }
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/messages/conversations') return json(listing)
      if (url.startsWith('/api/messages/conversations/')) {
        const id = url.split('/').pop() as string
        return json(threads[id] ?? thread)
      }
      if (url === '/api/users')
        return json([
          { id: 3, name: 'Austin', color: '#3b82f6', avatar_emoji: null, sort_order: 0, phone: '+15555550123' },
          { id: 4, name: 'Sam', color: '#f97316', avatar_emoji: null, sort_order: 1, phone: null },
        ])
      if (url === '/api/settings')
        return json({ server: { twilio_configured: listing.configured, messages_configured: listing.configured }, screensaver_enabled: false })
      if (url === '/api/messages' && method === 'POST') {
        if (failNextSend) {
          failNextSend = false
          return json({ error: { message: 'Twilio said no' } }, 502)
        }
        const body = JSON.parse(String(init!.body))
        sent.push(body)
        return json({ id: 9, ...body, direction: 'out', status: 'queued', media_url: body.media_base64 ? '/api/messages/9/media' : null }, 201)
      }
      return json({})
    }),
  )
})
afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
})

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
}

async function renderList(path = '/messages') {
  mount(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:id" element={<MessageThreadPage />} />
          <Route path="/settings" element={<div>Settings messages tab</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await settle()
}

describe('Messages page', () => {
  it('asks a grown-up to turn on Messages when it is not configured', async () => {
    listing.configured = false
    listing.conversations = []
    await renderList()
    expect(document.body.textContent).toContain('Ask a grown-up to turn on Messages in Settings')
    const link = document.querySelector('a[href="/settings?tab=messages"]')
    expect(link).toBeTruthy()
    expect(link?.textContent).toContain('Open Messages settings')
  })

  it('lists family members with phones and opens a thread with a doodle', async () => {
    await renderList()
    expect(document.body.textContent).toContain('Austin')
    expect(document.body.textContent).toContain('See you soon')
    expect(document.body.textContent).toContain('Sam')
    expect(document.body.textContent).toContain('Ask a grown-up to add a phone number')
    click(document.querySelector('a[href="/messages/user-3"]')!)
    await settle()
    expect(document.querySelector('.messages__back')).toBeTruthy()
    expect(document.body.textContent).toContain('Austin')
    expect(document.querySelector('img.messages__pic')).toBeTruthy()
    expect(document.querySelector('img.messages__pic')?.getAttribute('src')).toBe('/api/messages/2/media')
    expect(document.body.textContent).toContain('Delivered')
    const box = document.querySelector('textarea')!
    type(box, 'On the way')
    click(byText('Send')!)
    await settle()
    expect(sent).toEqual([{ user_id: 3, body: 'On the way' }])
    expect(document.body.textContent).toContain('Sent!')
  })

  it('sends a quick reply in one tap', async () => {
    await renderList('/messages/user-3')
    click(byText("Dinner's ready")!)
    await settle()
    expect(sent).toEqual([{ user_id: 3, body: "Dinner's ready" }])
    expect(document.body.textContent).toContain('Sent!')
  })

  it('opens a full-screen drawing pad from Draw and sends the doodle back to the thread', async () => {
    await renderList('/messages/user-3')
    const draw = document.querySelector('.messages__draw') as HTMLButtonElement
    expect(draw).toBeTruthy()
    expect(draw.textContent).toMatch(/^Draw$/)
    click(draw)
    await settle()
    expect(document.querySelector('canvas.doodle__canvas')).toBeTruthy()
    expect(document.querySelector('.messages__doodle .messages__title')?.textContent).toContain('Draw a picture')
    expect(document.querySelector('.messages__back')?.textContent).toMatch(/Back/)
    expect(byText('Cancel')).toBeTruthy()
    expect(byText('Eraser')).toBeTruthy()
    expect(byText('Undo')).toBeTruthy()
    expect(byText('Clear')).toBeTruthy()
    expect(document.querySelector('.doodle--simple')).toBeTruthy()
    expect(document.querySelector('.doodle__sizes')).toBeNull()

    const sendBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.messages__doodle .btn--primary')).find(
      (btn) => btn.textContent === 'Send' || btn.textContent === 'Sending…',
    )!
    expect(sendBtn.disabled).toBe(true)
    const canvas = document.querySelector('canvas.doodle__canvas')!
    pointer(canvas, 'pointerdown', 20, 20)
    pointer(canvas, 'pointerup', 40, 30)
    await settle()
    expect(sendBtn.disabled).toBe(false)
    click(sendBtn)
    await settle()
    expect(sent).toEqual([{ user_id: 3, body: '', media_base64: 'data:image/png;base64,doodle' }])
    expect(document.querySelector('canvas.doodle__canvas')).toBeNull()
    expect(document.body.textContent).toContain('Sent!')
  })

  it('shows a Draw a picture button on the list that opens a canvas, then the family picker', async () => {
    await renderList()
    const start = byText('Draw a picture')
    expect(start).toBeTruthy()
    click(start!)
    await settle()
    expect(document.querySelector('canvas.doodle__canvas')).toBeTruthy()
    expect(document.querySelector('.messages__back')?.textContent).toMatch(/Back/)
    expect(byText('Cancel')).toBeTruthy()
    const sendTo = Array.from(document.querySelectorAll<HTMLButtonElement>('.messages__doodle .btn--primary')).find(
      (btn) => btn.textContent === 'Send',
    )!
    expect(sendTo.disabled).toBe(true)

    const canvas = document.querySelector('canvas.doodle__canvas')!
    pointer(canvas, 'pointerdown', 20, 20)
    pointer(canvas, 'pointerup', 40, 30)
    await settle()
    expect(sendTo.disabled).toBe(false)
    click(sendTo)
    await settle()
    expect(document.body.textContent).toContain('Who should get this?')
    expect(document.body.textContent).toContain('Austin')
    expect(document.body.textContent).toContain('Ask a grown-up to add a phone number')
    const austin = Array.from(document.querySelectorAll<HTMLButtonElement>('.doodle-send__person')).find(
      (btn) => btn.textContent?.includes('Austin'),
    )!
    click(austin)
    click(byText('Send')!)
    await settle()
    expect(sent).toEqual([{ user_id: 3, body: '', media_base64: 'data:image/png;base64,doodle' }])
    expect(document.body.textContent).toContain('Sent to Austin')
    expect(document.querySelector('.doodle-send__thread')?.textContent).toContain('See messages')
  })

  it('lets you cancel the list doodle and go back to the people list', async () => {
    await renderList()
    click(byText('Draw a picture')!)
    await settle()
    click(document.querySelector('.messages__back')!)
    await settle()
    expect(document.querySelector('canvas.doodle__canvas')).toBeNull()
    expect(document.querySelector('a[href="/messages/user-3"]')).toBeTruthy()
  })

  it('offers Draw on this on an inbound picture', async () => {
    threads['user-3'] = {
      ...thread,
      messages: [
        {
          id: 8,
          user_id: 3,
          phone: '+15555550123',
          direction: 'in',
          body: null,
          media_url: '/api/messages/8/media',
          media_content_type: 'image/png',
          status: 'received',
          error_message: null,
          created_at: '2026-11-22T18:02:00Z',
        },
      ],
    }
    await renderList('/messages/user-3')
    const link = document.querySelector('a.messages__open-doodle')
    expect(link?.textContent).toContain('Draw on this')
    expect(link?.getAttribute('href')).toContain('/games/doodle?')
    expect(link?.getAttribute('href')).toContain('media=%2Fapi%2Fmessages%2F8%2Fmedia')
    expect(link?.getAttribute('href')).toContain('replyTo=3')
    expect(document.querySelector('.messages__draw')?.textContent).toMatch(/^Draw$/)
  })

  it('still shows Draw a picture when messaging is not set up', async () => {
    listing.configured = false
    listing.conversations = []
    await renderList()
    expect(byText('Draw a picture')).toBeTruthy()
    expect(document.body.textContent).toContain('Ask a grown-up to turn on Messages in Settings')
  })

  it('shows a gentle no-send state for a family member without a phone', async () => {
    await renderList('/messages/user-4')
    expect(document.body.textContent).toContain('Ask a grown-up to add a phone number so you can send messages to Sam.')
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.querySelector('.messages__draw')).toBeNull()
    expect(document.querySelector('.messages__chip')).toBeNull()
    expect(document.querySelector('.messages__back')).toBeTruthy()
  })

  it('turns a failed send into a friendly message', async () => {
    failNextSend = true
    await renderList('/messages/user-3')
    type(document.querySelector('textarea')!, 'Hello')
    click(byText('Send')!)
    await settle()
    expect(document.body.textContent).toContain("Couldn't send that. Try again in a moment.")
    expect(sent).toEqual([])
  })

  it('maps setup and phone errors into short grown-up prompts', () => {
    expect(friendlySendError(new Error('Add your Twilio or Signal details in Settings'))).toContain(
      'Ask a grown-up to finish Messages settings',
    )
    expect(friendlySendError(new Error('Sam does not have a phone number yet.'))).toContain(
      'Ask a grown-up to add a phone number first.',
    )
  })
})
