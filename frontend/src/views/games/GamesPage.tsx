import { Link, Navigate, useParams } from 'react-router-dom'
import { DoodlePad } from './DoodlePad'
import { GameFrame, GameShell } from './GameShell'
import { TicTacToeGame } from './TicTacToeGame'
import { GAMES, findGame } from './catalog'

export function GamesPage() {
  return (
    <div className="games">
      <header className="games__bar">
        <h1 className="games__title">Games</h1>
      </header>
      <div className="games__grid">
        {GAMES.map((game) => (
          <Link key={game.id} to={`/games/${game.id}`} className="games__card">
            <span className="games__badge" style={{ background: game.accent }} aria-hidden="true">
              {badge(game.id)}
            </span>
            <span className="games__name">{game.name}</span>
            <span className="games__blurb">{game.blurb}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function GamePlayPage() {
  const { id } = useParams()
  const game = findGame(id)
  if (!game) return <Navigate to="/games" replace />

  if (game.kind === 'iframe' && game.src) {
    return <GameFrame title={game.name} src={game.src} swipe={game.swipe} />
  }
  if (game.id === 'tic-tac-toe') {
    return (
      <GameShell title={game.name}>
        <TicTacToeGame />
      </GameShell>
    )
  }
  if (game.id === 'doodle') {
    return (
      <GameShell title={game.name} swipe={game.swipe}>
        <DoodlePad />
      </GameShell>
    )
  }
  return <Navigate to="/games" replace />
}

function badge(id: string): string {
  switch (id) {
    case '2048':
      return '2048'
    case 'memory':
      return '🃏'
    case 'minesweeper':
      return '💣'
    case 'tic-tac-toe':
      return '✕○'
    default:
      return '✎'
  }
}
