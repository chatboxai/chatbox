/**
 * @vitest-environment jsdom
 */

import { Chess } from 'chess.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createChessAppSnapshotFromGame,
  createChessMoveState,
  createInitialChessAppSnapshot,
  createRejectedChessSnapshot,
} from '@shared/chatbridge/apps/chess'
import type { MessageAppPart, Session } from '@shared/types'

vi.mock('@/stores/chatStore', () => ({
  updateSessionWithMessages: vi.fn(),
}))

import { applyChessSnapshotToSession } from './chess-session-state'

function buildSessionWithChessPart(overrides: Partial<Session> = {}) {
  const snapshot = createInitialChessAppSnapshot(1_000)
  const chessPart: MessageAppPart = {
    type: 'app',
    appId: 'chess',
    appName: 'Chess',
    appInstanceId: 'chess-instance-1',
    lifecycle: 'active',
    bridgeSessionId: 'bridge-chess-1',
    summary: 'Chess board ready.',
    snapshot,
  }

  const session: Session = {
    id: 'session-1',
    name: 'Chess Session',
    type: 'chat',
    messages: [
      {
        id: 'msg-1',
        role: 'assistant',
        timestamp: 1_000,
        contentParts: [chessPart],
      },
    ],
    ...overrides,
  }

  return {
    session,
    chessPart,
  }
}

describe('applyChessSnapshotToSession', () => {
  it('creates session app records and persists an accepted move on the root timeline message', () => {
    const { session, chessPart } = buildSessionWithChessPart()
    const game = new Chess()
    const move = game.move({ from: 'e2', to: 'e4' })
    if (!move) {
      throw new Error('Expected e2e4 to be legal.')
    }

    const nextSnapshot = createChessAppSnapshotFromGame(game, {
      lastUpdatedAt: 2_000,
      lastAction: {
        kind: 'accepted',
        message: 'Accepted e4. Black to move.',
        move: createChessMoveState(move, 1, 2_000),
      },
    })

    const updated = applyChessSnapshotToSession(session, {
      sessionId: session.id,
      messageId: 'msg-1',
      part: chessPart,
      snapshot: nextSnapshot,
    })

    const updatedPart = updated.messages[0].contentParts[0]
    if (updatedPart.type !== 'app') {
      throw new Error('Expected the updated message part to remain an app part.')
    }

    expect(updatedPart.snapshot).toMatchObject({
      fen: nextSnapshot.fen,
      turn: 'black',
    })
    expect(updatedPart.summary).toContain('e4')
    expect(updated.chatBridgeAppRecords?.instances[0]).toMatchObject({
      id: 'chess-instance-1',
      status: 'active',
    })
    expect(updated.chatBridgeAppRecords?.events).toHaveLength(3)
    expect(updated.chatBridgeAppRecords?.events.at(-1)).toMatchObject({
      kind: 'state.updated',
      sequence: 3,
      summaryForModel: updatedPart.summary,
    })
  })

  it('updates a thread message and preserves the board state on rejected moves', () => {
    const { session: baseSession, chessPart } = buildSessionWithChessPart()
    const session: Session = {
      ...baseSession,
      messages: [],
      threads: [
        {
          id: 'thread-1',
          name: 'Chess Runtime',
          createdAt: 1_000,
          messages: [
            {
              id: 'thread-msg-1',
              role: 'assistant',
              timestamp: 1_000,
              contentParts: [chessPart],
            },
          ],
        },
      ],
    }

    const nextSnapshot = createRejectedChessSnapshot(createInitialChessAppSnapshot(1_000), {
      message: 'E2 cannot move to E5 from the current board state.',
      attemptedFrom: 'e2',
      attemptedTo: 'e5',
      lastUpdatedAt: 1_500,
    })

    const updated = applyChessSnapshotToSession(session, {
      sessionId: session.id,
      messageId: 'thread-msg-1',
      part: chessPart,
      snapshot: nextSnapshot,
    })

    const updatedPart = updated.threads?.[0]?.messages[0]?.contentParts[0]
    if (!updatedPart || updatedPart.type !== 'app') {
      throw new Error('Expected the thread message to contain the updated chess app part.')
    }

    expect(updatedPart.snapshot).toMatchObject({
      fen: nextSnapshot.fen,
      lastAction: {
        kind: 'rejected',
      },
    })
    expect(updatedPart.description).toContain('rejection inline')
    expect(updated.chatBridgeAppRecords?.events.at(-1)).toMatchObject({
      kind: 'state.updated',
      payload: expect.objectContaining({
        phase: 'active',
      }),
    })
  })
})
