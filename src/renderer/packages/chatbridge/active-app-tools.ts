import type { ToolSet } from 'ai'
import { z } from 'zod'
import {
  appendChatBridgeAppScreenshot,
  createChatBridgeHostTool,
  createChessAppSnapshotFromGame,
  createChessMoveState,
  createChessScreenshotDataUrl,
  createDrawingKitScreenshotDataUrl,
  getChessStatusLabel,
  getChessSummary,
  getTurnLabel,
  parseChessAppSnapshot,
  readChatBridgeReviewedAppLaunch,
  selectChatBridgeAppContext,
  isChatBridgeHostToolExecutionRecord,
  type ChatBridgeHostToolExecutionRecord,
  type ChatBridgeSelectedAppContext,
  type DrawingKitDrawShape,
  type DrawingKitPreviewMark,
  type DrawingKitTool,
} from '@shared/chatbridge'
import {
  appendDrawingKitPreviewMarks,
  bankDrawingKitSnapshot,
  clearDrawingKitPreviewMarks,
  createInitialDrawingKitAppSnapshot,
  eraseLastDrawingKitPreviewMark,
  setDrawingKitSelectedTool,
} from '@shared/chatbridge/apps/drawing-kit'
import { createRejectedChessSnapshot } from '@shared/chatbridge/apps/chess'
import type { Message, MessageAppPart, MessageContentParts, MessageToolCallPart, Session, Updater } from '@shared/types'
import { Chess, type PieceSymbol } from 'chess.js'
import { createModelDependencies } from '@/adapters'
import { getSession, updateSessionWithMessages } from '@/stores/chatStore'
import { createChatBridgeAppRecordStore } from './app-records'
import { applyChessSnapshotToSession } from './chess-session-state'

const CHESS_APP_VERSION = '1.0.0'

const ChessSquareSchema = z
  .string()
  .trim()
  .regex(/^[a-h][1-8]$/i)
  .transform((value) => value.toLowerCase())

const ChessMoveToolInputSchema = z
  .object({
    from: ChessSquareSchema.optional(),
    to: ChessSquareSchema.optional(),
    san: z.string().trim().min(1).optional(),
    promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.san && !(value.from && value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide SAN, or both from and to squares.',
      })
    }
  })

const ChessReadHistoryInputSchema = z.object({
  format: z.enum(['ledger', 'pgn']).default('ledger'),
})

const AppScreenshotInputSchema = z.object({
  idempotencyKey: z.string().trim().min(1).optional(),
})

const DrawingKitToolInputSchema = z
  .object({
    action: z.enum(['select_tool', 'draw_shape', 'erase_last_mark', 'clear_canvas', 'bank_checkpoint']),
    tool: z.enum(['brush', 'spray', 'stamp']).optional(),
    shape: z.enum(['squiggle', 'circle', 'box', 'star', 'burst', 'sticker']).optional(),
    caption: z.string().trim().max(80).optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'select_tool' && !value.tool) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tool'],
        message: 'select_tool requires a tool.',
      })
    }
    if (value.action === 'draw_shape' && !value.shape) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shape'],
        message: 'draw_shape requires a supported shape.',
      })
    }
  })

type ResolvedAppPart = {
  session: Session
  messageId: string
  part: MessageAppPart
}

type ActiveAppToolSetResult = {
  selection: ChatBridgeSelectedAppContext | null
  tools: ToolSet
}

async function readPersistedSession(sessionId: string) {
  return await getSession(sessionId)
}

async function updatePersistedSession(sessionId: string, updater: Updater<Session>) {
  return await updateSessionWithMessages(sessionId, updater)
}

function updateMessageAppPart(
  message: Message,
  appInstanceId: string,
  updater: (part: MessageAppPart) => MessageAppPart
): Message {
  let updated = false

  const contentParts = message.contentParts.map((contentPart) => {
    if (contentPart.type !== 'app' || contentPart.appInstanceId !== appInstanceId) {
      return contentPart
    }

    updated = true
    return updater(contentPart)
  })

  return updated
    ? {
        ...message,
        contentParts,
      }
    : message
}

