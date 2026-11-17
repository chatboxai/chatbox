// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { SessionHeader } from '@shared/types'
import { getDefaultStore } from 'jotai'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { currentSessionIdAtom } from '@/stores/atoms'
import { fireEvent, render } from '@/test-utils'
import ThreadHistoryList from './ThreadHistoryList'

const actionMenuItemsLog = vi.hoisted(() => [] as Array<Array<{ text?: string; divider?: boolean }>>)
const viewThreadMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionHooks: {
      useSessionThreads: () => ({
        threads: [
          {
            threadId: 'archived-thread',
            name: 'Archived Thread',
            rootMessageId: 'archived-user',
            createdAt: 1,
            summary: { messageCount: 1 },
          },
          {
            threadId: 'current-thread',
            name: 'Current Thread',
            rootMessageId: 'current-user',
            createdAt: 2,
            summary: { messageCount: 1 },
          },
        ],
        isLoading: false,
        isError: false,
        hasNextPage: false,
      }),
    },
  },
}))
vi.mock('@/stores/uiStore', () => ({
  uiStore: { getState: () => ({ transcriptNavigation: { sessionId: 'session-1', viewThread: viewThreadMock } }) },
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

vi.mock('@/stores/session/agent-mode', () => ({
  useSessionAgentMode: () => ({ value: 'on', locked: true, lockReason: null }),
}))

vi.mock('@/stores/session/threads', () => ({
  removeCurrentThread: vi.fn(),
  removeThread: vi.fn(),
  switchThread: vi.fn(),
}))

vi.mock('../ActionMenu', () => ({
  default: ({ children, items }: { children: ReactNode; items: Array<{ text?: string; divider?: boolean }> }) => {
    actionMenuItemsLog.push(items)
    return <>{children}</>
  },
}))

vi.mock('../common/ScalableIcon', () => ({
  ScalableIcon: () => null,
}))

describe('ThreadHistoryList in work mode', () => {
  beforeEach(() => {
    actionMenuItemsLog.length = 0
    viewThreadMock.mockClear()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const store = getDefaultStore()
    store.set(currentSessionIdAtom, 'session-1')
  })

  test('keeps stored threads navigable without switch or delete actions', () => {
    const session: SessionHeader = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      settings: { agentMode: { value: 'on', locked: true, lockReason: null } },
    }

    const { getByTestId, getByText } = render(
      <MantineProvider>
        <ThreadHistoryList session={session} />
      </MantineProvider>
    )

    expect(getByTestId('session-thread-history-list').textContent).toContain('Archived Thread')
    expect(getByTestId('session-thread-history-list').textContent).toContain('Current Thread')
    fireEvent.click(getByText(/Archived Thread/))
    expect(viewThreadMock).toHaveBeenCalledWith('archived-thread')
    const threadActions = actionMenuItemsLog.flat().flatMap((item) => (item.text ? [item.text] : []))
    expect(threadActions).toContain('Edit Thread Name')
    expect(threadActions).not.toContain('Switch')
    expect(threadActions).not.toContain('Delete')
  })
})
