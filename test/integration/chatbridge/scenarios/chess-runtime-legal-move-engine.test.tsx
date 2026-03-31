/**
 * @vitest-environment jsdom
 */

import '../setup'

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import type { MessageAppPart } from '@shared/types'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatBridgeMessagePart } from '@/components/chatbridge/ChatBridgeMessagePart'
import { buildChatBridgeChessMidGameSessionFixture } from '../fixtures/app-aware-session'

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

function getSeededChessPart() {
  const fixture = buildChatBridgeChessMidGameSessionFixture()
  const assistantMessage = fixture.messages.find((message) => message.id === 'msg-chess-assistant-board')
  const appPart = assistantMessage?.contentParts.find((part) => part.type === 'app')

  if (!appPart || appPart.type !== 'app') {
    throw new Error('Seeded Chess fixture is missing the active app part.')
  }

  return appPart as MessageAppPart
}

describe('ChatBridge chess runtime and legal move engine', () => {
  it('renders the seeded mid-game board and persists a legal move as structured host-owned state', () => {
    const onUpdatePart = vi.fn()

    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={getSeededChessPart()} onUpdatePart={onUpdatePart} />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /^c4, white bishop/i }))
    fireEvent.click(screen.getByRole('button', { name: /^f7, black pawn, legal destination/i }))

    expect(onUpdatePart).toHaveBeenCalledTimes(1)
    expect(onUpdatePart.mock.calls[0][0]).toMatchObject({
      appId: 'chess',
      lifecycle: 'active',
      statusText: 'Black in check',
      snapshot: {
        boardContext: {
          sideToMove: 'black',
          positionStatus: 'check',
          lastMove: {
            san: 'Bxf7+',
            uci: 'c4f7',
          },
        },
      },
    })
  })
})
