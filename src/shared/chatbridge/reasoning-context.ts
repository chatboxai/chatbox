import { z } from 'zod'
import type { Message, MessageAppLifecycle, MessageAppPart } from '../types/session'

export const CHATBRIDGE_CHESS_BOARD_CONTEXT_SCHEMA_VERSION = 1 as const
export const CHATBRIDGE_CHESS_REASONING_CONTEXT_SCHEMA_VERSION = 1 as const

const CHATBRIDGE_CHESS_REASONING_CONTEXT_KIND = 'chatbridge.host.reasoning-context.chess.v1' as const

const CHESS_APP_LIFECYCLES = new Set<MessageAppLifecycle>(['launching', 'ready', 'active', 'stale', 'error'])

export const ChatBridgeChessBoardPositionStatusSchema = z.enum([
  'in_progress',
  'check',
  'checkmate',
  'stalemate',
  'draw',
])

export type ChatBridgeChessBoardPositionStatus = z.infer<typeof ChatBridgeChessBoardPositionStatusSchema>

export const ChatBridgeChessBoardContextSchema = z.object({
  schemaVersion: z.literal(CHATBRIDGE_CHESS_BOARD_CONTEXT_SCHEMA_VERSION),
  fen: z.string().min(1),
  sideToMove: z.enum(['white', 'black']),
  fullmoveNumber: z.number().int().positive(),
  legalMovesCount: z.number().int().nonnegative().optional(),
  positionStatus: ChatBridgeChessBoardPositionStatusSchema,
  lastMove: z
    .object({
      san: z.string(),
      uci: z.string().optional(),
    })
    .optional(),
  summary: z.string().optional(),
})

export type ChatBridgeChessBoardContext = z.infer<typeof ChatBridgeChessBoardContextSchema>

export const ChatBridgeChessReasoningContextStateSchema = z.enum(['live', 'stale', 'unavailable'])
export type ChatBridgeChessReasoningContextState = z.infer<typeof ChatBridgeChessReasoningContextStateSchema>

export const ChatBridgeChessReasoningContextSchema = z.object({
  kind: z.literal(CHATBRIDGE_CHESS_REASONING_CONTEXT_KIND),
  schemaVersion: z.literal(CHATBRIDGE_CHESS_REASONING_CONTEXT_SCHEMA_VERSION),
  appId: z.string(),
  appName: z.string(),
  appInstanceId: z.string(),
  lifecycle: z.enum(['launching', 'ready', 'active', 'complete', 'error', 'stale']),
  state: ChatBridgeChessReasoningContextStateSchema,
  board: ChatBridgeChessBoardContextSchema.optional(),
})

export type ChatBridgeChessReasoningContext = z.infer<typeof ChatBridgeChessReasoningContextSchema>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isChessAppId(appId: string) {
  return appId === 'chess' || appId.startsWith('chess-')
}

function findLatestChessAppPart(messages: Message[]): MessageAppPart | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    for (let partIndex = message.contentParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.contentParts[partIndex]
      if (part.type !== 'app' || !isChessAppId(part.appId) || !CHESS_APP_LIFECYCLES.has(part.lifecycle)) {
        continue
      }

      return part
    }
  }

  return null
}

function getBoardContextSnapshot(part: MessageAppPart): ChatBridgeChessBoardContext | null {
  if (!isRecord(part.snapshot)) {
    return null
  }

  const candidates = [part.snapshot.boardContext, part.snapshot.chessBoard, part.snapshot]

  for (const candidate of candidates) {
    const parsed = ChatBridgeChessBoardContextSchema.safeParse(candidate)
    if (parsed.success) {
      return parsed.data
    }
  }

  return null
}

function getReasoningState(
  lifecycle: MessageAppLifecycle,
  boardContext: ChatBridgeChessBoardContext | null
): ChatBridgeChessReasoningContextState {
  if (lifecycle === 'stale' && boardContext) {
    return 'stale'
  }

  if ((lifecycle === 'ready' || lifecycle === 'active') && boardContext) {
    return 'live'
  }

  return 'unavailable'
}

export function resolveChatBridgeChessReasoningContext(messages: Message[]): ChatBridgeChessReasoningContext | null {
  const latestChessPart = findLatestChessAppPart(messages)
  if (!latestChessPart) {
    return null
  }

  const boardContext = getBoardContextSnapshot(latestChessPart)
  const state = getReasoningState(latestChessPart.lifecycle, boardContext)

  return ChatBridgeChessReasoningContextSchema.parse({
    kind: CHATBRIDGE_CHESS_REASONING_CONTEXT_KIND,
    schemaVersion: CHATBRIDGE_CHESS_REASONING_CONTEXT_SCHEMA_VERSION,
    appId: latestChessPart.appId,
    appName: latestChessPart.appName ?? 'Chess',
    appInstanceId: latestChessPart.appInstanceId,
    lifecycle: latestChessPart.lifecycle,
    state,
    ...(boardContext ? { board: boardContext } : {}),
  })
}

export function buildChatBridgeChessReasoningPrompt(messages: Message[]): string | null {
  const context = resolveChatBridgeChessReasoningContext(messages)
  if (!context) {
    return null
  }

  const boardLines = context.board
    ? [
        `- Board FEN: ${context.board.fen}`,
        `- Side to move: ${context.board.sideToMove}`,
        `- Fullmove number: ${context.board.fullmoveNumber}`,
        `- Position status: ${context.board.positionStatus}`,
        context.board.lastMove ? `- Last move: ${context.board.lastMove.san}` : null,
        context.board.legalMovesCount !== undefined ? `- Legal moves count: ${context.board.legalMovesCount}` : null,
        context.board.summary ? `- Host note: ${context.board.summary}` : null,
      ].filter(Boolean)
    : []

  const guidance =
    context.state === 'live'
      ? 'Use only this bounded host summary for position-specific chess advice. Do not assume any board detail that is not listed here.'
      : context.state === 'stale'
        ? 'The host marks this board snapshot as stale. Give cautious guidance, note that the position may be outdated, and ask the user to refresh or resume the board before relying on exact move-by-move analysis.'
        : 'The host does not have a validated live board snapshot for this chess session. Do not pretend you can see the exact position. Offer general chess guidance and ask the user to refresh or describe the board if they need exact position-specific advice.'

  return [
    'ChatBridge active Chess context (host-owned and normalized):',
    `- Context state: ${context.state}`,
    `- App instance ID: ${context.appInstanceId}`,
    `- Lifecycle: ${context.lifecycle}`,
    ...boardLines,
    guidance,
  ].join('\n')
}
