/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { createChatBridgeChessRuntimeSnapshot } from '@shared/chatbridge'
import type { MessageAppPart } from '@shared/types'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { FloatingChatBridgeRuntimeShell } from './FloatingChatBridgeRuntimeShell'

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

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

function createPart(): MessageAppPart {
  const snapshot = createChatBridgeChessRuntimeSnapshot()

  return {
    type: 'app',
    appId: 'chess',
    appName: 'Chess',
    appInstanceId: 'chess-instance-1',
    lifecycle: 'active',
    title: 'Chess runtime',
    description: 'Moves validate inside the board first.',
    summary: snapshot.boardContext.summary,
    statusText: 'White to move',
    snapshot,
  }
}

describe('FloatingChatBridgeRuntimeShell', () => {
  it('renders the active runtime tray outside the message flow', () => {
    render(
      <MantineProvider>
        <FloatingChatBridgeRuntimeShell
          sessionId="session-1"
          messageId="message-1"
          part={createPart()}
          minimized={false}
          onMinimizeChange={vi.fn()}
          onJumpToSource={vi.fn()}
        />
      </MantineProvider>
    )

    expect(screen.getByTestId('chatbridge-floating-runtime-shell')).toBeTruthy()
    expect(screen.getByText('App tray')).toBeTruthy()
    expect(screen.getByRole('button', { name: /minimize app tray/i })).toBeTruthy()
  })

  it('renders a compact restore bar when minimized', () => {
    const onMinimizeChange = vi.fn()

    render(
      <MantineProvider>
        <FloatingChatBridgeRuntimeShell
          sessionId="session-1"
          messageId="message-1"
          part={createPart()}
          minimized
          onMinimizeChange={onMinimizeChange}
          onJumpToSource={vi.fn()}
        />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /restore app/i }))
    expect(onMinimizeChange).toHaveBeenCalledWith(false)
  })
})
