// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MobileExecutionHost from './MobileExecutionHost'
import { capacitorExecution } from './execution-service'

const native = vi.hoisted(() => ({
  getState: vi.fn<() => Promise<{ isActive: boolean }>>(),
  listener: undefined as ((state: { isActive: boolean }) => void) | undefined,
  remove: vi.fn(),
}))

vi.mock('@capacitor/app', () => ({
  App: {
    getState: native.getState,
    addListener: vi.fn(async (_event: string, listener: (state: { isActive: boolean }) => void) => {
      native.listener = listener
      return { remove: native.remove }
    }),
  },
}))
vi.mock('@shared/mobile-work/generated/worker-source', () => ({ workerSource: '' }))

beforeEach(() => {
  native.getState.mockReset().mockResolvedValue({ isActive: true })
  native.remove.mockReset()
  native.listener = undefined
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

async function mount() {
  let view: ReturnType<typeof render> | undefined
  await act(async () => {
    view = render(<MobileExecutionHost />)
  })
  return view!
}

async function executeSuccessfully() {
  const result = capacitorExecution.execute('console.log(2)', {}, new AbortController().signal)
  await act(async () => {
    await Promise.resolve()
  })
  const job = capacitorExecution.getSnapshot()
  expect(job).not.toBeNull()
  await act(async () => {
    capacitorExecution.receive(job!.id, { stdout: '2', files: {} })
  })
  expect(await result).toEqual({ stdout: '2', files: {} })
}

describe('native execution foreground state', () => {
  it('accepts native foreground while WebView visibility is still hidden', async () => {
    await mount()
    expect(native.getState).toHaveBeenCalledOnce()
    await executeSuccessfully()
  })

  it('stops real background work and accepts retry immediately on native resume', async () => {
    await mount()
    const result = capacitorExecution.execute('while(true){}', {}, new AbortController().signal)
    const rejected = expect(result).rejects.toThrow('WORK_FOREGROUND_REQUIRED')
    await act(async () => {
      await Promise.resolve()
    })
    expect(capacitorExecution.getSnapshot()).not.toBeNull()
    await act(async () => native.listener?.({ isActive: false }))
    await rejected
    expect(capacitorExecution.getSnapshot()).toBeNull()
    await expect(capacitorExecution.execute('1', {}, new AbortController().signal)).rejects.toThrow(
      'WORK_FOREGROUND_REQUIRED'
    )
    await act(async () => native.listener?.({ isActive: true }))
    await executeSuccessfully()
  })

  it('does not interrupt native foreground work on a delayed visibility event', async () => {
    await mount()
    const result = capacitorExecution.execute('console.log(2)', {}, new AbortController().signal)
    await act(async () => {
      await Promise.resolve()
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const job = capacitorExecution.getSnapshot()
    expect(job).not.toBeNull()
    await act(async () => capacitorExecution.receive(job!.id, { stdout: '2', files: {} }))
    expect((await result).stdout).toBe('2')
  })

  it('initializes a mounted background app from the native state', async () => {
    native.getState.mockResolvedValue({ isActive: false })
    await mount()
    await expect(capacitorExecution.execute('1', {}, new AbortController().signal)).rejects.toThrow(
      'WORK_FOREGROUND_REQUIRED'
    )
  })

  it('does not let an older initial state overwrite a received resume event', async () => {
    let resolveState!: (state: { isActive: boolean }) => void
    native.getState.mockReturnValue(
      new Promise((resolve) => {
        resolveState = resolve
      })
    )
    await mount()
    await act(async () => {
      native.listener?.({ isActive: true })
      resolveState({ isActive: false })
    })
    await executeSuccessfully()
  })

  it('ignores native callbacks and initial state that arrive after unmount', async () => {
    let resolveState!: (state: { isActive: boolean }) => void
    native.getState.mockReturnValue(
      new Promise((resolve) => {
        resolveState = resolve
      })
    )
    const view = await mount()
    const lateListener = native.listener
    view.unmount()
    await act(async () => {
      lateListener?.({ isActive: true })
      resolveState({ isActive: true })
    })
    expect(native.remove).toHaveBeenCalledOnce()
    await expect(capacitorExecution.execute('1', {}, new AbortController().signal)).rejects.toThrow(
      'WORK_FOREGROUND_REQUIRED'
    )
  })
})
