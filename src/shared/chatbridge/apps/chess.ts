import { Chess, type Color, type Move, type PieceSymbol } from 'chess.js'
import { z } from 'zod'

export const CHESS_APP_ID = 'chess'
export const CHESS_APP_NAME = 'Chess'
export const CHESS_APP_SNAPSHOT_SCHEMA_VERSION = 1 as const

export const ChessColorSchema = z.enum(['white', 'black'])
export type ChessColor = z.infer<typeof ChessColorSchema>

export const ChessPieceSchema = z.enum(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'])
export type ChessPiece = z.infer<typeof ChessPieceSchema>

export const ChessAiDifficultySchema = z.enum(['easy-medium'])
export type ChessAiDifficulty = z.infer<typeof ChessAiDifficultySchema>

export const ChessAiConfigSchema = z.object({
  enabled: z.boolean(),
  playerColor: ChessColorSchema,
  opponentColor: ChessColorSchema,
  difficulty: ChessAiDifficultySchema,
})
export type ChessAiConfig = z.infer<typeof ChessAiConfigSchema>

export const ChessSquareStateSchema = z.object({
  square: z.string(),
  color: ChessColorSchema,
  piece: ChessPieceSchema,
  glyph: z.string(),
})

export type ChessSquareState = z.infer<typeof ChessSquareStateSchema>

export const ChessMoveStateSchema = z.object({
  san: z.string(),
  from: z.string(),
  to: z.string(),
  color: ChessColorSchema,
  piece: ChessPieceSchema,
  moveNumber: z.number().int().positive(),
  flags: z.string(),
  fen: z.string(),
  promotion: ChessPieceSchema.optional(),
  captured: ChessPieceSchema.optional(),
  at: z.number().int(),
})

export type ChessMoveState = z.infer<typeof ChessMoveStateSchema>

export const ChessActionStateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('idle'),
    message: z.string(),
  }),
  z.object({
    kind: z.literal('accepted'),
    message: z.string(),
    move: ChessMoveStateSchema,
  }),
  z.object({
    kind: z.literal('rejected'),
    message: z.string(),
    attemptedFrom: z.string().optional(),
    attemptedTo: z.string().optional(),
  }),
])

export type ChessActionState = z.infer<typeof ChessActionStateSchema>

export const ChessGameStatusSchema = z.object({
  phase: z.enum(['active', 'complete']),
  isCheck: z.boolean(),
  isCheckmate: z.boolean(),
  isDraw: z.boolean(),
  isStalemate: z.boolean(),
  isInsufficientMaterial: z.boolean(),
  winner: ChessColorSchema.nullable(),
  reason: z.string(),
})

export type ChessGameStatus = z.infer<typeof ChessGameStatusSchema>

export const ChessAppSnapshotSchema = z.object({
  schemaVersion: z.literal(CHESS_APP_SNAPSHOT_SCHEMA_VERSION),
  appId: z.literal(CHESS_APP_ID),
  fen: z.string(),
  pgn: z.string(),
  turn: ChessColorSchema,
  moveHistory: z.array(ChessMoveStateSchema),
  board: z.array(ChessSquareStateSchema),
  status: ChessGameStatusSchema,
  lastAction: ChessActionStateSchema,
  lastUpdatedAt: z.number().int(),
  ai: ChessAiConfigSchema.optional(),
})

export type ChessAppSnapshot = z.infer<typeof ChessAppSnapshotSchema>

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const STARTING_CHESS_FEN = new Chess().fen()
const PIECE_NAMES: Record<PieceSymbol, ChessPiece> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

const PIECE_GLYPHS: Record<ChessColor, Record<ChessPiece, string>> = {
  white: {
    king: '\u2654',
    queen: '\u2655',
    rook: '\u2656',
    bishop: '\u2657',
    knight: '\u2658',
    pawn: '\u2659',
  },
  black: {
    king: '\u265A',
    queen: '\u265B',
    rook: '\u265C',
    bishop: '\u265D',
    knight: '\u265E',
    pawn: '\u265F',
  },
}

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
}

const PRIMARY_CENTER_SQUARES = new Set(['d4', 'e4', 'd5', 'e5'])
const EXTENDED_CENTER_SQUARES = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'f4', 'c5', 'f5', 'c6', 'd6', 'e6', 'f6'])
const CHECKMATE_SCORE = 100_000

export const DEFAULT_CHESS_AI_CONFIG: ChessAiConfig = {
  enabled: true,
  playerColor: 'white',
  opponentColor: 'black',
  difficulty: 'easy-medium',
}