function updateSessionAppPart(
  session: Session,
  messageId: string,
  appInstanceId: string,
  updater: (part: MessageAppPart) => MessageAppPart
) {
  let found = false

  const messages = session.messages.map((message) => {
    if (message.id !== messageId) {
      return message
    }

    found = true
    return updateMessageAppPart(message, appInstanceId, updater)
  })

  if (found) {
    return {
      ...session,
      messages,
    }
  }

  const threads = session.threads?.map((thread) => {
    const nextMessages = thread.messages.map((message) => {
      if (message.id !== messageId) {
        return message
      }

      found = true
      return updateMessageAppPart(message, appInstanceId, updater)
    })

    return found
      ? {
          ...thread,
          messages: nextMessages,
        }
      : thread
  })

  return found
    ? {
        ...session,
        threads,
      }
    : session
}

function findAppPartInSession(session: Session, appInstanceId: string): { messageId: string; part: MessageAppPart } | null {
  for (const message of session.messages) {
    for (const part of message.contentParts) {
      if (part.type === 'app' && part.appInstanceId === appInstanceId) {
        return {
          messageId: message.id,
          part,
        }
      }
    }
  }

  for (const thread of session.threads ?? []) {
    for (const message of thread.messages) {
      for (const part of message.contentParts) {
        if (part.type === 'app' && part.appInstanceId === appInstanceId) {
          return {
            messageId: message.id,
            part,
          }
        }
      }
    }
  }

  return null
}

async function resolveCurrentAppPart(sessionId: string, appInstanceId: string): Promise<ResolvedAppPart | null> {
  const session = await readPersistedSession(sessionId)
  if (!session) {
    return null
  }

  const current = findAppPartInSession(session, appInstanceId)
  if (!current) {
    return null
  }

  return {
    session,
    messageId: current.messageId,
    part: current.part,
  }
}

function ensureAppRecordAudit(
  session: Session,
  part: MessageAppPart,
  payload: Record<string, unknown>,
  now: number
) {
  const store = createChatBridgeAppRecordStore({
    snapshot: session.chatBridgeAppRecords,
    now: () => now,
  })

  const instance = store.getInstance(part.appInstanceId)
  if (!instance) {
    return session
  }

  const result = store.recordHostEvent({
    appInstanceId: part.appInstanceId,
    kind: 'tool.called',
    nextStatus: instance.status,
    bridgeSessionId: part.bridgeSessionId,
    createdAt: now,
    payload,
  })

  if (!result.accepted) {
    return session
  }

  return {
    ...session,
    chatBridgeAppRecords: store.snapshot(),
  }
}

