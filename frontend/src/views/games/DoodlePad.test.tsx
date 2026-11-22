// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { byText, click, mount, pointer, type, unmount } from '../../components/testDom'
import { GamePlayPage } from './GamesPage'
import type { User } from '../../api/types'

const PNG = 'data:image/png;base64,doodle'

const USERS: User[] = [
  { id: 1, name: 'Austin', color: '#3b82f6', avatar_emoji: null, sort_order: 0, phone: '+15555550123' },
  { id: 2, name: 'Sam', color: '#f97316', avatar_emoji: null, sort_order: 1, phone: null },
  { id: 3, name: 'Brooklyn', color: '#22c55e', avatar_emoji: null, sort_order: 2, phone: '+15555550124' },
]

let configured = true
let sent: Record<string, unknown>[]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  configured = true
  sent = []
  HTMLCanvasElement.prototype.toDataURL = () => PNG
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

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/users') return json(USERS)
      if (url === '/api/settings')
        return json({ server: { twilio_configured: configured }, screensaver_enabled: false })
      if (url === '/api/messages' && method === 'POST') {
        const body = JSON.parse(String(init!.body))
        sent.push(body)
        return json({ id: 9, ...body, direction: 'out', status: 'queued' }, 201)
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
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
}

async function renderPad(path = '/games/doodle') {
  mount(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/games/:id" element={<GamePlayPage />} />
          <Route path="/messages/:id" element={<div>Thread</div>} />
          <Route path="/settings" element={<div>Settings messages tab</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await settle()
}

function drawStroke() {
  const canvas = document.querySelector('canvas.doodle__canvas')!
  pointer(canvas, 'pointerdown', 20, 20)
  pointer(canvas, 'pointerup', 40, 30)
}

describe('Doodle pad send', () => {
  it('opens a family picker, skips people without a phone, and texts the drawing', async () => {
    await renderPad()
    const sendTo = byText('Send to…')!
    expect(sendTo).toBeTruthy()
    expect((sendTo as HTMLButtonElement).disabled).toBe(true)

    drawStroke()
    await settle()
    expect((byText('Send to…') as HTMLButtonElement).disabled).toBe(false)

    click(byText('Send to…')!)
    await settle()

    expect(document.querySelector('.doodle-send')).toBeTruthy()
    expect(document.querySelector('.doodle-send__back')?.textContent).toMatch(/Back/)
    expect(document.body.textContent).toContain('Austin')
    expect(document.body.textContent).toContain('Brooklyn')
    expect(document.body.textContent).toContain('Sam')
    expect(document.body.textContent).toContain('Ask a grown-up to add a phone number')

    const sam = Array.from(document.querySelectorAll<HTMLButtonElement>('.doodle-send__person')).find(
      (btn) => btn.textContent?.includes('Sam'),
    )!
    expect(sam.disabled).toBe(true)

    const austin = Array.from(document.querySelectorAll<HTMLButtonElement>('.doodle-send__person')).find(
      (btn) => btn.textContent?.includes('Austin'),
    )!
    click(austin)
    type(document.querySelector('.doodle-send__caption input')!, 'For you')
    click(byText('Send')!)
    await settle()

    expect(sent).toEqual([{ user_id: 1, body: 'For you', media_base64: PNG }])
    expect(document.body.textContent).toContain('Sent to Austin')
    expect(document.querySelector('.doodle-send__thread')?.textContent).toContain('See messages')
    expect(document.querySelector('.doodle-send__back')?.textContent).toMatch(/Done/)
  })

  it('sends to more than one person and offers each thread', async () => {
    await renderPad()
    drawStroke()
    await settle()
    click(byText('Send to…')!)
    await settle()
    for (const name of ['Austin', 'Brooklyn']) {
      const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.doodle-send__person')).find(
        (btn) => btn.textContent?.includes(name),
      )!
      click(row)
    }
    click(byText('Send to 2')!)
    await settle()
    expect(sent).toEqual([
      { user_id: 1, body: '', media_base64: PNG },
      { user_id: 3, body: '', media_base64: PNG },
    ])
    expect(document.body.textContent).toContain('Sent to Austin and Brooklyn')
    expect(document.querySelector('a.doodle-send__thread[href="/messages/user-1"]')?.textContent).toContain("See Austin's messages")
    expect(document.querySelector('a.doodle-send__thread[href="/messages/user-3"]')?.textContent).toContain("See Brooklyn's messages")
  })

  it('keeps the Send to… button when Twilio is missing and points to Settings', async () => {
    configured = false
    await renderPad()
    expect(byText('Send to…')).toBeTruthy()
    drawStroke()
    await settle()
    click(byText('Send to…')!)
    await settle()
    expect(document.body.textContent).toContain('Ask a grown-up to turn on Messages in Settings')
    const link = document.querySelector('a[href="/settings?tab=messages"]')
    expect(link?.textContent).toContain('Open Messages settings')
    click(document.querySelector('.doodle-send__back')!)
    await settle()
    expect(document.querySelector('.doodle-send')).toBeNull()
    expect(document.querySelector('canvas.doodle__canvas')).toBeTruthy()
  })

  it('preselects a reply-to person from an inbound picture', async () => {
    await renderPad('/games/doodle?replyTo=3&media=/api/messages/12/media')
    drawStroke()
    await settle()
    click(byText('Send to…')!)
    await settle()
    const brooklyn = Array.from(document.querySelectorAll<HTMLButtonElement>('.doodle-send__person')).find(
      (btn) => btn.textContent?.includes('Brooklyn'),
    )!
    expect(brooklyn.getAttribute('aria-pressed')).toBe('true')
    click(byText('Cancel')!)
    await settle()
    expect(document.querySelector('.doodle-send')).toBeNull()
  })
})
