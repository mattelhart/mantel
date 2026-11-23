import { describe, expect, it } from 'vitest'
import { EMPTY_BOARD, bestMove, play, turnOf, winnerOf, type Board } from './ticTacToe'

function board(cells: string): Board {
  return cells.split('').map((ch) => (ch === 'X' || ch === 'O' ? ch : null))
}

describe('tic-tac-toe', () => {
  it('starts with X and rejects a square that is already taken', () => {
    expect(turnOf(EMPTY_BOARD)).toBe('X')
    const after = play(EMPTY_BOARD, 0)
    expect(after[0]).toBe('X')
    expect(turnOf(after)).toBe('O')
    expect(() => play(after, 0)).toThrow(/already taken/)
  })

  it('detects a row, a column, a diagonal, and a draw', () => {
    expect(winnerOf(board('XXX------'))).toBe('X')
    expect(winnerOf(board('O--O--O--'))).toBe('O')
    expect(winnerOf(board('X---X---X'))).toBe('X')
    expect(winnerOf(board('XOXOXXOXO'))).toBe('draw')
    expect(winnerOf(board('XOX------'))).toBeNull()
  })

  it('refuses a move after the game is over', () => {
    expect(() => play(board('XXX------'), 8)).toThrow(/already over/)
  })

  it('refuses a square off the board', () => {
    expect(() => play(EMPTY_BOARD, 9)).toThrow(/off the board/)
  })

  it('the AI takes a winning move when one is open', () => {
    // O to play (X has one more mark) and can complete the first row at index 2.
    const position = board('OO-X-XX--')
    expect(turnOf(position)).toBe('O')
    expect(winnerOf(position)).toBeNull()
    const move = bestMove(position, 'O')
    expect(winnerOf(play(position, move))).toBe('O')
  })

  it('the AI blocks an immediate threat', () => {
    // X has the top row one short; blocking at 2 is the only way not to lose now.
    const position = board('XX--O----')
    expect(turnOf(position)).toBe('O')
    expect(bestMove(position, 'O')).toBe(2)
  })

  it('perfect play never loses from an empty board', () => {
    let position: Board = EMPTY_BOARD
    while (!winnerOf(position)) {
      const mark = turnOf(position)
      position = play(position, bestMove(position, mark))
    }
    expect(winnerOf(position)).toBe('draw')
  })
})