function describeDrawingKitShape(shape: DrawingKitDrawShape, index: number) {
  const horizontalOffset = (index % 3) * 0.08
  const verticalOffset = ((index + 1) % 3) * 0.07

  switch (shape) {
    case 'circle':
      return [
        {
          kind: 'line' as const,
          tool: 'brush' as const,
          color: '#267df0',
          width: 5,
          points: [
            { x: 0.28 + horizontalOffset, y: 0.28 + verticalOffset },
            { x: 0.42 + horizontalOffset, y: 0.18 + verticalOffset },
            { x: 0.58 + horizontalOffset, y: 0.28 + verticalOffset },
            { x: 0.58 + horizontalOffset, y: 0.46 + verticalOffset },
            { x: 0.42 + horizontalOffset, y: 0.56 + verticalOffset },
            { x: 0.28 + horizontalOffset, y: 0.46 + verticalOffset },
            { x: 0.28 + horizontalOffset, y: 0.28 + verticalOffset },
          ],
        },
      ] satisfies DrawingKitPreviewMark[]
    case 'box':
      return [
        {
          kind: 'line' as const,
          tool: 'brush' as const,
          color: '#267df0',
          width: 5,
          points: [
            { x: 0.24 + horizontalOffset, y: 0.22 + verticalOffset },
            { x: 0.58 + horizontalOffset, y: 0.22 + verticalOffset },
            { x: 0.58 + horizontalOffset, y: 0.54 + verticalOffset },
            { x: 0.24 + horizontalOffset, y: 0.54 + verticalOffset },
            { x: 0.24 + horizontalOffset, y: 0.22 + verticalOffset },
          ],
        },
      ] satisfies DrawingKitPreviewMark[]
    case 'star':
      return [
        {
          kind: 'stamp' as const,
          stamp: 'star',
          color: '#f2b61b',
          size: 18,
          x: 0.34 + horizontalOffset,
          y: 0.32 + verticalOffset,
        },
      ] satisfies DrawingKitPreviewMark[]
    case 'burst':
      return [
        {
          kind: 'stamp' as const,
          stamp: 'burst',
          color: '#ff8a4c',
          size: 18,
          x: 0.38 + horizontalOffset,
          y: 0.34 + verticalOffset,
        },
      ] satisfies DrawingKitPreviewMark[]
    case 'sticker':
      return [
        {
          kind: 'stamp' as const,
          stamp: 'spark',
          color: '#f2b61b',
          size: 18,
          x: 0.36 + horizontalOffset,
          y: 0.3 + verticalOffset,
        },
      ] satisfies DrawingKitPreviewMark[]
    case 'squiggle':
    default:
      return [
        {
          kind: 'line' as const,
          tool: 'spray' as const,
          color: '#ff8a4c',
          width: 3,
          points: [
            { x: 0.18 + horizontalOffset, y: 0.26 + verticalOffset },
            { x: 0.31 + horizontalOffset, y: 0.42 + verticalOffset },
            { x: 0.46 + horizontalOffset, y: 0.24 + verticalOffset },
            { x: 0.6 + horizontalOffset, y: 0.48 + verticalOffset },
          ],
        },
      ] satisfies DrawingKitPreviewMark[]
  }
}

function buildDrawingKitPart(part: MessageAppPart, snapshot: ReturnType<typeof createInitialDrawingKitAppSnapshot>) {
  return {
    ...part,
    lifecycle: 'active' as const,
    summary: snapshot.summary,
    summaryForModel: snapshot.summary,
    snapshot,
    title: part.title ?? part.appName ?? 'Drawing Kit',
    description: 'Drawing Kit stays live inside the reviewed bridge runtime and syncs host-owned state back into the thread.',
    statusText: snapshot.statusText,
    error: undefined,
  }
}

function applyDrawingKitSnapshotToSession(
  session: Session,
  input: {
    messageId: string
    part: MessageAppPart
    snapshot: ReturnType<typeof createInitialDrawingKitAppSnapshot>
    payload: Record<string, unknown>
    now: number
  }
) {
  const auditedSession = ensureAppRecordAudit(session, input.part, input.payload, input.now)
  const store = createChatBridgeAppRecordStore({
    snapshot: auditedSession.chatBridgeAppRecords,
    now: () => input.now,
  })
  const instance = store.getInstance(input.part.appInstanceId)

  if (instance) {
    const result = store.recordHostEvent({
      appInstanceId: input.part.appInstanceId,
      kind: 'state.updated',
      nextStatus: 'active',
      bridgeSessionId: input.part.bridgeSessionId,
      createdAt: input.now,
      snapshot: input.snapshot,
      payload: input.payload,
      summaryForModel: input.snapshot.summary,
    })

    if (!result.accepted) {
      throw new Error(`Failed to record Drawing Kit state update: ${result.reason}`)
    }
  }

  const nextSession = updateSessionAppPart(
    {
      ...auditedSession,
      chatBridgeAppRecords: store.snapshot(),
    },
    input.messageId,
    input.part.appInstanceId,
    (part) => buildDrawingKitPart(part, input.snapshot)
  )

  return {
    ...nextSession,
    chatBridgeAppRecords: store.snapshot(),
  }
}

