/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(async () => undefined),
  reseedChatBridgeLiveSeedSessions: vi.fn(async () => [
    {
      fixture: {
        id: 'lifecycle-tour',
        name: '[Seeded] ChatBridge: Lifecycle tour',
      },
      sessionId: 'seeded-session-1',
    },
  ]),
  clearChatBridgeLiveSeedSessions: vi.fn(async () => undefined),
  switchCurrentSession: vi.fn(),
}))

vi.mock('@/stores/chatStore', () => ({
  useSessionList: () => ({
    sessionMetaList: [],
    refetch: mocks.refetch,
  }),
}))

vi.mock('@/dev/chatbridgeSeeds', async () => {
  const actual = await vi.importActual<typeof import('@/dev/chatbridgeSeeds')>('@/dev/chatbridgeSeeds')
  return {
    ...actual,
    reseedChatBridgeLiveSeedSessions: mocks.reseedChatBridgeLiveSeedSessions,
    clearChatBridgeLiveSeedSessions: mocks.clearChatBridgeLiveSeedSessions,
  }
})

vi.mock('@/stores/session/crud', () => ({
  switchCurrentSession: mocks.switchCurrentSession,
}))

import ChatBridgeSeedLab from './ChatBridgeSeedLab'

describe('ChatBridgeSeedLab', () => {
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

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the live inspection guidance and seeded scenario cards', () => {
    render(
      <MantineProvider>
        <ChatBridgeSeedLab />
      </MantineProvider>
    )

    expect(screen.getByText('ChatBridge Seed Lab')).toBeTruthy()
    expect(screen.getByText('[Seeded] ChatBridge: Lifecycle tour')).toBeTruthy()
    expect(screen.getByText('[Seeded] ChatBridge: History + preview')).toBeTruthy()
    expect(screen.getByText(/Seed real ChatBridge sessions into storage/i)).toBeTruthy()
  })

  it('reseeds and opens the requested scenario from the live lab', async () => {
    render(
      <MantineProvider>
        <ChatBridgeSeedLab />
      </MantineProvider>
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Reseed & Open' })[0])

    await waitFor(() => {
      expect(mocks.reseedChatBridgeLiveSeedSessions).toHaveBeenCalledWith(['lifecycle-tour'])
      expect(mocks.switchCurrentSession).toHaveBeenCalledWith('seeded-session-1')
    })
  })
})
