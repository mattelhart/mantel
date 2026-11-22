// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { byText, click, mount, pointer, type, unmount } from '../../components/testDom'
import { MessagesPage, MessageThreadPage, type ConversationsResponse } from './MessagesPage'

let listing: ConversationsResponse
let thread: Record<string, unknown>
let sent: Record<string, unknown>[]

beforeEach(() => {
  sent = []
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
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/messages/conversations') return json(listing)
      if (url.startsWith('/api/messages/conversations/')) return json(thread)
      if (url === '/api/users')
        return json([
          { id: 3, name: 'Austin', color: '#3b82f6', avatar_emoji: null, sort_order: 0, phone: '+15555550123' },
          { id: 4, name: 'Sam', color: '#f97316', avatar_emoji: null, sort_order: 1, phone: null },
        ])
      if (url === '/api/settings')
        return json({ server: { twilio_configured: listing.configured }, screensaver_enabled: false })
      if (url === '/api/messages' && method === 'POST') {
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
  it('asks the user to add Twilio details when it is not configured', async () => {
    listing.configured = false
    listing.conversations = []
    await renderList()
    expect(document.body.textContent).toContain('Add your Twilio or Signal details in Settings')
    const link = document.querySelector('a[href="/settings?tab=messages"]')
    expect(link).toBeTruthy()
    expect(link?.textContent).toContain('Open Messages settings')
  })

  it('lists family members with phones and opens a thread with a doodle', async () => {
    await renderList()
    expect(document.body.textContent).toContain('Austin')
    expect(document.body.textContent).toContain('See you soon')
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
  })

  it('sends a quick reply in one tap', async () => {
    await renderList('/messages/user-3')
    click(byText("Dinner's ready")!)
    await settle()
    expect(sent).toEqual([{ user_id: 3, body: "Dinner's ready" }])
  })

  it('shows a Send doodle button on the list that opens a canvas, then the family picker', async () => {
    await renderList()
    const start = byText('Send doodle')
    expect(start).toBeTruthy()
    click(start!)
    await settle()
    expect(document.querySelector('canvas.doodle__canvas')).toBeTruthy()
    expect(document.querySelector('.messages__back')?.textContent).toMatch(/Back/)
    const sendTo = byText('Send to…') as HTMLButtonElement
    expect(sendTo.disabled).toBe(true)

    const canvas = document.querySelector('canvas.doodle__canvas')!
    pointer(canvas, 'pointerdown', 20, 20)
    pointer(canvas, 'pointerup', 40, 30)
    await settle()
    expect((byText('Send to…') as HTMLButtonElement).disabled).toBe(false)
    click(byText('Send to…')!)
    await settle()
    expect(document.body.textContent).toContain('Austin')
    expect(document.body.textContent).toContain('No phone saved')
    const austin = Array.from(document.querySelectorAll<HTMLButtonElement>('.doodle-send__person')).find(
      (btn) => btn.textContent?.includes('Austin'),
    )!
    click(austin)
    click(byText('Send')!)
    await settle()
    expect(sent).toEqual([{ user_id: 3, body: '', media_base64: 'data:image/png;base64,doodle' }])
    expect(document.body.textContent).toContain('Sent to Austin')
    expect(document.querySelector('.doodle-send__thread')?.textContent).toContain('Open thread')
  })

  it('lets you cancel the list doodle and go back to the people list', async () => {
    await renderList()
    click(byText('Send doodle')!)
    await settle()
    click(document.querySelector('.messages__back')!)
    await settle()
    expect(document.querySelector('canvas.doodle__canvas')).toBeNull()
    expect(document.querySelector('a[href="/messages/user-3"]')).toBeTruthy()
  })

  it('offers Open in Doodles on an inbound picture', async () => {
    thread = {
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
    expect(link?.textContent).toContain('Open in Doodles')
    expect(link?.getAttribute('href')).toContain('/games/doodle?')
    expect(link?.getAttribute('href')).toContain('media=%2Fapi%2Fmessages%2F8%2Fmedia')
    expect(link?.getAttribute('href')).toContain('replyTo=3')
    expect(byText('Doodle')).toBeTruthy()
  })

  it('still shows Send doodle when Twilio is not set up', async () => {
    listing.configured = false
    listing.conversations = []
    await renderList()
    expect(byText('Send doodle')).toBeTruthy()
    expect(document.body.textContent).toContain('Add your Twilio or Signal details in Settings')
  })
})
