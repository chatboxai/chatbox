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
  getChatBridgeManualSmokeTraceSupport: vi.fn(async () => ({
    enabled: true,
    projectName: 'chatbox-chatbridge',
    reasonCode: 'enabled',
  })),
  startChatBridgeManualSmokeTrace: vi.fn(async () => ({
    status: 'started',
    run: {
      fixtureId: 'lifecycle-tour',
      runId: 'manual-run-1',
      traceName: 'chatbridge.manual_smoke.lifecycle-tour.seeded-session-1',
      projectName: 'chatbox-chatbridge',
      sessionId: 'seeded-session-1',
    },
  })),
  finishChatBridgeManualSmokeTrace: vi.fn(async () => true),
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

vi.mock('@/dev/chatbridgeManualSmoke', () => ({
  getChatBridgeManualSmokeTraceSupport: mocks.getChatBridgeManualSmokeTraceSupport,
  getChatBridgeManualSmokeFixtureMode: (fixtureId: string) =>
    fixtureId === 'history-and-preview'
      ? {
          support: 'legacy',
          reasonCode: 'legacy-reference',
          message: 'Legacy Story Builder reference fixture.',
        }
      : {
          support: 'supported',
          reasonCode: 'supported',
          message: 'Supported desktop smoke fixture.',
        },
  startChatBridgeManualSmokeTrace: mocks.startChatBridgeManualSmokeTrace,
  finishChatBridgeManualSmokeTrace: mocks.finishChatBridgeManualSmokeTrace,
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
    expect(screen.getByText('[Seeded] ChatBridge: Chess runtime')).toBeTruthy()
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
      expect(mocks.startChatBridgeManualSmokeTrace).toHaveBeenCalled()
      expect(mocks.switchCurrentSession).toHaveBeenCalledWith('seeded-session-1')
    })
  })

  it('shows the active trace and records the smoke outcome from the lab card', async () => {
    render(
      <MantineProvider>
        <ChatBridgeSeedLab />
      </MantineProvider>
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Reseed & Open' })[0])

    await waitFor(() => {
      expect(screen.getAllByText(/manual-run-1/i).length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mark Passed' }))

    await waitFor(() => {
      expect(mocks.finishChatBridgeManualSmokeTrace).toHaveBeenCalledWith('manual-run-1', 'passed')
    })
  })
})
