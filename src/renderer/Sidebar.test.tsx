/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { render } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  trackingEvent: vi.fn(),
  openLink: vi.fn(),
  setShowSidebar: vi.fn(),
  setSidebarWidth: vi.fn(),
  swipeableDrawerProps: vi.fn(),
}))

vi.mock('@mui/material/SwipeableDrawer', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.swipeableDrawerProps(props)
    return <div data-testid="sidebar-drawer">{props.children as React.ReactNode}</div>
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}))

vi.mock('./components/common/Divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('./components/common/ScalableIcon', () => ({
  ScalableIcon: () => <span data-testid="icon" />,
}))

vi.mock('./components/dev/ThemeSwitchButton', () => ({
  default: () => <button type="button">Theme</button>,
}))

vi.mock('./components/session/SessionList', () => ({
  default: () => <div data-testid="session-list" />,
}))

vi.mock('./dev/devToolsConfig', () => ({
  FORCE_ENABLE_DEV_PAGES: false,
}))

vi.mock('./hooks/useNeedRoomForWinControls', () => ({
  default: () => ({
    needRoomForMacWindowControls: false,
  }),
}))

vi.mock('./hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
  useSidebarWidth: () => 280,
}))

vi.mock('./hooks/useVersion', () => ({
  default: () => ({
    version: '1.0.0',
    needCheckUpdate: false,
  }),
}))

vi.mock('./modals/Settings', () => ({
  navigateToSettings: vi.fn(),
}))

vi.mock('./packages/event', () => ({
  trackingEvent: mocks.trackingEvent,
}))

vi.mock('./platform', () => ({
  default: {
    openLink: mocks.openLink,
  },
}))

vi.mock('./stores/settingsStore', () => ({
  useLanguage: () => 'en',
}))

vi.mock('./stores/uiStore', () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      showSidebar: true,
      setShowSidebar: mocks.setShowSidebar,
      setSidebarWidth: mocks.setSidebarWidth,
    }),
}))

vi.mock('./variables', () => ({
  CHATBOX_BUILD_PLATFORM: 'web',
}))

vi.mock('./static/icon.png', () => ({
  default: 'icon.png',
}))

import Sidebar from './Sidebar'

describe('Sidebar drawer modal props', () => {
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

  it('passes focus-trap controls through ModalProps instead of leaking them to the DOM', () => {
    render(
      <MantineProvider>
        <Sidebar />
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
