import { Chess, type Color, type Move, type PieceSymbol } from 'chess.js'
import { z } from 'zod'

export const CHESS_APP_ID = 'chess'
export const CHESS_APP_NAME = 'Chess'
export const CHESS_APP_SNAPSHOT_SCHEMA_VERSION = 1 as const

export const ChessColorSchema = z.enum(['white', 'black'])
export type ChessColor = z.infer<typeof ChessColorSchema>

export const ChessPieceSchema = z.enum(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'])
export type ChessPiece = z.infer<typeof ChessPieceSchema>

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
})

export type ChessAppSnapshot = z.infer<typeof ChessAppSnapshotSchema>

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const
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

function normalizeColor(color: Color): ChessColor {
  return color === 'w' ? 'white' : 'black'
}

function normalizePiece(piece: PieceSymbol): ChessPiece {
  return PIECE_NAMES[piece]
}

function getPieceGlyph(color: ChessColor, piece: ChessPiece) {
  return PIECE_GLYPHS[color][piece]
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function encodeSvgDataUrl(svg: string) {
  const encoded =
    typeof Buffer !== 'undefined'
      ? Buffer.from(svg, 'utf8').toString('base64')
      : btoa(unescape(encodeURIComponent(svg)))

  return `data:image/svg+xml;base64,${encoded}`
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

export function createInitialChessAppSnapshot(updatedAt = Date.now()): ChessAppSnapshot {
  return createChessAppSnapshotFromGame(new Chess(), {
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
  })
}

export function parseChessAppSnapshot(snapshot: unknown): ChessAppSnapshot {
  return ChessAppSnapshotSchema.parse(snapshot)
}

export function getChessPieceAtSquare(snapshot: ChessAppSnapshot, square: string) {
  return snapshot.board.find((piece) => piece.square === square) ?? null
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

export function createChessScreenshotDataUrl(snapshot: ChessAppSnapshot) {
  const squareSize = 72
  const boardSize = squareSize * 8
  const width = boardSize + 96
  const height = boardSize + 140

  const pieceBySquare = new Map(snapshot.board.map((piece) => [piece.square, piece]))
  const latestMove =
    snapshot.lastAction.kind === 'accepted'
      ? new Set([snapshot.lastAction.move.from, snapshot.lastAction.move.to])
      : new Set<string>()

  const squares = RANKS.flatMap((rank, rankIndex) =>
    FILES.map((file, fileIndex) => {
      const square = `${file}${rank}`
      const piece = pieceBySquare.get(square)
      const x = 48 + fileIndex * squareSize
      const y = 48 + rankIndex * squareSize
      const light = (rankIndex + fileIndex) % 2 === 0
      const highlighted = latestMove.has(square)

      return [
        `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" rx="10" fill="${
          light ? '#f4e7d3' : '#9b6a4d'
        }" ${highlighted ? 'stroke="#38bdf8" stroke-width="4"' : ''} />`,
        piece
          ? `<text x="${x + squareSize / 2}" y="${y + squareSize / 2 + 16}" text-anchor="middle" font-size="42" font-family="Noto Sans Symbols 2, Segoe UI Symbol, serif" fill="${
              piece.color === 'white' ? '#f8fafc' : '#111827'
            }">${piece.glyph}</text>`
          : '',
      ].join('')
    })
  ).join('')

  const fileLabels = FILES.map(
    (file, index) =>
      `<text x="${48 + index * squareSize + squareSize / 2}" y="30" text-anchor="middle" font-size="16" font-weight="700" fill="#6b7280">${file}</text>`
  ).join('')
  const rankLabels = RANKS.map(
    (rank, index) =>
      `<text x="24" y="${48 + index * squareSize + squareSize / 2 + 6}" text-anchor="middle" font-size="16" font-weight="700" fill="#6b7280">${rank}</text>`
  ).join('')
  const status = escapeSvgText(getChessStatusLabel(snapshot))
  const summary = escapeSvgText(getChessSummary(snapshot))
  const footer = escapeSvgText(
    snapshot.moveHistory.length > 0
      ? `Latest move: ${snapshot.moveHistory.at(-1)?.san ?? 'n/a'}`
      : 'Opening position ready'
  )

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" rx="30" fill="#18181b" />
    <text x="48" y="28" font-size="20" font-weight="700" fill="#fafaf9">Chess</text>
    <text x="${width - 48}" y="28" text-anchor="end" font-size="16" fill="#bae6fd">${status}</text>
    ${fileLabels}
    ${rankLabels}
    ${squares}
    <text x="48" y="${height - 54}" font-size="16" fill="#e7e5e4">${summary}</text>
    <text x="48" y="${height - 26}" font-size="14" fill="#a8a29e">${footer}</text>
  </svg>`

  return encodeSvgDataUrl(svg)
}