async function persistActiveAppScreenshot(sessionId: string, resolved: ResolvedAppPart, payload: Record<string, unknown>, dataUrl: string) {
  const dependencies = await createModelDependencies()
  const capturedAt = Date.now()
  const storageKey = await dependencies.storage.saveImage('chatbridge-app-screenshot', dataUrl)

  await updatePersistedSession(sessionId, (session) => {
    if (!session) {
      throw new Error(`Session ${sessionId} not found while persisting the app screenshot.`)
    }

    const current = findAppPartInSession(session, resolved.part.appInstanceId)
    if (!current) {
      return session
    }

    const auditedSession = ensureAppRecordAudit(session, current.part, payload, capturedAt)
    return updateSessionAppPart(auditedSession, current.messageId, current.part.appInstanceId, (part) => ({
      ...part,
      values: appendChatBridgeAppScreenshot(part.values, {
        kind: 'app-screenshot',
        appId: part.appId,
        appInstanceId: part.appInstanceId,
        storageKey,
        capturedAt,
        source: 'host-rendered',
        summary:
          part.appId === 'chess'
            ? `Latest ${part.appName ?? part.appId} board screenshot.`
            : `Latest ${part.appName ?? part.appId} canvas screenshot.`,
      }),
    }))
  })

  return {
    kind: 'app-screenshot' as const,
    appId: resolved.part.appId,
    appInstanceId: resolved.part.appInstanceId,
    storageKey,
    capturedAt,
  }
}

function getScreenshotDataUrl(part: MessageAppPart) {
  if (part.appId === 'chess') {
    return createChessScreenshotDataUrl(parseChessAppSnapshot(part.snapshot))
  }

  if (part.appId === 'drawing-kit') {
    const snapshot = createInitialDrawingKitAppSnapshot({
      snapshot: part.snapshot,
      request: readChatBridgeReviewedAppLaunch(part.values)?.request,
    })
    return createDrawingKitScreenshotDataUrl(snapshot)
  }

  throw new Error(`${part.appName ?? part.appId} does not expose bounded screenshot capture yet.`)
}

function extractPromotion(promotion?: 'q' | 'r' | 'b' | 'n'): PieceSymbol | undefined {
  return promotion as PieceSymbol | undefined
}

