// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGenerationStop, useMessageGenerationStop } from './useGenerationStop'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('useGenerationStop', () => {
  it('enters stopping immediately and ignores a repeated Stop request', async () => {
    const gate = deferred()
    const stop = vi.fn(() => gate.promise)
    const { result } = renderHook(() => useGenerationStop('session-1', stop))

    act(() => {
      expect(result.current.requestStop()).toBe(true)
      expect(result.current.requestStop()).toBe(true)
    })

    expect(result.current.status).toBe('stopping')
    await waitFor(() => expect(stop).toHaveBeenCalledOnce())
    act(() => gate.resolve())
    await waitFor(() => expect(result.current.status).toBe('idle'))
  })

  it('keeps sending blocked on failure and lets the user retry', async () => {
    const stop = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useGenerationStop('session-1', stop))

    act(() => {
      result.current.requestStop()
    })
    await waitFor(() => expect(result.current.status).toBe('failed'))

    act(() => {
      result.current.requestStop()
    })
    expect(result.current.status).toBe('stopping')
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('keeps an in-flight stop attached to its session while navigating away and back', async () => {
    const gate = deferred()
    const stop = vi.fn(() => gate.promise)
    const { rerender, result } = renderHook(
      ({ sessionId }: { sessionId: string }) => useGenerationStop(sessionId, stop),
      { initialProps: { sessionId: 'session-a' } }
    )

    act(() => {
      result.current.requestStop()
    })
    expect(result.current.status).toBe('stopping')

    rerender({ sessionId: 'session-b' })
    expect(result.current.status).toBe('idle')
    rerender({ sessionId: 'session-a' })
    expect(result.current.status).toBe('stopping')

    act(() => gate.resolve())
    await waitFor(() => expect(result.current.status).toBe('idle'))
  })

  it('does not update an unmounted hook when a pending stop settles', async () => {
    const gate = deferred()
    const stop = vi.fn(() => gate.promise)
    const first = renderHook(() => useGenerationStop('session-unmounted', stop))

    act(() => {
      first.result.current.requestStop()
    })
    first.unmount()
    act(() => gate.resolve())

    const second = renderHook(() => useGenerationStop('session-unmounted', stop))
    await waitFor(() => expect(second.result.current.status).toBe('idle'))
    expect(stop).toHaveBeenCalledOnce()
  })

  it('deduplicates each message Stop and exposes failure for a visible retry', async () => {
    const first = deferred()
    const stop = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useMessageGenerationStop('session-1', 'message-1', stop))

    act(() => {
      expect(result.current.requestStop()).toBe(true)
      expect(result.current.requestStop()).toBe(true)
    })
    expect(result.current.status).toBe('stopping')
    expect(stop).toHaveBeenCalledOnce()

    act(() => first.reject(new Error('storage unavailable')))
    await waitFor(() => expect(result.current.status).toBe('failed'))

    act(() => {
      result.current.requestStop()
    })
    expect(result.current.status).toBe('stopping')
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(stop).toHaveBeenCalledTimes(2)
  })
})
