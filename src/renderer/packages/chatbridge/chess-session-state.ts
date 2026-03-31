import {
  CHESS_APP_NAME,
  type ChessAppSnapshot,
  getChessDescription,
  getChessFallbackText,
  getChessStatusLabel,
  getChessSummary,
  parseChessAppSnapshot,
} from '@shared/chatbridge/apps/chess'
import type { Message, MessageAppPart, Session } from '@shared/types'
import { updateSessionWithMessages } from '@/stores/chatStore'
import { createChatBridgeAppRecordStore } from './app-records'

const CHESS_APP_VERSION = '1.0.0'

type PersistChessSessionStateInput = {
  sessionId: string
  messageId: string
  part: MessageAppPart
  snapshot: ChessAppSnapshot
}

type PersistChessSessionStateOptions = {
  now?: () => number
  createId?: () => string
}

function updateMessageParts(
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

  if (!updated) {
    return message
  }

  return {
    ...message,
    contentParts,
  }
}

function updateSessionMessageAppPart(
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
    return updateMessageParts(message, appInstanceId, updater)
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
      return updateMessageParts(message, appInstanceId, updater)
    })

    return found
      ? {
          ...thread,
          messages: nextMessages,
        }
      : thread
  })

  if (!found) {
    return session
  }

  return {
    ...session,
    threads,
  }
}

export function buildChessMessageAppPart(part: MessageAppPart, snapshot: ChessAppSnapshot): MessageAppPart {
  return {
    ...part,
    appId: part.appId || 'chess',
    appName: part.appName || CHESS_APP_NAME,
    lifecycle: 'active',
    summary: getChessSummary(snapshot),
    title: 'Chess board',
    description: getChessDescription(snapshot),
    statusText: getChessStatusLabel(snapshot),
    fallbackTitle: 'Chess fallback',
    fallbackText: getChessFallbackText(snapshot),
    snapshot,
  }
}

export function applyChessSnapshotToSession(
  session: Session,
  input: PersistChessSessionStateInput,
  options: PersistChessSessionStateOptions = {}
): Session {
  const snapshot = parseChessAppSnapshot(input.snapshot)
  const store = createChatBridgeAppRecordStore({
    snapshot: session.chatBridgeAppRecords,
    now: options.now,
    createId: options.createId,
  })

  const existingInstance = store.getInstance(input.part.appInstanceId)

  if (!existingInstance) {
    store.createInstance({
      id: input.part.appInstanceId,
      appId: input.part.appId,
      appVersion: CHESS_APP_VERSION,
      bridgeSessionId: input.part.bridgeSessionId,
      owner: {
        authority: 'host',
        conversationSessionId: session.id,
        initiatedBy: 'assistant',
      },
      resumability: {
        mode: 'resumable',
        resumeKey: input.part.appInstanceId,
      },
      createdAt: snapshot.lastUpdatedAt,
    })
  }

  const readyInstance = store.getInstance(input.part.appInstanceId)
  if (readyInstance?.status === 'launching') {
    const readyResult = store.recordHostEvent({
      appInstanceId: input.part.appInstanceId,
      kind: 'bridge.ready',
      nextStatus: 'ready',
      bridgeSessionId: input.part.bridgeSessionId,
      createdAt: snapshot.lastUpdatedAt,
      snapshot,
      payload: {
        source: 'chess-runtime',
      },
    })

    if (!readyResult.accepted) {
      throw new Error(`Failed to record chess ready event: ${readyResult.reason}`)
    }
  }

  const eventResult = store.recordHostEvent({
    appInstanceId: input.part.appInstanceId,
    kind: 'state.updated',
    nextStatus: 'active',
    bridgeSessionId: input.part.bridgeSessionId,
    createdAt: snapshot.lastUpdatedAt,
    snapshot,
    payload: {
      moveCount: snapshot.moveHistory.length,
      turn: snapshot.turn,
      phase: snapshot.status.phase,
      lastAction: snapshot.lastAction,
    },
    summaryForModel: getChessSummary(snapshot),
  })

  if (!eventResult.accepted) {
    throw new Error(`Failed to record chess state update: ${eventResult.reason}`)
  }

  const nextSession = updateSessionMessageAppPart(session, input.messageId, input.part.appInstanceId, (part) =>
    buildChessMessageAppPart(part, snapshot)
  )

  return {
    ...nextSession,
    chatBridgeAppRecords: store.snapshot(),
  }
}

export async function persistChessSnapshot(input: PersistChessSessionStateInput) {
  return await updateSessionWithMessages(input.sessionId, (session) => {
    if (!session) {
      throw new Error(`Session ${input.sessionId} not found while persisting chess state.`)
    }

    return applyChessSnapshotToSession(session, input)
  })
}