export type ChessAiMoveChoice = {
  san: string
  from: string
  to: string
  promotion?: PieceSymbol
}

function normalizeColor(color: Color): ChessColor {
  return color === 'w' ? 'white' : 'black'
}

function normalizePiece(piece: PieceSymbol): ChessPiece {
  return PIECE_NAMES[piece]
}

function getPieceGlyph(color: ChessColor, piece: ChessPiece) {
  return PIECE_GLYPHS[color][piece]
}

function getStatusReason(game: Chess) {
  if (game.isCheckmate()) {
    return 'Checkmate'
  }
  if (game.isStalemate()) {
    return 'Stalemate'
  }
  if (game.isInsufficientMaterial()) {
    return 'Insufficient material'
  }
  if (game.isDraw()) {
    return 'Draw'
  }
  if (game.inCheck()) {
    return `${getTurnLabel(normalizeColor(game.turn()))} in check`
  }
  return `${getTurnLabel(normalizeColor(game.turn()))} to move`
}

export function getTurnLabel(color: ChessColor) {
  return color === 'white' ? 'White' : 'Black'
}

function toEngineColor(color: ChessColor): Color {
  return color === 'white' ? 'w' : 'b'
}

export function getChessStatusLabel(snapshot: ChessAppSnapshot) {
  if (snapshot.status.phase === 'complete') {
    if (snapshot.status.isCheckmate && snapshot.status.winner) {
      return `${getTurnLabel(snapshot.status.winner)} wins`
    }
    return snapshot.status.reason
  }

  if (snapshot.status.isCheck) {
    return `${getTurnLabel(snapshot.turn)} in check`
  }

  return `${getTurnLabel(snapshot.turn)} to move`
}

export function getChessSummary(snapshot: ChessAppSnapshot) {
  const moveCount = snapshot.moveHistory.length

  if (snapshot.status.phase === 'complete') {
    if (snapshot.status.isCheckmate && snapshot.status.winner) {
      return `Chess game complete. ${getTurnLabel(snapshot.status.winner)} won by checkmate after ${moveCount} half-moves.`
    }
    return `Chess game complete. ${snapshot.status.reason} after ${moveCount} half-moves.`
  }

  if (snapshot.lastAction.kind === 'accepted') {
    return `Chess updated to ${snapshot.lastAction.move.san}. ${getTurnLabel(snapshot.turn)} to move.`
  }

  if (snapshot.lastAction.kind === 'rejected') {
    return `Chess rejected the attempted move. ${getTurnLabel(snapshot.turn)} still to move from the current board state.`
  }

  if (moveCount > 0) {
    const lastMove = snapshot.moveHistory.at(-1)
    return lastMove
      ? `Chess board ready after ${lastMove.san}. ${getTurnLabel(snapshot.turn)} to move.`
      : `Chess board ready. ${getTurnLabel(snapshot.turn)} to move from the current board state.`
  }

  if (snapshot.fen !== STARTING_CHESS_FEN) {
    return `Chess board ready. ${getTurnLabel(snapshot.turn)} to move from the loaded position.`
  }

  return `Chess board ready. ${getTurnLabel(snapshot.turn)} to move from the starting position.`
}

export function getChessDescription(snapshot: ChessAppSnapshot) {
  if (snapshot.status.phase === 'complete') {
    return `${snapshot.status.reason}. The final board stays visible in the thread with the last legal position intact.`
  }

  if (snapshot.lastAction.kind === 'accepted') {
    return `${snapshot.lastAction.message} The host updated the board state and move ledger in place.`
  }

  if (snapshot.lastAction.kind === 'rejected') {
    return `${snapshot.lastAction.message} The host kept the prior legal board state and surfaced the rejection inline.`
  }

  return 'The chess board is live inside the host shell. Accepted moves sync into the session record, and illegal moves are rejected inline.'
}

export function getChessSurfaceDescription(snapshot: ChessAppSnapshot) {
  if (snapshot.status.phase === 'complete') {
    return 'The host keeps the final board visible in the message and preserves the recorded move history.'
  }

  return 'Select a piece, choose a destination square, and the host will validate the move before updating the live board.'
}

export function getChessFallbackText(snapshot?: ChessAppSnapshot | null) {
  if (snapshot?.moveHistory.length) {
    return `The host can still explain the latest legal board state from ${snapshot.fen} even if the live runtime stops responding.`
  }

  return 'The host can fall back to the latest legal board state without dropping the chess session out of the thread.'
}

