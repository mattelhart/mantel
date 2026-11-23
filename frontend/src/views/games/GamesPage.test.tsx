// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, mount, unmount } from '../../components/testDom'
import { GamePlayPage, GamesPage } from './GamesPage'

const USERS = [
  { id: 1, name: 'Austin', color: '#3b82f6', avatar_emoji: null, sort_order: 0, phone: '+15555550123' },
  { id: 2, name: 'Sam', color: '#f97316', avatar_emoji: null, sort_order: 1, phone: null },
]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/users') return json(USERS)
      if (url === '/api/settings') return json({ server: { twilio_configured: true }, screensaver_enabled: false })
      return json({})
    }),
  )
})

function renderAt(path: string) {
  return mount(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/games" element={<GamesPage />} />
          <Route path="/games/:id" element={<GamePlayPage />} />
          <Route path="/settings" element={<div>Settings messages tab</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Games page', () => {
  afterEach(() => {
    unmount()
    vi.unstubAllGlobals()
  })

  it('shows a card for every starter game', () => {
    const root = renderAt('/games')
    const text = root.textContent ?? ''
    expect(text).toContain('2048')
    expect(text).toContain('Memory match')
    expect(text).toContain('Minesweeper')
    expect(text).toContain('Tic-tac-toe')
    expect(text).toContain('Doodle pad')
  })

  it('opens a vendored game in a sandboxed iframe with a Back button', () => {
    const root = renderAt('/games/2048')
    expect(root.querySelector('.gameplay__back')?.textContent).toMatch(/Back/)
    expect(root.querySelector('h1')?.textContent).toBe('2048')
    const frame = root.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('/games/2048/index.html')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(root.querySelector('.gameplay__gutter')).toBeTruthy()
  })

  it('opens tic-tac-toe as a native game and can play a move', () => {
    const root = renderAt('/games/tic-tac-toe')
    expect(root.querySelector('iframe')).toBeNull()
    const cells = root.querySelectorAll('.ttt__cell')
    expect(cells).toHaveLength(9)
    click(cells[0]!)
    expect(cells[0]!.textContent).toBe('X')
  })

  it('opens the doodle pad with colours, brush sizes, undo and clear', () => {
    const root = renderAt('/games/doodle')
    expect(root.querySelector('canvas.doodle__canvas')).toBeTruthy()
    expect(root.querySelectorAll('.doodle__swatch').length).toBeGreaterThan(3)
    expect(root.querySelectorAll('.doodle__size').length).toBeGreaterThan(1)
    expect(root.textContent).toContain('Undo')
    expect(root.textContent).toContain('Clear')
    expect(root.textContent).toContain('Send to…')
    expect(root.querySelector('.gameplay__back')?.textContent).toMatch(/Back/)
    expect(root.querySelector('.gameplay__gutter')).toBeTruthy()
  })

  it('sends an unknown game back to the grid', () => {
    const root = renderAt('/games/not-a-game')
    expect(root.querySelector('.games__grid')).toBeTruthy()
  })
})
