// @vitest-environment jsdom
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { click, mount, unmount } from '../../components/testDom'
import { GamePlayPage, GamesPage } from './GamesPage'

function renderAt(path: string) {
  return mount(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/games" element={<GamesPage />} />
        <Route path="/games/:id" element={<GamePlayPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Games page', () => {
  afterEach(() => unmount())

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
    expect(root.querySelector('.gameplay__gutter')).toBeTruthy()
  })

  it('sends an unknown game back to the grid', () => {
    const root = renderAt('/games/not-a-game')
    expect(root.querySelector('.games__grid')).toBeTruthy()
  })
})