export function createInitialChessAppSnapshot(
  updatedAt = Date.now(),
  options: {
    ai?: ChessAiConfig | null
  } = {}
): ChessAppSnapshot {
  return createChessAppSnapshotFromGame(new Chess(), {
    ai: options.ai,
    lastUpdatedAt: updatedAt,
    lastAction: {
      kind: 'idle',
      message: 'Waiting for the first legal move.',
    },
  })
}

export function createChessAppSnapshotFromGame(
  game: Chess,
  options: {
    lastUpdatedAt?: number
    lastAction?: ChessActionState
    ai?: ChessAiConfig | null
  } = {}
): ChessAppSnapshot {
  const board: ChessSquareState[] = []

  game.board().forEach((rank, rankIndex) => {
    rank.forEach((piece, fileIndex) => {
      if (!piece) {
        return
      }

      const color = normalizeColor(piece.color)
      const normalizedPiece = normalizePiece(piece.type)
      board.push({
        square: `${FILES[fileIndex]}${8 - rankIndex}`,
        color,
        piece: normalizedPiece,
        glyph: getPieceGlyph(color, normalizedPiece),
      })
    })
  })

  const history = game.history({ verbose: true }).map((move, index) => {
    const color = normalizeColor(move.color)
    const piece = normalizePiece(move.piece)
    return {
      san: move.san,
      from: move.from,
      to: move.to,
      color,
      piece,
      moveNumber: index + 1,
      flags: move.flags,
      fen: move.after,
      promotion: move.promotion ? normalizePiece(move.promotion) : undefined,
      captured: move.captured ? normalizePiece(move.captured) : undefined,
      at: options.lastUpdatedAt ?? Date.now(),
    }
  })

  const status: ChessGameStatus = {
    phase: game.isGameOver() ? 'complete' : 'active',
    isCheck: game.inCheck(),
    isCheckmate: game.isCheckmate(),
    isDraw: game.isDraw(),
    isStalemate: game.isStalemate(),
    isInsufficientMaterial: game.isInsufficientMaterial(),
    winner: game.isCheckmate() ? normalizeColor(game.turn() === 'w' ? 'b' : 'w') : null,
    reason: getStatusReason(game),
  }

  return ChessAppSnapshotSchema.parse({
    schemaVersion: CHESS_APP_SNAPSHOT_SCHEMA_VERSION,
    appId: CHESS_APP_ID,
    fen: game.fen(),
    pgn: game.pgn(),
    turn: normalizeColor(game.turn()),
    moveHistory: history,
    board,
    status,
    lastAction:
      options.lastAction ??
      ({
        kind: 'idle',
        message: 'Waiting for the next legal move.',
      } satisfies ChessActionState),
    lastUpdatedAt: options.lastUpdatedAt ?? Date.now(),
    ...(options.ai ? { ai: ChessAiConfigSchema.parse(options.ai) } : {}),
  })
}

export function parseChessAppSnapshot(snapshot: unknown): ChessAppSnapshot {
  return ChessAppSnapshotSchema.parse(snapshot)
}

export function getChessPieceAtSquare(snapshot: ChessAppSnapshot, square: string) {
  return snapshot.board.find((piece) => piece.square === square) ?? null
}

export function getChessAiConfig(snapshot: ChessAppSnapshot) {
  const parsed = ChessAiConfigSchema.safeParse(snapshot.ai)
  return parsed.success && parsed.data.enabled ? parsed.data : null
}

export function shouldChessAiReply(game: Chess, aiConfig: ChessAiConfig | null | undefined) {
  if (!aiConfig?.enabled || game.isGameOver()) {
    return false
  }

  return normalizeColor(game.turn()) === aiConfig.opponentColor
}

function evaluateSquareControl(square: string) {
  if (PRIMARY_CENTER_SQUARES.has(square)) {
    return 18
  }

  if (EXTENDED_CENTER_SQUARES.has(square)) {
    return 8
  }

  return 0
}

