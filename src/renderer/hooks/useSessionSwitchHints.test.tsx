// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SESSION_SWITCH_HINT_DELAY_MS, useSessionSwitchHintDigits } from './useSessionSwitchHints'

const sessionListMock = vi.fn()

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionHooks: {
      useSessionList: () => sessionListMock(),
    },
  },
}))

// The peek follows the same modifier `useShortcut` binds `mod+1-9` to.
vi.mock('@/packages/navigator', () => ({
  getOS: () => 'Mac',
}))

const MODIFIER_KEY = 'Meta'

function sessionMetaList(count: number) {
  return Array.from({ length: count }, (_value, index) => ({ id: `session-${index}` }))
}

async function holdModifierFor(delayMs: number) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: MODIFIER_KEY }))
    await vi.advanceTimersByTimeAsync(delayMs)
  })
}

async function pressKey(key: string) {
  await act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  })
}

describe('useSessionSwitchHintDigits', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionListMock.mockReturnValue({ sessionMetaList: sessionMetaList(3) })
  })

  afterEach(() => {
    vi.useRealTimers()
    sessionListMock.mockReset()
  })

  test('stays hidden until the modifier has been held for the peek delay', async () => {
    const { result } = renderHook(() => useSessionSwitchHintDigits())
    expect(result.current.size).toBe(0)

    await holdModifierFor(SESSION_SWITCH_HINT_DELAY_MS - 1)
    expect(result.current.size).toBe(0)

    await holdModifierFor(1)
    expect(Array.from(result.current.entries())).toEqual([
      ['session-0', 1],
      ['session-1', 2],
      ['session-2', 3],
    ])
  })

  test('a repeated modifier keydown does not restart the delay', async () => {
    const { result } = renderHook(() => useSessionSwitchHintDigits())

    await holdModifierFor(SESSION_SWITCH_HINT_DELAY_MS - 1)
    await act(async () => {
      // Auto-repeat while the key stays down arrives as another keydown.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: MODIFIER_KEY }))
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.size).toBe(3)
  })

  test.each([
    ['releasing the modifier', () => window.dispatchEvent(new KeyboardEvent('keyup', { key: MODIFIER_KEY }))],
    ['pressing another key', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))],
    ['a window blur', () => window.dispatchEvent(new Event('blur'))],
  ])('%s ends the peek', async (_label, endGesture) => {
    const { result } = renderHook(() => useSessionSwitchHintDigits())

    await holdModifierFor(SESSION_SWITCH_HINT_DELAY_MS)
    expect(result.current.size).toBe(3)

    await act(() => {
      endGesture()
    })
    expect(result.current.size).toBe(0)
  })

  test('releasing the modifier before the delay cancels the peek', async () => {
    const { result } = renderHook(() => useSessionSwitchHintDigits())

    await holdModifierFor(SESSION_SWITCH_HINT_DELAY_MS - 1)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: MODIFIER_KEY }))
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.size).toBe(0)
  })

  test('only the first nine conversations get a digit', async () => {
    sessionListMock.mockReturnValue({ sessionMetaList: sessionMetaList(12) })
    const { result } = renderHook(() => useSessionSwitchHintDigits())

    await holdModifierFor(SESSION_SWITCH_HINT_DELAY_MS)

    expect(result.current.size).toBe(9)
    expect(result.current.get('session-8')).toBe(9)
    expect(result.current.has('session-9')).toBe(false)
  })

  test('a loaded list is required before digits can be offered', async () => {
    sessionListMock.mockReturnValue({ sessionMetaList: undefined })
    const { result } = renderHook(() => useSessionSwitchHintDigits())

    await holdModifierFor(SESSION_SWITCH_HINT_DELAY_MS)
    expect(result.current.size).toBe(0)
  })

  test('unmounting removes the listeners', async () => {
    const { result, unmount } = renderHook(() => useSessionSwitchHintDigits())
    unmount()

    await pressKey(MODIFIER_KEY)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_SWITCH_HINT_DELAY_MS)
    })
    expect(result.current.size).toBe(0)
  })
})
