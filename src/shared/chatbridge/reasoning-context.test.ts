import { describe, expect, it } from 'vitest'
import type { Message, MessageAppLifecycle, MessageAppPart } from '../types/session'
import {
  buildChatBridgeChessReasoningPrompt,
  resolveChatBridgeChessReasoningContext,
} from './reasoning-context'

function createChessAppPart(
  lifecycle: MessageAppLifecycle,
  snapshot?: Record<string, unknown>
): MessageAppPart {
  return {
    type: 'app',
    appId: 'chess',
    appName: 'Chess',
    appInstanceId: 'chess-instance-1',
    lifecycle,
    summary: 'Chess remains in the thread.',
    snapshot,
  }
}

function createAssistantMessage(part: MessageAppPart): Message {
  return {
    id: `assistant-${part.lifecycle}`,
    role: 'assistant',
    timestamp: Date.now(),
    contentParts: [{ type: 'text', text: 'Chess remains active.' }, part],
  }
}

const liveBoardSnapshot = {
  route: '/apps/chess',
  boardContext: {
    schemaVersion: 1,
    fen: 'r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6',
    sideToMove: 'white' as const,
    fullmoveNumber: 6,
    legalMovesCount: 33,
    positionStatus: 'in_progress' as const,
    lastMove: {
      san: '...e5',
      uci: 'e7e5',
    },
    summary: 'White to move in an Italian Game structure after ...e5.',
  },
}

describe('ChatBridge chess reasoning context', () => {
  it('normalizes the latest active chess board snapshot into host-owned live context', () => {
    const context = resolveChatBridgeChessReasoningContext([createAssistantMessage(createChessAppPart('active', liveBoardSnapshot))])

    expect(context).toMatchObject({
      state: 'live',
      appId: 'chess',
      appInstanceId: 'chess-instance-1',
      board: {
        fen: liveBoardSnapshot.boardContext.fen,
        sideToMove: 'white',
        fullmoveNumber: 6,
        positionStatus: 'in_progress',
        legalMovesCount: 33,
      },
    })

    const prompt = buildChatBridgeChessReasoningPrompt([createAssistantMessage(createChessAppPart('active', liveBoardSnapshot))])

    expect(prompt).toContain('ChatBridge active Chess context')
    expect(prompt).toContain(`Board FEN: ${liveBoardSnapshot.boardContext.fen}`)
    expect(prompt).toContain('Side to move: white')
    expect(prompt).toContain('Use only this bounded host summary')
  })

  it('keeps the last known board explicit when the host marks the chess state as stale', () => {
    const context = resolveChatBridgeChessReasoningContext([createAssistantMessage(createChessAppPart('stale', liveBoardSnapshot))])

    expect(context).toMatchObject({
      state: 'stale',
      lifecycle: 'stale',
      board: {
        fen: liveBoardSnapshot.boardContext.fen,
      },
    })

    const prompt = buildChatBridgeChessReasoningPrompt([createAssistantMessage(createChessAppPart('stale', liveBoardSnapshot))])

    expect(prompt).toContain('Context state: stale')
    expect(prompt).toContain('board snapshot as stale')
  })

  it('falls back to unavailable when the latest chess shell has no validated board snapshot', () => {
    const context = resolveChatBridgeChessReasoningContext([
      createAssistantMessage(
        createChessAppPart('active', {
          route: '/apps/chess',
          boardContext: {
            summary: 'raw partner prose should not pass validation',
          },
        })
      ),
    ])

    expect(context).toMatchObject({
      state: 'unavailable',
      lifecycle: 'active',
    })
    expect(context?.board).toBeUndefined()

    const prompt = buildChatBridgeChessReasoningPrompt([
      createAssistantMessage(
        createChessAppPart('active', {
          route: '/apps/chess',
          boardContext: {
            summary: 'raw partner prose should not pass validation',
          },
        })
      ),
    ])

    expect(prompt).toContain('Context state: unavailable')
    expect(prompt).toContain('does not have a validated live board snapshot')
  })

  it('returns null when no live chess shell is present in the conversation', () => {
    const messages: Message[] = [
      {
        id: 'assistant-story-builder',
        role: 'assistant',
        timestamp: Date.now(),
        contentParts: [
          { type: 'text', text: 'Story Builder remains active.' },
          {
            type: 'app',
            appId: 'story-builder',
            appName: 'Story Builder',
            appInstanceId: 'story-instance-1',
            lifecycle: 'active',
          },
        ],
      },
    ]

    expect(resolveChatBridgeChessReasoningContext(messages)).toBeNull()
    expect(buildChatBridgeChessReasoningPrompt(messages)).toBeNull()
  })
})
