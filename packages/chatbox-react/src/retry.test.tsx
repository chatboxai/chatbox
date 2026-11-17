// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRetryCountdown } from './retry'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useRetryCountdown', () => {
  it('updates the remaining seconds and releases its timer on unmount', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const { result, unmount } = renderHook(() =>
      useRetryCountdown({
        type: 'retrying',
        attempt: 2,
        maxAttempts: 4,
        retryAt: 12_000,
      })
    )
    expect(result.current).toEqual({ attempt: 1, maxAttempts: 3, seconds: 2 })
    act(() => vi.advanceTimersByTime(1_000))
    expect(result.current.seconds).toBe(1)
    act(() => vi.advanceTimersByTime(3_000))
    expect(result.current.seconds).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts and stops the countdown when the retry deadline changes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const { result, rerender } = renderHook(
      ({ retryAt }: { retryAt?: number }) =>
        useRetryCountdown({
          type: 'retrying',
          attempt: 1,
          maxAttempts: 1,
          retryAt,
        }),
      { initialProps: { retryAt: undefined } as { retryAt?: number } }
    )
    expect(vi.getTimerCount()).toBe(0)
    expect(result.current).toEqual({ attempt: 1, maxAttempts: 1, seconds: 1 })
    rerender({ retryAt: 15_000 })
    expect(result.current.seconds).toBe(5)
    expect(vi.getTimerCount()).toBe(1)
    rerender({ retryAt: undefined })
    expect(vi.getTimerCount()).toBe(0)
  })
})
