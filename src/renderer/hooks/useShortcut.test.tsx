// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import useShortcut from './useShortcut'

const mocks = vi.hoisted(() => ({
  startNewThread: vi.fn(() => Promise.resolve()),
}))

vi.mock('jotai', () => ({
  getDefaultStore: () => ({ get: () => null }),
}))

vi.mock('@/modals/settings-navigation', () => ({
  navigateToSettings: vi.fn(),
}))

vi.mock('@/router', () => ({
  router: {
    state: { location: { pathname: '/session/session-1' } },
    navigate: vi.fn(),
  },
}))

vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({ openSearchDialog: false, toggleSessionWebBrowsing: vi.fn() }),
    setState: vi.fn(),
  },
}))

vi.mock('../packages/navigator', () => ({
  getOS: () => 'Mac',
}))

vi.mock('../platform', () => ({
  default: {
    isDesktopLike: false,
    onWindowFocused: vi.fn(),
    onWindowShow: () => vi.fn(),
  },
}))

vi.mock('../stores/atoms', () => ({
  currentSessionIdAtom: {},
}))

vi.mock('../stores/session/crud', () => ({
  switchToIndex: vi.fn(),
  switchToNext: vi.fn(),
}))

vi.mock('../stores/session/threads', () => ({
  startNewThread: mocks.startNewThread,
}))

vi.mock('../stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      shortcuts: {
        messageListRefreshContext: 'mod+shift+n',
        newPictureChat: '',
      },
    }),
  },
}))

vi.mock('./dom', () => ({
  focusMessageInput: vi.fn(),
}))

vi.mock('./useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

describe('useShortcut', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  test('handles keyboard shortcuts through the settings projection', () => {
    const { unmount } = renderHook(() => useShortcut())

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, shiftKey: true }))
    })

    expect(mocks.startNewThread).toHaveBeenCalledWith('session-1')
    unmount()
  })
})
