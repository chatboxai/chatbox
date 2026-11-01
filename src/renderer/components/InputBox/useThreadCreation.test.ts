// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useThreadCreation } from './useThreadCreation'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('useThreadCreation', () => {
  test('waits for successful creation and consumes undo before awaiting it', async () => {
    const creation = deferred<() => Promise<boolean>>()
    const deletion = deferred<boolean>()
    const undo = vi.fn(() => deletion.promise)
    const create = vi.fn(() => creation.promise)
    const { result } = renderHook(() => useThreadCreation({ sessionId: 's', create, onError: vi.fn() }))
    let started!: Promise<void>
    act(() => {
      started = result.current.start()
    })
    expect(result.current.pending).toBe(true)
    expect(result.current.canRollback).toBe(false)
    await act(async () => {
      await result.current.start()
      await result.current.rollback()
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
    await act(async () => {
      creation.resolve(undo)
      await started
    })
    expect(result.current.canRollback).toBe(true)
    let rolledBack!: Promise<void>
    act(() => {
      rolledBack = result.current.rollback()
      void result.current.rollback()
    })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(result.current.canRollback).toBe(false)
    expect(result.current.pending).toBe(true)
    await act(async () => {
      deletion.resolve(true)
      await rolledBack
    })
    expect(result.current.pending).toBe(false)
  })

  test('failed creation reports the error without offering a destructive undo', async () => {
    const error = new Error('write failed')
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useThreadCreation({
        sessionId: 's',
        create: async () => {
          throw error
        },
        onError,
      })
    )
    await act(async () => {
      await result.current.start()
      await result.current.rollback()
    })
    expect(onError).toHaveBeenCalledWith(error)
    expect(result.current.canRollback).toBe(false)
    expect(result.current.pending).toBe(false)
  })

  test('discards undo when navigation occurs during creation', async () => {
    const creation = deferred<() => Promise<boolean>>()
    const undo = vi.fn(async () => true)
    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useThreadCreation({
          sessionId,
          create: () => creation.promise,
          onError: vi.fn(),
        }),
      { initialProps: { sessionId: 'a' } }
    )
    let started!: Promise<void>
    act(() => {
      started = result.current.start()
    })
    rerender({ sessionId: 'b' })
    await act(async () => {
      creation.resolve(undo)
      await started
    })
    expect(result.current.canRollback).toBe(false)
    await act(async () => {
      await result.current.rollback()
    })
    expect(undo).not.toHaveBeenCalled()
  })

  test('dismissing undo on submit prevents a stale callback from deleting messages', async () => {
    const undo = vi.fn(async () => true)
    const { result } = renderHook(() =>
      useThreadCreation({
        sessionId: 's',
        create: async () => undo,
        onError: vi.fn(),
      })
    )
    await act(async () => {
      await result.current.start()
    })
    act(() => {
      result.current.dismissUndo()
    })
    await act(async () => {
      await result.current.rollback()
    })
    expect(undo).not.toHaveBeenCalled()
  })
  test('navigation away and back cannot revive a pending undo', async () => {
    const creation = deferred<() => Promise<boolean>>()
    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useThreadCreation({
          sessionId,
          create: () => creation.promise,
          onError: vi.fn(),
        }),
      { initialProps: { sessionId: 'a' } }
    )
    let started!: Promise<void>
    act(() => {
      started = result.current.start()
    })
    rerender({ sessionId: 'b' })
    rerender({ sessionId: 'a' })
    await act(async () => {
      creation.resolve(async () => true)
      await started
    })
    expect(result.current.canRollback).toBe(false)
  })

  test('submit during creation invalidates the pending undo', async () => {
    const creation = deferred<() => Promise<boolean>>()
    const { result } = renderHook(() =>
      useThreadCreation({
        sessionId: 's',
        create: () => creation.promise,
        onError: vi.fn(),
      })
    )
    let started!: Promise<void>
    act(() => {
      started = result.current.start()
    })
    act(() => {
      result.current.dismissUndo()
    })
    await act(async () => {
      creation.resolve(async () => true)
      await started
    })
    expect(result.current.canRollback).toBe(false)
  })

  test('expired undo cannot be invoked', async () => {
    vi.useFakeTimers()
    try {
      const undo = vi.fn(async () => true)
      const { result, unmount } = renderHook(() =>
        useThreadCreation({
          sessionId: 's',
          create: async () => undo,
          onError: vi.fn(),
        })
      )
      await act(async () => {
        await result.current.start()
      })
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      await act(async () => {
        await result.current.rollback()
      })
      expect(undo).not.toHaveBeenCalled()
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  test('failed undo reports the failure and cannot be retriggered', async () => {
    const error = new Error('write failed')
    const undo = vi.fn(async () => {
      throw error
    })
    const onError = vi.fn()
    const { result } = renderHook(() => useThreadCreation({ sessionId: 's', create: async () => undo, onError }))
    await act(async () => {
      await result.current.start()
    })
    await act(async () => {
      await result.current.rollback()
      await result.current.rollback()
    })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(error)
    expect(result.current.pending).toBe(false)
  })
})
