// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import useShortcut from './useShortcut'

const mocks = vi.hoisted(() => ({
  startNewThread: vi.fn(() => Promise.resolve()),
  focusMessageInput: vi.fn(),
  windowFocusedHandler: undefined as (() => void) | undefined,
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
    type: 'desktop',
    isDesktopLike: false,
    onWindowFocused: (handler: () => void) => {
      mocks.windowFocusedHandler = handler
      return vi.fn()
    },
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
  messageInputID: 'message-input',
  focusMessageInput: mocks.focusMessageInput,
}))

vi.mock('./useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

describe('useShortcut', () => {
  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    mocks.windowFocusedHandler = undefined
  })

  test('handles keyboard shortcuts through the settings projection', () => {
    const { unmount } = renderHook(() => useShortcut())

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, shiftKey: true }))
    })

    expect(mocks.startNewThread).toHaveBeenCalledWith('session-1')
    unmount()
  })

  describe('auto-focus on window focus', () => {
    test('focuses the composer when nothing else owns focus', () => {
      const { unmount } = renderHook(() => useShortcut())

      act(() => mocks.windowFocusedHandler?.())

      expect(mocks.focusMessageInput).toHaveBeenCalledTimes(1)
      unmount()
    })

    test('leaves focus in an open dialog', () => {
      document.body.innerHTML = '<div role="dialog"><textarea id="edit-message"></textarea></div>'
      const { unmount } = renderHook(() => useShortcut())

      act(() => mocks.windowFocusedHandler?.())

      expect(mocks.focusMessageInput).not.toHaveBeenCalled()
      unmount()
    })

    test('leaves focus in another editable control', () => {
      document.body.innerHTML = '<input id="thread-name" />'
      document.getElementById('thread-name')?.focus()
      const { unmount } = renderHook(() => useShortcut())

      act(() => mocks.windowFocusedHandler?.())

      expect(document.activeElement?.id).toBe('thread-name')
      expect(mocks.focusMessageInput).not.toHaveBeenCalled()
      unmount()
    })

    test('still focuses the composer when the composer itself had focus', () => {
      document.body.innerHTML = '<textarea id="message-input"></textarea>'
      document.getElementById('message-input')?.focus()
      const { unmount } = renderHook(() => useShortcut())

      act(() => mocks.windowFocusedHandler?.())

      expect(mocks.focusMessageInput).toHaveBeenCalledTimes(1)
      unmount()
    })
  })
})
