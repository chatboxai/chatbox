// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { Message, Session } from '@shared/types'
import { MessageRoleEnum } from '@shared/types'
import { getDefaultStore } from 'jotai'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@/test-utils'
import { currentSessionIdAtom, showThreadHistoryDrawerAtom } from '@/stores/atoms'
import ThreadHistoryDrawer from './ThreadHistoryDrawer'

const actionMenuItemsLog = vi.hoisted(() => [] as Array<Array<{ text?: string; divider?: boolean }>>)
const scrollToIndexMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@mui/material/SwipeableDrawer', () => ({
  default: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid="swipeable-drawer">{children}</div> : null,
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

vi.mock('@/stores/scrollActions', () => ({
  scrollToIndex: scrollToIndexMock,
}))

vi.mock('@/stores/settingsStore', () => ({
  useLanguage: () => 'en',
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

function message(id: string, role: Message['role']): Message {
  return {
    id,
    role,
    contentParts: [],
    timestamp: 1,
  }
}

describe('ThreadHistoryDrawer in work mode', () => {
  beforeEach(() => {
    actionMenuItemsLog.length = 0
    scrollToIndexMock.mockClear()
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
    store.set(showThreadHistoryDrawerAtom, true)
  })

  test('keeps stored threads navigable without switch or delete actions', () => {
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      threadName: 'Current Thread',
      settings: { agentMode: { value: 'on', locked: true, lockReason: null } },
      threads: [
        {
          id: 'archived-thread',
          name: 'Archived Thread',
          createdAt: 1,
          messages: [message('archived-user', MessageRoleEnum.User)],
        },
      ],
      messages: [message('current-user', MessageRoleEnum.User)],
    }

    const { getByTestId, getByText } = render(
      <MantineProvider>
        <ThreadHistoryDrawer session={session} />
      </MantineProvider>
    )

    expect(getByTestId('swipeable-drawer').textContent).toContain('Archived Thread')
    expect(getByTestId('swipeable-drawer').textContent).toContain('Current Thread')
    fireEvent.click(getByText(/Archived Thread/))
    expect(scrollToIndexMock).toHaveBeenCalledWith(0, 'start', 'smooth')
    const threadActions = actionMenuItemsLog.flat().flatMap((item) => (item.text ? [item.text] : []))
    expect(threadActions).toContain('Edit Thread Name')
    expect(threadActions).not.toContain('Switch')
    expect(threadActions).not.toContain('Delete')
  })
})
