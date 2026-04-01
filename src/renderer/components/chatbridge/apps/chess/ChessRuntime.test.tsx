/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialChessAppSnapshot } from '@shared/chatbridge/apps/chess'
import type { MessageAppPart } from '@shared/types'
import { ChessRuntime } from './ChessRuntime'

const mocks = vi.hoisted(() => ({
  persistChessSnapshot: vi.fn(async () => undefined),
}))

vi.mock('@/packages/chatbridge/chess-session-state', () => ({
  persistChessSnapshot: mocks.persistChessSnapshot,
}))

function renderRuntime(partOverrides: Partial<MessageAppPart> = {}) {
  const part: MessageAppPart = {
    type: 'app',
    appId: 'chess',
    appName: 'Chess',
    appInstanceId: 'chess-instance-1',
    lifecycle: 'active',
    bridgeSessionId: 'bridge-chess-1',
    snapshot: createInitialChessAppSnapshot(1_000),
    ...partOverrides,
  }

  return render(<ChessRuntime sessionId="session-1" messageId="msg-1" part={part} />)
}

describe('ChessRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders actual chess pieces on the board', () => {
    renderRuntime()

    expect(screen.getByLabelText('e1 white king').textContent).toContain('\u2654')
    expect(screen.getByLabelText('d8 black queen').textContent).toContain('\u265B')
  })

  it('persists a legal move after selecting a source and destination square', async () => {
    renderRuntime()

    fireEvent.click(screen.getByLabelText('e2 white pawn'))
    fireEvent.click(screen.getByLabelText('e4 empty square'))

    await waitFor(() => {
      expect(mocks.persistChessSnapshot).toHaveBeenCalledTimes(1)
    })

    expect(mocks.persistChessSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        messageId: 'msg-1',
        snapshot: expect.objectContaining({
          turn: 'black',
          lastAction: expect.objectContaining({
            kind: 'accepted',
            move: expect.objectContaining({
              san: 'e4',
            }),
          }),
        }),
      })
    )
  })

  it('persists a rejected move attempt without changing the board position', async () => {
    renderRuntime()

    fireEvent.click(screen.getByLabelText('e2 white pawn'))
    fireEvent.click(screen.getByLabelText('e5 empty square'))

    await waitFor(() => {
      expect(mocks.persistChessSnapshot).toHaveBeenCalledTimes(1)
    })

    expect(mocks.persistChessSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          lastAction: expect.objectContaining({
            kind: 'rejected',
            attemptedFrom: 'e2',
            attemptedTo: 'e5',
          }),
        }),
      })
    )
  })
})
