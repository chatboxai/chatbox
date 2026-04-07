import { Chessboard } from 'react-chessboard'
import { useChessProtocol } from './hooks/useChessProtocol'

const BOARD_WIDTH = 400

export default function App() {
  const { game, playerColor, gameStarted, status, onDrop } = useChessProtocol()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px',
        gap: '12px',
        minHeight: '100vh',
        background: '#1a1a2e',
      }}
    >
      <div
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color: '#a0c4ff',
          letterSpacing: '0.5px',
        }}
      >
        Chess
      </div>

      <Chessboard
        id="chess-app"
        position={game.fen()}
        onPieceDrop={onDrop}
        boardOrientation={playerColor}
        boardWidth={BOARD_WIDTH}
        arePiecesDraggable={gameStarted}
      />

      <div
        style={{
          maxWidth: BOARD_WIDTH,
          width: '100%',
          padding: '10px 14px',
          background: '#16213e',
          borderRadius: '8px',
          border: '1px solid #0f3460',
          fontSize: '13px',
          color: game.isGameOver()
            ? '#ffd700'
            : game.inCheck()
            ? '#ff6b6b'
            : '#c0c0c0',
          textAlign: 'center',
        }}
      >
        {status}
      </div>

      {gameStarted && (
        <div
          style={{
            maxWidth: BOARD_WIDTH,
            width: '100%',
            fontSize: '12px',
            color: '#666',
            textAlign: 'center',
          }}
        >
          Moves: {game.history().length} &nbsp;|&nbsp; Playing: {playerColor}
        </div>
      )}
    </div>
  )
}