function evaluateChessBoard(game: Chess, aiColor: ChessColor) {
  const aiTurn = toEngineColor(aiColor)

  if (game.isCheckmate()) {
    return game.turn() === aiTurn ? -CHECKMATE_SCORE : CHECKMATE_SCORE
  }

  if (game.isDraw() || game.isStalemate() || game.isInsufficientMaterial()) {
    return 0
  }

  let score = 0

  game.board().forEach((rank, rankIndex) => {
    rank.forEach((piece, fileIndex) => {
      if (!piece) {
        return
      }

      const pieceSign = piece.color === aiTurn ? 1 : -1
      const pieceValue = PIECE_VALUES[piece.type]
      const square = `${FILES[fileIndex]}${8 - rankIndex}`
      const squareControl = evaluateSquareControl(square)

      score += pieceSign * pieceValue
      score += pieceSign * squareControl

      if (piece.type === 'n' || piece.type === 'b') {
        score += pieceSign * 6
      }

      if (piece.type === 'p') {
        score += pieceSign * (piece.color === 'w' ? 8 - Number(square[1]) : Number(square[1]) - 1)
      }
    })
  })

  const mobility = game.moves().length
  score += (game.turn() === aiTurn ? 1 : -1) * mobility * 2

  if (game.inCheck()) {
    score += game.turn() === aiTurn ? -35 : 35
  }

  return score
}

function scoreChessAiMove(game: Chess, move: Move, aiConfig: ChessAiConfig) {
  const appliedMove = game.move({
    from: move.from,
    to: move.to,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  })

  if (!appliedMove) {
    return Number.NEGATIVE_INFINITY
  }

  let score = evaluateChessBoard(game, aiConfig.opponentColor)

  if (!game.isGameOver()) {
    const replies = game.moves({ verbose: true })
    if (replies.length > 0) {
      let opponentBestReply = Number.POSITIVE_INFINITY

      for (const reply of replies) {
        const appliedReply = game.move({
          from: reply.from,
          to: reply.to,
          ...(reply.promotion ? { promotion: reply.promotion } : {}),
        })
        if (!appliedReply) {
          continue
        }

        opponentBestReply = Math.min(opponentBestReply, evaluateChessBoard(game, aiConfig.opponentColor))
        game.undo()
      }

      if (Number.isFinite(opponentBestReply)) {
        score = opponentBestReply
      }
    }
  }

  let preference = 0

  if (appliedMove.captured) {
    preference += PIECE_VALUES[appliedMove.captured] * 2
  }

  if (appliedMove.promotion) {
    preference += PIECE_VALUES[appliedMove.promotion] + 40
  }

  if (appliedMove.san.includes('+')) {
    preference += 30
  }

  preference += evaluateSquareControl(appliedMove.to)

  if (appliedMove.piece === 'n' || appliedMove.piece === 'b') {
    preference += 10
  }

  if (appliedMove.piece === 'p' && (appliedMove.from[1] === '7' || appliedMove.from[1] === '2')) {
    preference += 6
  }

  game.undo()

  return score + preference / 100
}

export function selectChessAiMove(game: Chess, aiConfig: ChessAiConfig): ChessAiMoveChoice | null {
  if (!shouldChessAiReply(game, aiConfig)) {
    return null
  }

  const legalMoves = game.moves({ verbose: true })
  if (legalMoves.length === 0) {
    return null
  }

  const sortedMoves = [...legalMoves].sort((left, right) => left.san.localeCompare(right.san))
  let bestMove: Move | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const move of sortedMoves) {
    const moveScore = scoreChessAiMove(game, move, aiConfig)

    if (moveScore > bestScore) {
      bestMove = move
      bestScore = moveScore
    }
  }

  if (!bestMove) {
    return null
  }

  return {
    san: bestMove.san,
    from: bestMove.from,
    to: bestMove.to,
    ...(bestMove.promotion ? { promotion: bestMove.promotion } : {}),
  }
}

export function createChessMoveState(move: Move, moveNumber: number, at: number): ChessMoveState {
  return ChessMoveStateSchema.parse({
    san: move.san,
    from: move.from,
    to: move.to,
    color: normalizeColor(move.color),
    piece: normalizePiece(move.piece),
    moveNumber,
    flags: move.flags,
    fen: move.after,
    promotion: move.promotion ? normalizePiece(move.promotion) : undefined,
    captured: move.captured ? normalizePiece(move.captured) : undefined,
    at,
  })
}

export function createRejectedChessSnapshot(
  snapshot: ChessAppSnapshot,
  options: {
    message: string
    attemptedFrom?: string
    attemptedTo?: string
    lastUpdatedAt?: number
  }
) {
  return ChessAppSnapshotSchema.parse({
    ...snapshot,
    lastAction: {
      kind: 'rejected',
      message: options.message,
      attemptedFrom: options.attemptedFrom,
      attemptedTo: options.attemptedTo,
    },
    lastUpdatedAt: options.lastUpdatedAt ?? Date.now(),
  })
}