function getChessToolSet(selection: ChatBridgeSelectedAppContext, sessionId: string): ToolSet {
  const writeTools: ToolSet =
    selection.lifecycle === 'active'
      ? {
          chess_move_active_game: createChatBridgeHostTool({
      description:
        'Move a piece in the active host-owned Chess app. Use SAN when available, or provide both from and to squares.',
      appId: 'chess',
      schemaVersion: 1,
      effect: 'side-effect',
      retryClassification: 'safe',
      inputSchema: ChessMoveToolInputSchema,
      execute: async (input) => {
        const resolved = await resolveCurrentAppPart(sessionId, selection.appInstanceId)
        if (!resolved) {
          throw new Error('The active Chess app instance is no longer available.')
        }

        const snapshot = parseChessAppSnapshot(resolved.part.snapshot)
        const nextGame = new Chess(snapshot.fen)
        let attemptedMove: ReturnType<Chess['move']> | null = null

        try {
          attemptedMove = input.san
            ? nextGame.move(input.san)
            : nextGame.move({
                from: input.from!,
                to: input.to!,
                ...(input.promotion ? { promotion: extractPromotion(input.promotion) } : {}),
              })
        } catch {
          attemptedMove = null
        }

        const now = Date.now()
        if (!attemptedMove) {
          const rejectedSnapshot = createRejectedChessSnapshot(snapshot, {
            message:
              input.san ??
              `${(input.from ?? '').toUpperCase()} cannot move to ${(input.to ?? '').toUpperCase()} from the current board state.`,
            attemptedFrom: input.from,
            attemptedTo: input.to,
            lastUpdatedAt: now,
          })

          await updatePersistedSession(sessionId, (session) => {
            if (!session) {
              throw new Error(`Session ${sessionId} not found while rejecting the Chess move.`)
            }

            const current = findAppPartInSession(session, resolved.part.appInstanceId)
            if (!current) {
              return session
            }

            const audited = ensureAppRecordAudit(
              session,
              current.part,
              {
                toolName: 'chess_move_active_game',
                requestedMove: input.san ?? `${input.from}-${input.to}`,
                accepted: false,
              },
              now
            )

            return applyChessSnapshotToSession(audited, {
              sessionId,
              messageId: current.messageId,
              part: current.part,
              snapshot: rejectedSnapshot,
            })
          })

          return {
            accepted: false,
            appId: 'chess',
            appInstanceId: resolved.part.appInstanceId,
            summary: rejectedSnapshot.lastAction.message,
            fen: rejectedSnapshot.fen,
          }
        }

        const moveState = createChessMoveState(attemptedMove, snapshot.moveHistory.length + 1, now)
        const nextSnapshot = createChessAppSnapshotFromGame(nextGame, {
          lastUpdatedAt: now,
          lastAction: {
            kind: 'accepted',
            message: `Accepted ${attemptedMove.san}. ${getTurnLabel(nextGame.turn() === 'w' ? 'white' : 'black')} to move.`,
            move: moveState,
          },
        })

        await updatePersistedSession(sessionId, (session) => {
          if (!session) {
            throw new Error(`Session ${sessionId} not found while persisting the Chess move.`)
          }

          const current = findAppPartInSession(session, resolved.part.appInstanceId)
          if (!current) {
            return session
          }

          const audited = ensureAppRecordAudit(
            session,
            current.part,
            {
              toolName: 'chess_move_active_game',
              requestedMove: attemptedMove.san,
              accepted: true,
            },
            now
          )

          return applyChessSnapshotToSession(audited, {
            sessionId,
            messageId: current.messageId,
            part: current.part,
            snapshot: nextSnapshot,
          })
        })

        return {
          accepted: true,
          appId: 'chess',
          appInstanceId: resolved.part.appInstanceId,
          move: attemptedMove.san,
          summary: getChessSummary(nextSnapshot),
          fen: nextSnapshot.fen,
          statusText: getChessStatusLabel(nextSnapshot),
        }
      },
    }),
          chess_undo_active_game: createChatBridgeHostTool({
      description: 'Undo the latest legal move in the active host-owned Chess app.',
      appId: 'chess',
      schemaVersion: 1,
      effect: 'side-effect',
      retryClassification: 'safe',
      inputSchema: z.object({
        idempotencyKey: z.string().trim().min(1).optional(),
      }),
      execute: async () => {
        const resolved = await resolveCurrentAppPart(sessionId, selection.appInstanceId)
        if (!resolved) {
          throw new Error('The active Chess app instance is no longer available.')
        }

        const snapshot = parseChessAppSnapshot(resolved.part.snapshot)
        const now = Date.now()
        if (snapshot.moveHistory.length === 0) {
          return {
            accepted: false,
            appId: 'chess',
            appInstanceId: resolved.part.appInstanceId,
            summary: 'There is no legal move to undo from this board state.',
          }
        }

        const game = new Chess(snapshot.fen)
        game.undo()
        const nextSnapshot = createChessAppSnapshotFromGame(game, {
          lastUpdatedAt: now,
          lastAction: {
            kind: 'idle',
            message: `Undid ${snapshot.moveHistory.at(-1)?.san ?? 'the latest move'}. ${getTurnLabel(game.turn() === 'w' ? 'white' : 'black')} to move.`,
          },
        })

        await updatePersistedSession(sessionId, (session) => {
          if (!session) {
            throw new Error(`Session ${sessionId} not found while undoing the Chess move.`)
          }

          const current = findAppPartInSession(session, resolved.part.appInstanceId)
          if (!current) {
            return session
          }

          const audited = ensureAppRecordAudit(
            session,
            current.part,
            {
              toolName: 'chess_undo_active_game',
              accepted: true,
            },
            now
          )

          return applyChessSnapshotToSession(audited, {
            sessionId,
            messageId: current.messageId,
            part: current.part,
            snapshot: nextSnapshot,
          })
        })

        return {
          accepted: true,
          appId: 'chess',
          appInstanceId: resolved.part.appInstanceId,
          summary: getChessSummary(nextSnapshot),
          fen: nextSnapshot.fen,
        }
      },
    }),
        }
      : {}

  return {
    ...writeTools,
    chess_explain_active_position: createChatBridgeHostTool({
      description: 'Read the active host-owned Chess position summary without mutating the board.',
      appId: 'chess',
      schemaVersion: 1,
      effect: 'read',
      retryClassification: 'safe',
      inputSchema: z.object({}),
      execute: async () => {
        const resolved = await resolveCurrentAppPart(sessionId, selection.appInstanceId)
        if (!resolved) {
          throw new Error('The active Chess app instance is no longer available.')
        }

        const snapshot = parseChessAppSnapshot(resolved.part.snapshot)
        return {
          appId: 'chess',
          appInstanceId: resolved.part.appInstanceId,
          summary: getChessSummary(snapshot),
          statusText: getChessStatusLabel(snapshot),
          fen: snapshot.fen,
          lastMove: snapshot.moveHistory.at(-1)?.san ?? null,
          moveCount: snapshot.moveHistory.length,
        }
      },
    }),
    chess_read_history_active_game: createChatBridgeHostTool({
      description: 'Read the full recorded Chess move history from the active host-owned board.',
      appId: 'chess',
      schemaVersion: 1,
      effect: 'read',
      retryClassification: 'safe',
      inputSchema: ChessReadHistoryInputSchema,
      execute: async (input) => {
        const resolved = await resolveCurrentAppPart(sessionId, selection.appInstanceId)
        if (!resolved) {
          throw new Error('The active Chess app instance is no longer available.')
        }

        const snapshot = parseChessAppSnapshot(resolved.part.snapshot)
        return input.format === 'pgn'
          ? {
              appId: 'chess',
              appInstanceId: resolved.part.appInstanceId,
              format: 'pgn',
              pgn: snapshot.pgn,
              moveCount: snapshot.moveHistory.length,
            }
          : {
              appId: 'chess',
              appInstanceId: resolved.part.appInstanceId,
              format: 'ledger',
              moveCount: snapshot.moveHistory.length,
              moves: snapshot.moveHistory.map((move) => ({
                moveNumber: move.moveNumber,
                san: move.san,
                from: move.from,
                to: move.to,
              })),
            }
      },
    }),
  }
}

