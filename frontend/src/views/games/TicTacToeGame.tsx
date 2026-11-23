import { useMemo, useState } from 'react'
import { EMPTY_BOARD, bestMove, play, turnOf, winnerOf, type Board } from './ticTacToe'

type Mode = 'two' | 'ai'

export function TicTacToeGame() {
  const [mode, setMode] = useState<Mode>('ai')
  const [board, setBoard] = useState<Board>(EMPTY_BOARD)

  const outcome = winnerOf(board)
  const turn = turnOf(board)
  const status = useMemo(() => {
    if (outcome === 'draw') return 'Draw.'
    if (outcome) return `${outcome} wins.`
    if (mode === 'ai' && turn === 'O') return 'Thinking…'
    return `${turn}'s turn`
  }, [mode, outcome, turn])

  function start(next: Mode) {
    setMode(next)
    setBoard(EMPTY_BOARD)
  }

  function tap(index: number) {
    if (outcome) return
    if (mode === 'ai' && turn === 'O') return
    let next: Board
    try {
      next = play(board, index)
    } catch {
      return
    }
    if (mode === 'ai' && !winnerOf(next) && turnOf(next) === 'O') {
      next = play(next, bestMove(next, 'O'))
    }
    setBoard(next)
  }

  return (
    <div className="ttt">
      <div className="ttt__modes" role="group" aria-label="Game mode">
        <button type="button" className="ttt__mode" data-on={mode === 'ai'} onClick={() => start('ai')}>
          Play the wall
        </button>
        <button type="button" className="ttt__mode" data-on={mode === 'two'} onClick={() => start('two')}>
          Two players
        </button>
      </div>
      <p className="ttt__status" role="status">
        {status}
      </p>
      <div className="ttt__board" role="grid" aria-label="Tic-tac-toe">
        {board.map((cell, index) => (
          <button
            key={index}
            type="button"
            role="gridcell"
            className="ttt__cell"
            aria-label={cell ? `${cell} in square ${index + 1}` : `Empty square ${index + 1}`}
            disabled={Boolean(outcome || cell || (mode === 'ai' && turn === 'O'))}
            onClick={() => tap(index)}
          >
            {cell}
          </button>
        ))}
      </div>
      <button type="button" className="ttt__again" onClick={() => setBoard(EMPTY_BOARD)}>
        New game
      </button>
    </div>
  )
}
