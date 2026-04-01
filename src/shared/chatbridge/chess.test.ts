import { describe, expect, it } from 'vitest'
import {
  applyChatBridgeChessMove,
  createChatBridgeChessRuntimeSnapshot,
  getChatBridgeChessStatusText,
  normalizeChatBridgeChessRuntimeSnapshot,
  undoChatBridgeChessMove,
} from './chess'

describe('ChatBridge chess runtime snapshot helpers', () => {
  it('creates a host-owned starting snapshot from the opening position', () => {
    const snapshot = createChatBridgeChessRuntimeSnapshot()

    expect(snapshot.boardContext.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(snapshot.boardContext.sideToMove).toBe('white')
    expect(snapshot.boardContext.positionStatus).toBe('in_progress')
    expect(snapshot.boardContext.summary).toBe('White to move from the starting position.')
    expect(getChatBridgeChessStatusText(snapshot)).toBe('White to move')
  })

  it('accepts a legal move and emits the updated host-owned board context', () => {
    const snapshot = createChatBridgeChessRuntimeSnapshot()
    const result = applyChatBridgeChessMove(snapshot, { from: 'e2', to: 'e4' })

    expect(result.accepted).toBe(true)
    if (!result.accepted) {
      throw new Error('Expected legal move to be accepted')
    }

    expect(result.move.san).toBe('e4')
    expect(result.snapshot.boardContext.sideToMove).toBe('black')
    expect(result.snapshot.boardContext.lastMove).toEqual({
      san: 'e4',
      uci: 'e2e4',
    })
    expect(result.snapshot.moveHistory).toHaveLength(1)
    expect(result.snapshot.feedback).toMatchObject({
      kind: 'accepted',
      title: 'Accepted move',
    })
  })

  it('rejects an illegal move without mutating the stored board state', () => {
    const snapshot = createChatBridgeChessRuntimeSnapshot()
    const result = applyChatBridgeChessMove(snapshot, { from: 'e2', to: 'e5' })

    expect(result.accepted).toBe(false)
    expect(result.snapshot.boardContext.fen).toBe(snapshot.boardContext.fen)
    expect(result.snapshot.moveHistory).toHaveLength(0)
    expect(result.snapshot.feedback).toMatchObject({
      kind: 'rejected',
      title: 'Illegal move rejected',
    })
  })

  it('undoes the latest stored move and restores the prior host-owned board state', () => {
    const afterE4 = applyChatBridgeChessMove(createChatBridgeChessRuntimeSnapshot(), {
      from: 'e2',
      to: 'e4',
    })
    if (!afterE4.accepted) {
      throw new Error('Expected legal move to be accepted')
    }

    const undone = undoChatBridgeChessMove(afterE4.snapshot)

    expect(undone.accepted).toBe(true)
    expect(undone.snapshot.boardContext.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(undone.snapshot.moveHistory).toHaveLength(0)
    expect(undone.snapshot.feedback).toMatchObject({
      kind: 'info',
      title: 'Move undone',
    })
  })

  it('normalizes legacy boardContext-only chess snapshots into the runtime schema', () => {
    const normalized = normalizeChatBridgeChessRuntimeSnapshot({
      route: '/apps/chess',
      status: 'active',
      boardContext: {
        schemaVersion: 1,
        fen: 'r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6',
        sideToMove: 'white',
        fullmoveNumber: 6,
        legalMovesCount: 33,
        positionStatus: 'in_progress',
        lastMove: {
          san: '...e5',
          uci: 'e7e5',
        },
        summary: 'White to move in an Italian Game structure after ...e5.',
      },
    })

    expect(normalized.startingFen).toBe('r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6')
    expect(normalized.moveHistory).toHaveLength(0)
    expect(normalized.boardContext.summary).toBe('White to move in an Italian Game structure after ...e5.')
  })
})