function getDrawingKitToolSet(selection: ChatBridgeSelectedAppContext, sessionId: string): ToolSet {
  if (selection.lifecycle !== 'active') {
    return {}
  }

  return {
    drawing_kit_control_active_canvas: createChatBridgeHostTool({
      description:
        'Control the active Drawing Kit canvas with bounded host-owned actions such as selecting a tool, drawing a supported shape, erasing the last mark, clearing the canvas, or banking a checkpoint.',
      appId: 'drawing-kit',
      schemaVersion: 1,
      effect: 'side-effect',
      retryClassification: 'safe',
      inputSchema: DrawingKitToolInputSchema,
      execute: async (input) => {
        const resolved = await resolveCurrentAppPart(sessionId, selection.appInstanceId)
        if (!resolved) {
          throw new Error('The active Drawing Kit app instance is no longer available.')
        }

        const snapshot = createInitialDrawingKitAppSnapshot({
          snapshot: resolved.part.snapshot,
          request: readChatBridgeReviewedAppLaunch(resolved.part.values)?.request,
        })
        const now = Date.now()

        const nextSnapshot =
          input.action === 'select_tool'
            ? setDrawingKitSelectedTool(snapshot, input.tool as DrawingKitTool, { lastUpdatedAt: now })
            : input.action === 'draw_shape'
              ? appendDrawingKitPreviewMarks(snapshot, describeDrawingKitShape(input.shape as DrawingKitDrawShape, snapshot.previewMarks.length), {
                  caption: input.caption,
                  selectedTool:
                    input.shape === 'star' || input.shape === 'burst' || input.shape === 'sticker'
                      ? 'stamp'
                      : input.shape === 'squiggle'
                        ? 'spray'
                        : input.tool ?? 'brush',
                  lastUpdatedAt: now,
                })
              : input.action === 'erase_last_mark'
                ? eraseLastDrawingKitPreviewMark(snapshot, { lastUpdatedAt: now })
                : input.action === 'clear_canvas'
                  ? clearDrawingKitPreviewMarks(snapshot, { lastUpdatedAt: now })
                  : bankDrawingKitSnapshot(snapshot, { caption: input.caption, lastUpdatedAt: now })

        await updatePersistedSession(sessionId, (session) => {
          if (!session) {
            throw new Error(`Session ${sessionId} not found while updating Drawing Kit.`)
          }

          const current = findAppPartInSession(session, resolved.part.appInstanceId)
          if (!current) {
            return session
          }

          return applyDrawingKitSnapshotToSession(session, {
            messageId: current.messageId,
            part: current.part,
            snapshot: nextSnapshot,
            payload: {
              toolName: 'drawing_kit_control_active_canvas',
              action: input.action,
              tool: input.tool,
              shape: input.shape,
            },
            now,
          })
        })

        return {
          accepted: true,
          appId: 'drawing-kit',
          appInstanceId: resolved.part.appInstanceId,
          action: input.action,
          summary: nextSnapshot.summary,
          statusText: nextSnapshot.statusText,
          checkpointId: nextSnapshot.checkpointId,
        }
      },
    }),
  }
}

