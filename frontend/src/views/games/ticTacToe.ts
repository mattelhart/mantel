export type Mark = 'X' | 'O'
export type Cell = Mark | null
export type Board = readonly Cell[]
export type Outcome = Mark | 'draw'

const LINES: readonly (readonly number[])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

export const EMPTY_BOARD: Board = [null, null, null, null, null, null, null, null, null]

export function winnerOf(board: Board): Outcome | null {
  for (const [a, b, c] of LINES) {
    const mark = board[a]
    if (mark && mark === board[b] && mark === board[c]) return mark
  }
  if (board.every((cell) => cell !== null)) return 'draw'
  return null
}

export function turnOf(board: Board): Mark {
  const filled = board.filter((cell) => cell !== null).length
  return filled % 2 === 0 ? 'X' : 'O'
}

export function play(board: Board, index: number): Board {
  if (index < 0 || index > 8) throw new Error('That square is off the board.')
  if (board[index] !== null) throw new Error('That square is already taken.')
  if (winnerOf(board)) throw new Error('The game is already over.')
  const next = board.slice()
  next[index] = turnOf(board)
  return next
}

/** Best square for `mark` under perfect play. Used by the wall's simple AI. */
export function bestMove(board: Board, mark: Mark): number {
  const outcome = winnerOf(board)
  if (outcome) throw new Error('The game is already over.')
  if (turnOf(board) !== mark) throw new Error('It is not that player\'s turn.')

  let choice = -1
  let best = -Infinity
  for (let i = 0; i < 9; i += 1) {
    if (board[i] !== null) continue
    // Depth-weighted so an immediate win beats a slower forced win (and a later
    // loss beats losing on the next ply). Centre/corners only break true ties.
    const score = -minimax(play(board, i), opponent(mark), 0)
    const bias = i === 4 ? 0.02 : [0, 2, 6, 8].includes(i) ? 0.01 : 0
    if (score + bias > best) {
      best = score + bias
      choice = i
    }
  }
  if (choice < 0) throw new Error('No moves left.')
  return choice
}

function opponent(mark: Mark): Mark {
  return mark === 'X' ? 'O' : 'X'
}

function minimax(board: Board, mark: Mark, depth: number): number {
  const outcome = winnerOf(board)
  if (outcome === 'draw') return 0
  if (outcome) return (outcome === mark ? 1 : -1) * (9 - depth)
  let best = -Infinity
  for (let i = 0; i < 9; i += 1) {
    if (board[i] !== null) continue
    best = Math.max(best, -minimax(play(board, i), opponent(mark), depth + 1))
  }
  return best
}
