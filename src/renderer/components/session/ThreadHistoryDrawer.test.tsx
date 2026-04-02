/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setShowDrawer: vi.fn(),
  swipeableDrawerProps: vi.fn(),
}))

vi.mock('@mui/material/SwipeableDrawer', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.swipeableDrawerProps(props)
    return <div data-testid="thread-history-drawer">{props.children as React.ReactNode}</div>
  },
}))

vi.mock('@ebay/nice-modal-react', () => ({
  default: {
    show: vi.fn(),
  },
}))

vi.mock('jotai', () => ({
  useAtom: () => [true, mocks.setShowDrawer],
  useAtomValue: () => 'session-1',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

vi.mock('@/stores/atoms', () => ({
  currentSessionIdAtom: Symbol('currentSessionIdAtom'),
  showThreadHistoryDrawerAtom: Symbol('showThreadHistoryDrawerAtom'),
}))

vi.mock('@/stores/scrollActions', () => ({
  scrollToIndex: vi.fn(),
}))

vi.mock('@/stores/session/threads', () => ({
  removeCurrentThread: vi.fn(),
  removeThread: vi.fn(),
  switchThread: vi.fn(),
}))

vi.mock('@/stores/sessionHelpers', () => ({
  getAllMessageList: () => [],
  getCurrentThreadHistoryHash: () => ({}),
}))

vi.mock('@/stores/settingsStore', () => ({
  useLanguage: () => 'en',
}))

vi.mock('@/variables', () => ({
  CHATBOX_BUILD_TARGET: 'unknown' as const,
  CHATBOX_BUILD_PLATFORM: 'web' as const,
  CHATBOX_BUILD_CHANNEL: 'unknown' as const,
  USE_LOCAL_API: '',
  USE_BETA_API: '',
  USE_LOCAL_CHATBOX: '',
  USE_BETA_CHATBOX: '',
  NODE_ENV: 'test',
}))

vi.mock('../ActionMenu', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../common/ScalableIcon', () => ({
  ScalableIcon: () => <span data-testid="icon" />,
}))

import ThreadHistoryDrawer from './ThreadHistoryDrawer'

describe('ThreadHistoryDrawer modal props', () => {
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

    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  it('passes focus-trap controls through ModalProps instead of leaking them to the DOM', () => {
    render(
      <MantineProvider>
        <ThreadHistoryDrawer session={{ id: 'session-1' } as never} />
      </MantineProvider>
    )

    const drawerProps = mocks.swipeableDrawerProps.mock.calls[0]?.[0] as {
      disableEnforceFocus?: boolean
      ModalProps?: Record<string, unknown>
    }

    expect(drawerProps.disableEnforceFocus).toBeUndefined()
    expect(drawerProps.ModalProps).toMatchObject({
      keepMounted: true,
      disableEnforceFocus: true,
    })
  })
})
