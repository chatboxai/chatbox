/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { createChatBridgeChessRuntimeSnapshot } from '@shared/chatbridge'
import type { MessageAppPart } from '@shared/types'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatBridgeMessagePart } from './ChatBridgeMessagePart'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

function createChessPart(snapshot = createChatBridgeChessRuntimeSnapshot()): MessageAppPart {
  return {
    type: 'app',
    appId: 'chess',
    appName: 'Chess',
    appInstanceId: 'chess-instance-1',
    lifecycle: 'active',
    title: 'Chess runtime',
    description:
      'Moves validate inside the board first, then emit a structured host update for the same conversation block.',
    summary: snapshot.boardContext.summary,
    statusText: 'White to move',
    snapshot,
  }
}

describe('ChatBridgeMessagePart chess runtime', () => {
  it('renders the playable chess board inside the active host shell', () => {
    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={createChessPart()} />
      </MantineProvider>
    )

    expect(screen.getByTestId('chatbridge-shell').getAttribute('data-state')).toBe('active')
    expect(screen.getByRole('button', { name: /g1, white knight/i })).toBeTruthy()
    expect(screen.getByText('Select a piece, then choose a legal destination square.')).toBeTruthy()
  })

  it('emits a structured host update when a legal move is played', () => {
    const onUpdatePart = vi.fn()

    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={createChessPart()} onUpdatePart={onUpdatePart} />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /g1, white knight/i }))
    fireEvent.click(screen.getByRole('button', { name: /f3, legal destination/i }))

    expect(onUpdatePart).toHaveBeenCalledTimes(1)
    expect(onUpdatePart.mock.calls[0][0]).toMatchObject({
      summary: 'Black to move after Nf3.',
      statusText: 'Black to move',
      snapshot: {
        boardContext: {
          sideToMove: 'black',
          lastMove: {
            san: 'Nf3',
            uci: 'g1f3',
          },
        },
      },
    })
  })

  it('keeps the board state stable and emits rejected feedback for an illegal move', () => {
    const onUpdatePart = vi.fn()

    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={createChessPart()} onUpdatePart={onUpdatePart} />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /g1, white knight/i }))
    fireEvent.click(screen.getByRole('button', { name: /g5, empty square/i }))

    expect(onUpdatePart).toHaveBeenCalledTimes(1)
    expect(onUpdatePart.mock.calls[0][0]).toMatchObject({
      snapshot: {
        boardContext: {
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        },
        feedback: {
          kind: 'rejected',
          title: 'Illegal move rejected',
        },
      },
    })
  })
})
