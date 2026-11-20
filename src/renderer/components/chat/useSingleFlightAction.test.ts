// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSingleFlightAction } from './useSingleFlightAction'

afterEach(cleanup)

function deferred() {
  let finish = () => {}
  const action = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  return { action, finish: () => finish() }
}

describe('useSingleFlightAction', () => {
  it('ignores actions while one is running and is pending until it settles', async () => {
    const replyAgain = deferred()
    const { result } = renderHook(() => useSingleFlightAction())

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.run(replyAgain.action)
    })
    expect(result.current.pending).toBe(true)
    await act(() => result.current.run(replyAgain.action))
    expect(replyAgain.action).toHaveBeenCalledTimes(1)

    await act(async () => {
      replyAgain.finish()
      await first
    })
    expect(result.current.pending).toBe(false)

    const next = vi.fn(async () => {})
    await act(() => result.current.run(next))
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('runs only the first of a whole-message and a last-step retry started in the same tick', async () => {
    const wholeMessage = deferred()
    const lastStep = vi.fn(async () => {})
    const { result } = renderHook(() => useSingleFlightAction())

    let first: Promise<void> = Promise.resolve()
    await act(async () => {
      first = result.current.run(wholeMessage.action)
      await result.current.run(lastStep)
    })
    expect(wholeMessage.action).toHaveBeenCalledTimes(1)
    expect(lastStep).not.toHaveBeenCalled()

    await act(async () => {
      wholeMessage.finish()
      await first
    })
    await act(() => result.current.run(lastStep))
    expect(lastStep).toHaveBeenCalledTimes(1)
  })

  it('settles after a failed action so the next one runs', async () => {
    const { result } = renderHook(() => useSingleFlightAction())

    await act(() => expect(result.current.run(() => Promise.reject(new Error('failed')))).rejects.toThrow('failed'))
    expect(result.current.pending).toBe(false)
    const next = vi.fn(async () => {})
    await act(() => result.current.run(next))
    expect(next).toHaveBeenCalledTimes(1)
  })
})
