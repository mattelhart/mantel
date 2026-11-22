export type GameId = '2048' | 'memory' | 'minesweeper' | 'tic-tac-toe' | 'doodle'

export interface GameInfo {
  id: GameId
  name: string
  blurb: string
  kind: 'iframe' | 'native'
  /** Same-origin path under /games/, only for vendored iframe games. */
  src?: string
  /** Swipe or drag play — leave a left gutter so the Pi's edge-swipe can go back. */
  swipe: boolean
  accent: string
}

export const GAMES: GameInfo[] = [
  {
    id: '2048',
    name: '2048',
    blurb: 'Slide the tiles. Combine the numbers. Reach 2048.',
    kind: 'iframe',
    src: '/games/2048/index.html',
    swipe: true,
    accent: '#f2b179',
  },
  {
    id: 'memory',
    name: 'Memory match',
    blurb: 'Flip two cards at a time and find every pair.',
    kind: 'iframe',
    src: '/games/memory-match/index.html',
    swipe: false,
    accent: '#7eb8da',
  },
  {
    id: 'minesweeper',
    name: 'Minesweeper',
    blurb: 'Clear the board. Long-press to flag a mine.',
    kind: 'iframe',
    src: '/games/minesweeper/index.html',
    swipe: false,
    accent: '#8fbc8f',
  },
  {
    id: 'tic-tac-toe',
    name: 'Tic-tac-toe',
    blurb: 'Two players, or a short game against the wall.',
    kind: 'native',
    swipe: false,
    accent: '#e8a0bf',
  },
  {
    id: 'doodle',
    name: 'Doodle pad',
    blurb: 'A scratch pad you can send to a family member\'s phone.',
    kind: 'native',
    swipe: true,
    accent: '#c4b5fd',
  },
]

export function findGame(id: string | undefined): GameInfo | undefined {
  return GAMES.find((game) => game.id === id)
}
