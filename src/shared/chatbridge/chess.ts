import { Chess, type Color, type Move, type PieceSymbol, type Square, validateFen } from 'chess.js'
import { z } from 'zod'
import {
  type ChatBridgeChessBoardContext,
  type ChatBridgeChessBoardPositionStatus,
  CHATBRIDGE_CHESS_BOARD_CONTEXT_SCHEMA_VERSION,
  ChatBridgeChessBoardContextSchema,
} from './reasoning-context'

export const CHATBRIDGE_CHESS_RUNTIME_SNAPSHOT_SCHEMA_VERSION = 1 as const

const ChessSquareSchema = z.string().regex(/^[a-h][1-8]$/)
const ChessPromotionSchema = z.enum(['q', 'r', 'b', 'n'])

export const ChatBridgeChessRuntimeStatusSchema = z.enum(['ready', 'active', 'stale'])
export type ChatBridgeChessRuntimeStatus = z.infer<typeof ChatBridgeChessRuntimeStatusSchema>

export const ChatBridgeChessRuntimeMoveSchema = z.object({
  san: z.string().min(1),
  uci: z.string().min(4),
  from: ChessSquareSchema,
  to: ChessSquareSchema,
  piece: z.string().min(1),
  color: z.enum(['white', 'black']),
  promotion: ChessPromotionSchema.optional(),
})

export type ChatBridgeChessRuntimeMove = z.infer<typeof ChatBridgeChessRuntimeMoveSchema>

export const ChatBridgeChessRuntimeFeedbackSchema = z.object({
  kind: z.enum(['info', 'accepted', 'rejected']),
  title: z.string().min(1),
  message: z.string().min(1),
})

export type ChatBridgeChessRuntimeFeedback = z.infer<typeof ChatBridgeChessRuntimeFeedbackSchema>

export const ChatBridgeChessRuntimeSnapshotSchema = z.object({
  schemaVersion: z.literal(CHATBRIDGE_CHESS_RUNTIME_SNAPSHOT_SCHEMA_VERSION),
  route: z.literal('/apps/chess'),
  status: ChatBridgeChessRuntimeStatusSchema,
  startingFen: z.string().min(1),
  moveHistory: z.array(ChatBridgeChessRuntimeMoveSchema),
  boardContext: ChatBridgeChessBoardContextSchema,
  feedback: ChatBridgeChessRuntimeFeedbackSchema.optional(),
})

export type ChatBridgeChessRuntimeSnapshot = z.infer<typeof ChatBridgeChessRuntimeSnapshotSchema>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toHostColor(color: Color): 'white' | 'black' {
  return color === 'w' ? 'white' : 'black'
}

function toUci(move: Pick<Move, 'from' | 'to' | 'promotion'>) {
  return `${move.from}${move.to}${move.promotion ?? ''}`
}

function parseFenOrThrow(fen: string) {
  const validation = validateFen(fen)
  if (!validation.ok) {
    throw new Error(validation.error ?? `Invalid chess FEN: ${fen}`)
  }

  return fen
}

function createGameFromFen(fen?: string) {
  if (!fen) {
    return new Chess()
  }

  return new Chess(parseFenOrThrow(fen))
}

function getPositionStatus(game: Chess): ChatBridgeChessBoardPositionStatus {
  if (game.isCheckmate()) {
    return 'checkmate'
  }
  if (game.isStalemate()) {
    return 'stalemate'
  }
  if (game.isDraw()) {
    return 'draw'
  }
  if (game.isCheck()) {
    return 'check'
  }

  return 'in_progress'
}

function buildBoardSummary(boardContext: ChatBridgeChessBoardContext) {
  const moveSuffix = boardContext.lastMove ? ` after ${boardContext.lastMove.san}.` : '.'

  switch (boardContext.positionStatus) {
    case 'checkmate':
      return `${capitalize(boardContext.sideToMove)} is checkmated.`
    case 'stalemate':
      return 'The position is stalemate.'
    case 'draw':
      return 'The position is drawn.'
    case 'check':
      return `${capitalize(boardContext.sideToMove)} to move and currently in check${moveSuffix}`
    case 'in_progress':
    default:
      if (!boardContext.lastMove && boardContext.fullmoveNumber === 1 && boardContext.sideToMove === 'white') {
        return 'White to move from the starting position.'
      }
      return `${capitalize(boardContext.sideToMove)} to move${moveSuffix}`
  }
}