function getScreenshotTool(selection: ChatBridgeSelectedAppContext, sessionId: string): ToolSet {
  return {
    capture_active_app_screenshot: createChatBridgeHostTool({
      description:
        'Capture a bounded host-owned screenshot artifact for the currently selected active app instance and attach it to the thread.',
      appId: selection.appId,
      schemaVersion: 1,
      effect: 'side-effect',
      retryClassification: 'safe',
      inputSchema: AppScreenshotInputSchema,
      execute: async () => {
        const resolved = await resolveCurrentAppPart(sessionId, selection.appInstanceId)
        if (!resolved) {
          throw new Error('The selected app instance is no longer available.')
        }

        const artifact = await persistActiveAppScreenshot(
          sessionId,
          resolved,
          {
            toolName: 'capture_active_app_screenshot',
          },
          getScreenshotDataUrl(resolved.part)
        )

        return {
          appId: resolved.part.appId,
          appInstanceId: resolved.part.appInstanceId,
          summary: `Captured a bounded screenshot for ${resolved.part.appName ?? resolved.part.appId}.`,
          artifact,
        }
      },
    }),
  }
}

export function createActiveChatBridgeToolSet(options: {
  messages: Message[]
  sessionId?: string
}): ActiveAppToolSetResult {
  if (!options.sessionId) {
    return {
      selection: null,
      tools: {},
    }
  }

  const selection = selectChatBridgeAppContext(options.messages)
  if (!selection) {
    return {
      selection: null,
      tools: {},
    }
  }

  if (selection.appId === 'chess') {
    return {
      selection,
      tools: {
        ...getChessToolSet(selection, options.sessionId),
        ...getScreenshotTool(selection, options.sessionId),
      },
    }
  }

  if (selection.appId === 'drawing-kit') {
    return {
      selection,
      tools: {
        ...getDrawingKitToolSet(selection, options.sessionId),
        ...getScreenshotTool(selection, options.sessionId),
      },
    }
  }

  return {
    selection,
    tools: {},
  }
}

function readHostToolRecord(part: MessageToolCallPart): ChatBridgeHostToolExecutionRecord | null {
  if (!isChatBridgeHostToolExecutionRecord(part.result)) {
    return null
  }

  return part.result
}

export function upsertChatBridgeActiveAppArtifacts(contentParts: MessageContentParts): MessageContentParts {
  const seenImages = new Set(
    contentParts.filter((part): part is Extract<MessageContentParts[number], { type: 'image' }> => part.type === 'image').map((part) => part.storageKey)
  )

  const nextParts: MessageContentParts = []
  for (const part of contentParts) {
    nextParts.push(part)
    if (part.type !== 'tool-call') {
      continue
    }

    const record = readHostToolRecord(part)
    const artifact = record?.outcome.status === 'success' ? (record.outcome.result as { artifact?: unknown } | undefined)?.artifact : null
    if (
      !artifact ||
      typeof artifact !== 'object' ||
      !('kind' in artifact) ||
      artifact.kind !== 'app-screenshot' ||
      !('storageKey' in artifact) ||
      typeof artifact.storageKey !== 'string' ||
      seenImages.has(artifact.storageKey)
    ) {
      continue
    }

    seenImages.add(artifact.storageKey)
    nextParts.push({
      type: 'image',
      storageKey: artifact.storageKey,
    })
  }

  return nextParts
}
