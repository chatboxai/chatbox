import { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'

const chessToolSchemas = [
  {
    name: 'start_game',
    description:
      'Start a new chess game. Call this when the user wants to play chess.',
    parameters: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          enum: ['white', 'black'],
          description: 'The color the user wants to play as. Defaults to white.',
        },
      },
    },
  },
  {
    name: 'make_move',
    description:
      'Make a chess move on the board using square coordinates. Use this to make moves for the AI or when the user asks you to move a piece.',
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Source square in algebraic notation, e.g. e2',
        },
        to: {
          type: 'string',
          description: 'Destination square in algebraic notation, e.g. e4',
        },
        promotion: {
          type: 'string',
          enum: ['q', 'r', 'b', 'n'],
          description: 'Piece to promote to (only needed for pawn promotion)',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_board_state',
    description:
      'Get the current chess board position, whose turn it is, and game status. Use this to analyze the position when the user asks for help.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
]

type PlayerColor = 'white' | 'black'

export interface ChessProtocolState {
  game: Chess
  playerColor: PlayerColor
  gameStarted: boolean
  status: string
  onDrop: (sourceSquare: string, targetSquare: string) => boolean
}

function buildBoardState(g: Chess) {
  return {
    fen: g.fen(),
    turn: g.turn(),
    moveCount: g.history().length,
    inCheck: g.inCheck(),
    isCheckmate: g.isCheckmate(),
    isDraw: g.isDraw(),
    isStalemate: g.isStalemate(),
    isGameOver: g.isGameOver(),
  }
}

function computeStatus(g: Chess, playerColor: PlayerColor): string {
  if (g.isCheckmate()) {
    const winner = g.turn() === 'w' ? 'Black' : 'White'
    return `Checkmate! ${winner} wins!`
  }
  if (g.isStalemate()) return 'Stalemate! The game is a draw.'
  if (g.isDraw()) return "It's a draw!"
  if (g.inCheck()) {
    const inCheckSide = g.turn() === 'w' ? 'White' : 'Black'
    return `${inCheckSide} is in check!`
  }
  const toMove = g.turn() === 'w' ? 'White' : 'Black'
  const isYourTurn =
    (playerColor === 'white' && g.turn() === 'w') ||
    (playerColor === 'black' && g.turn() === 'b')
  const moveNum = Math.ceil((g.history().length + 1) / 2)
  return `Move ${moveNum} — ${toMove} to move.${isYourTurn ? ' Your turn!' : ''}`
}

export function useChessProtocol(): ChessProtocolState {
  const [game, setGame] = useState(() => new Chess())
  const [playerColor, setPlayerColor] = useState<PlayerColor>('white')
  const [gameStarted, setGameStarted] = useState(false)
  const [status, setStatus] = useState('Waiting for game to start...')

  // Refs so event handler closure always has current values
  const gameRef = useRef(game)
  const playerColorRef = useRef(playerColor)
  const gameStartedRef = useRef(gameStarted)
  gameRef.current = game
  playerColorRef.current = playerColor
  gameStartedRef.current = gameStarted

  useEffect(() => {
    window.parent.postMessage({ type: 'ready' }, '*')
    window.parent.postMessage({ type: 'register_tools', schemas: chessToolSchemas }, '*')

    function sendToolResult(toolCallId: string, result: unknown) {
      window.parent.postMessage({ type: 'tool_result', toolCallId, result }, '*')
    }

    function sendStateUpdate(g: Chess) {
      window.parent.postMessage({ type: 'state_update', state: buildBoardState(g) }, '*')
    }

    function sendCompletion(g: Chess) {
      let outcome: string
      if (g.isCheckmate()) {
        outcome = g.turn() === 'w' ? 'black_wins' : 'white_wins'
      } else {
        outcome = 'draw'
      }
      window.parent.postMessage({
        type: 'completion',
        result: { outcome, moveCount: g.history().length, finalFen: g.fen() },
      }, '*')
    }

    function handleToolInvoke(
      toolCallId: string,
      toolName: string,
      params: Record<string, unknown>,
    ) {
      const currentGame = gameRef.current

      switch (toolName) {
        case 'start_game': {
          const color = params.color === 'black' ? 'black' : 'white'
          const newGame = new Chess()
          gameRef.current = newGame
          setGame(newGame)
          setPlayerColor(color)
          setGameStarted(true)
          setStatus(
            `Game started. You're playing ${color}. ${
              color === 'white' ? 'Your turn — white goes first!' : "White goes first."
            }`,
          )
          sendToolResult(toolCallId, {
            fen: newGame.fen(),
            turn: newGame.turn(),
            playerColor: color,
            message: `Chess game started. Player is ${color}.`,
          })
          sendStateUpdate(newGame)
          break
        }

        case 'make_move': {
          const { from, to, promotion } = params as {
            from: string
            to: string
            promotion?: string
          }
          const newGame = new Chess(currentGame.fen())
          try {
            const move = newGame.move({
              from,
              to,
              promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined,
            })
            if (!move) {
              sendToolResult(toolCallId, {
                error: `Illegal move: ${from} to ${to}`,
                fen: currentGame.fen(),
              })
              return
            }
            gameRef.current = newGame
            setGame(newGame)
            setStatus(computeStatus(newGame, playerColorRef.current))
            const state = buildBoardState(newGame)
            sendToolResult(toolCallId, { ...state, move: move.san })
            sendStateUpdate(newGame)
            if (newGame.isGameOver()) sendCompletion(newGame)
          } catch {
            sendToolResult(toolCallId, {
              error: `Invalid move: ${from} to ${to}`,
              fen: currentGame.fen(),
            })
          }
          break
        }

        case 'get_board_state': {
          sendToolResult(toolCallId, buildBoardState(currentGame))
          break
        }

        default:
          sendToolResult(toolCallId, { error: `Unknown tool: ${toolName}` })
      }
    }

    function handler(event: MessageEvent) {
      if (!event.data || event.data.type !== 'tool_invoke') return
      const { toolCallId, toolName, params } = event.data as {
        toolCallId: string
        toolName: string
        params: Record<string, unknown>
      }
      handleToolInvoke(toolCallId, toolName, params)
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onDrop(sourceSquare: string, targetSquare: string): boolean {
    const currentGame = gameRef.current
    if (!gameStartedRef.current) return false

    const isPlayerTurn =
      (playerColorRef.current === 'white' && currentGame.turn() === 'w') ||
      (playerColorRef.current === 'black' && currentGame.turn() === 'b')
    if (!isPlayerTurn) return false

    const newGame = new Chess(currentGame.fen())
    try {
      const move = newGame.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
      if (!move) return false

      gameRef.current = newGame
      setGame(newGame)
      setStatus(computeStatus(newGame, playerColorRef.current))

      window.parent.postMessage(
        { type: 'state_update', state: buildBoardState(newGame) },
        '*',
      )
      if (newGame.isGameOver()) {
        let outcome: string
        if (newGame.isCheckmate()) {
          outcome = newGame.turn() === 'w' ? 'black_wins' : 'white_wins'
        } else {
          outcome = 'draw'
        }
        window.parent.postMessage({
          type: 'completion',
          result: { outcome, moveCount: newGame.history().length, finalFen: newGame.fen() },
        }, '*')
      }
      return true
    } catch {
      return false
    }
  }

  return { game, playerColor, gameStarted, status, onDrop }
}