function createBoardContextFromGame(game: Chess, summaryOverride?: string): ChatBridgeChessBoardContext {
  const history = game.history({ verbose: true })
  const lastMove = history.at(-1)

  const boardContext = {
    schemaVersion: CHATBRIDGE_CHESS_BOARD_CONTEXT_SCHEMA_VERSION,
    fen: game.fen(),
    sideToMove: toHostColor(game.turn()),
    fullmoveNumber: game.moveNumber(),
    legalMovesCount: game.moves().length,
    positionStatus: getPositionStatus(game),
    ...(lastMove
      ? {
          lastMove: {
            san: lastMove.san,
            uci: toUci(lastMove),
          },
        }
      : {}),
  } satisfies Omit<ChatBridgeChessBoardContext, 'summary'>

  return ChatBridgeChessBoardContextSchema.parse({
    ...boardContext,
    summary: summaryOverride ?? buildBoardSummary(boardContext),
  })
}

function toRuntimeMove(move: Move): ChatBridgeChessRuntimeMove {
  return ChatBridgeChessRuntimeMoveSchema.parse({
    san: move.san,
    uci: toUci(move),
    from: move.from,
    to: move.to,
    piece: move.piece,
    color: toHostColor(move.color),
    ...(move.promotion ? { promotion: move.promotion } : {}),
  })
}

function replayRuntimeMoves(startingFen: string, moveHistory: ChatBridgeChessRuntimeMove[]) {
  const game = createGameFromFen(startingFen)

  for (const move of moveHistory) {
    const applied = game.move({
      from: move.from as Square,
      to: move.to as Square,
      ...(move.promotion ? { promotion: move.promotion as PieceSymbol } : {}),
    })

    if (!applied) {
      throw new Error(`Cannot replay stored chess move ${move.uci} from ${startingFen}.`)
    }
  }

  return game
}

