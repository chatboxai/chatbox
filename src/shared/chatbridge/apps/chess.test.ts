import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHESS_AI_CONFIG,
  createChessAppSnapshotFromGame,
  createChessMoveState,
  createInitialChessAppSnapshot,
  createRejectedChessSnapshot,
  getChessAiConfig,
  getChessPieceAtSquare,
  getChessStatusLabel,
  getChessSummary,
  selectChessAiMove,
} from './chess'

describe('shared chess app helpers', () => {
  it('builds the opening snapshot with the full board state', () => {
    const snapshot = createInitialChessAppSnapshot(1_000)

    expect(snapshot.turn).toBe('white')
    expect(snapshot.board).toHaveLength(32)
    expect(getChessPieceAtSquare(snapshot, 'e1')).toMatchObject({
      color: 'white',
      piece: 'king',
      glyph: '\u2654',
    })
    expect(getChessStatusLabel(snapshot)).toBe('White to move')
  })

  it('can seed an opening snapshot with the default black AI config', () => {
    const snapshot = createInitialChessAppSnapshot(1_000, {
      ai: DEFAULT_CHESS_AI_CONFIG,
    })

    expect(getChessAiConfig(snapshot)).toEqual(DEFAULT_CHESS_AI_CONFIG)
  })

  it('captures accepted and rejected move state from a real chess position', () => {
    const game = new Chess()
    const move = game.move({ from: 'e2', to: 'e4' })
    if (!move) {
      throw new Error('Expected e2e4 to be legal.')
    }

    const acceptedSnapshot = createChessAppSnapshotFromGame(game, {
      lastUpdatedAt: 2_000,
      lastAction: {
        kind: 'accepted',
        message: 'Accepted e4. Black to move.',
        move: createChessMoveState(move, 1, 2_000),
      },
    })
    const rejectedSnapshot = createRejectedChessSnapshot(acceptedSnapshot, {
      message: 'E4 cannot move to E6 from the current board state.',
      attemptedFrom: 'e4',
      attemptedTo: 'e6',
      lastUpdatedAt: 2_100,
    })

    expect(acceptedSnapshot.turn).toBe('black')
    expect(getChessPieceAtSquare(acceptedSnapshot, 'e4')).toMatchObject({
      color: 'white',
      piece: 'pawn',
    })
    expect(getChessSummary(acceptedSnapshot)).toContain('e4')
    expect(rejectedSnapshot.lastAction).toMatchObject({
      kind: 'rejected',
      attemptedFrom: 'e4',
      attemptedTo: 'e6',
    })
    expect(rejectedSnapshot.fen).toBe(acceptedSnapshot.fen)
  })

  it('selects a deterministic legal black reply when AI mode is enabled', () => {
    const game = new Chess()
    const playerMove = game.move({ from: 'e2', to: 'e4' })
    if (!playerMove) {
      throw new Error('Expected e2e4 to be legal.')
    }

    const aiMove = selectChessAiMove(game, DEFAULT_CHESS_AI_CONFIG)

    expect(aiMove).not.toBeNull()
    expect(aiMove).toMatchObject({
      from: expect.any(String),
      to: expect.any(String),
      san: expect.any(String),
    })

    const appliedMove = game.move({
      from: aiMove!.from,
      to: aiMove!.to,
      ...(aiMove?.promotion ? { promotion: aiMove.promotion } : {}),
    })

    expect(appliedMove).toBeTruthy()
    expect(appliedMove?.color).toBe('b')
  })
})