function materializeSnapshot(input: {
  startingFen: string
  moveHistory: ChatBridgeChessRuntimeMove[]
  status?: ChatBridgeChessRuntimeStatus
  feedback?: ChatBridgeChessRuntimeFeedback
  summaryOverride?: string
}) {
  const game = replayRuntimeMoves(input.startingFen, input.moveHistory)

  return ChatBridgeChessRuntimeSnapshotSchema.parse({
    schemaVersion: CHATBRIDGE_CHESS_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
    route: '/apps/chess',
    status: input.status ?? 'active',
    startingFen: input.startingFen,
    moveHistory: input.moveHistory,
    boardContext: createBoardContextFromGame(game, input.summaryOverride),
    ...(input.feedback ? { feedback: input.feedback } : {}),
  })
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function buildAcceptedMoveFeedback(move: ChatBridgeChessRuntimeMove, boardContext: ChatBridgeChessBoardContext) {
  if (boardContext.positionStatus === 'checkmate') {
    return ChatBridgeChessRuntimeFeedbackSchema.parse({
      kind: 'accepted',
      title: 'Checkmate',
      message: `${move.san} ends the game. The host recorded the finished board state and final move sequence inline.`,
    })
  }

  if (boardContext.positionStatus === 'draw' || boardContext.positionStatus === 'stalemate') {
    return ChatBridgeChessRuntimeFeedbackSchema.parse({
      kind: 'accepted',
      title: 'Position drawn',
      message: `${move.san} reaches a drawn position. The host stored the current board state without leaving the thread.`,
    })
  }

  if (boardContext.positionStatus === 'check') {
    return ChatBridgeChessRuntimeFeedbackSchema.parse({
      kind: 'accepted',
      title: 'Accepted move',
      message: `${move.san} is legal and leaves ${boardContext.sideToMove} in check. The host stored the updated board snapshot inline.`,
    })
  }

  return ChatBridgeChessRuntimeFeedbackSchema.parse({
    kind: 'accepted',
    title: 'Accepted move',
    message: `${move.san} is legal. The host stored turn, move history, and the updated board snapshot inline.`,
  })
}

function buildRejectedMoveFeedback(snapshot: ChatBridgeChessRuntimeSnapshot, from: Square, to: Square) {
  return ChatBridgeChessRuntimeFeedbackSchema.parse({
    kind: 'rejected',
    title: 'Illegal move rejected',
    message: `${from} to ${to} is not legal from the current host-owned board state. ${capitalize(snapshot.boardContext.sideToMove)} must play a legal move from this position.`,
  })
}

export function isChatBridgeChessAppId(appId: string) {
  return appId === 'chess' || appId.startsWith('chess-')
}

export function createChatBridgeChessRuntimeSnapshot(
  options: { fen?: string; status?: ChatBridgeChessRuntimeStatus; feedback?: ChatBridgeChessRuntimeFeedback } = {}
) {
  const game = createGameFromFen(options.fen)
  const startingFen = game.fen()

  return materializeSnapshot({
    startingFen,
    moveHistory: [],
    status: options.status ?? 'active',
    feedback: options.feedback,
  })
}

export function normalizeChatBridgeChessRuntimeSnapshot(snapshot: unknown): ChatBridgeChessRuntimeSnapshot {
  const parsedSnapshot = ChatBridgeChessRuntimeSnapshotSchema.safeParse(snapshot)
  if (parsedSnapshot.success) {
    return materializeSnapshot({
      startingFen: parsedSnapshot.data.startingFen,
      moveHistory: parsedSnapshot.data.moveHistory,
      status: parsedSnapshot.data.status,
      feedback: parsedSnapshot.data.feedback,
    })
  }

  if (isRecord(snapshot)) {
    const boardContext = ChatBridgeChessBoardContextSchema.safeParse(snapshot.boardContext)
    if (boardContext.success) {
      const status = ChatBridgeChessRuntimeStatusSchema.safeParse(snapshot.status)
      const feedback = ChatBridgeChessRuntimeFeedbackSchema.safeParse(snapshot.feedback)
      const startingFen =
        typeof snapshot.startingFen === 'string' && validateFen(snapshot.startingFen).ok
          ? snapshot.startingFen
          : boardContext.data.fen
      const moveHistory = z.array(ChatBridgeChessRuntimeMoveSchema).safeParse(snapshot.moveHistory)

      return materializeSnapshot({
        startingFen,
        moveHistory: moveHistory.success ? moveHistory.data : [],
        status: status.success ? status.data : 'active',
        feedback: feedback.success ? feedback.data : undefined,
        summaryOverride: boardContext.data.summary,
      })
    }
  }

  return createChatBridgeChessRuntimeSnapshot()
}

export function getChatBridgeChessStatusText(snapshot: ChatBridgeChessRuntimeSnapshot) {
  if (snapshot.status === 'stale') {
    return 'Stale board'
  }

  switch (snapshot.boardContext.positionStatus) {
    case 'checkmate':
      return 'Checkmate'
    case 'stalemate':
      return 'Stalemate'
    case 'draw':
      return 'Draw'
    case 'check':
      return `${capitalize(snapshot.boardContext.sideToMove)} in check`
    case 'in_progress':
    default:
      return `${capitalize(snapshot.boardContext.sideToMove)} to move`
  }
}

export function createChatBridgeChessGame(snapshot: ChatBridgeChessRuntimeSnapshot) {
  return replayRuntimeMoves(snapshot.startingFen, snapshot.moveHistory)
}

export function getChatBridgeChessLegalMoves(snapshot: ChatBridgeChessRuntimeSnapshot, square?: Square) {
  const game = createChatBridgeChessGame(snapshot)
  return square ? game.moves({ square, verbose: true }) : game.moves({ verbose: true })
}

export function applyChatBridgeChessMove(
  snapshot: ChatBridgeChessRuntimeSnapshot,
  move: {
    from: Square
    to: Square
    promotion?: 'q' | 'r' | 'b' | 'n'
  }
) {
  const normalized = normalizeChatBridgeChessRuntimeSnapshot(snapshot)
  const game = createChatBridgeChessGame(normalized)
  let applied: Move | null = null
  try {
    applied = game.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    })
  } catch {
    applied = null
  }

  if (!applied) {
    return {
      accepted: false as const,
      snapshot: ChatBridgeChessRuntimeSnapshotSchema.parse({
        ...normalized,
        feedback: buildRejectedMoveFeedback(normalized, move.from, move.to),
      }),
    }
  }

  const runtimeMove = toRuntimeMove(applied)
  const nextSnapshot = materializeSnapshot({
    startingFen: normalized.startingFen,
    moveHistory: [...normalized.moveHistory, runtimeMove],
    status: 'active',
  })

  return {
    accepted: true as const,
    move: runtimeMove,
    snapshot: ChatBridgeChessRuntimeSnapshotSchema.parse({
      ...nextSnapshot,
      feedback: buildAcceptedMoveFeedback(runtimeMove, nextSnapshot.boardContext),
    }),
  }
}

export function undoChatBridgeChessMove(snapshot: ChatBridgeChessRuntimeSnapshot) {
  const normalized = normalizeChatBridgeChessRuntimeSnapshot(snapshot)

  if (normalized.moveHistory.length === 0) {
    return {
      accepted: false as const,
      snapshot: ChatBridgeChessRuntimeSnapshotSchema.parse({
        ...normalized,
        feedback: {
          kind: 'info',
          title: 'No move to undo',
          message: 'The host has no newer move to rewind from this checkpoint.',
        },
      }),
    }
  }

  const undoneMove = normalized.moveHistory[normalized.moveHistory.length - 1]
  const nextSnapshot = materializeSnapshot({
    startingFen: normalized.startingFen,
    moveHistory: normalized.moveHistory.slice(0, -1),
    status: normalized.status,
    feedback: {
      kind: 'info',
      title: 'Move undone',
      message: `Removed ${undoneMove.san} and restored the previous host-owned board state.`,
    },
  })

  return {
    accepted: true as const,
    move: undoneMove,
    snapshot: nextSnapshot,
  }
}
