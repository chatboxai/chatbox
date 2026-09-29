// @vitest-environment jsdom
import { IDLE_SESSION_LOCK_STATE, SessionActionBlockedError } from '@chatbox/core/session/action-gates'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generate: vi.fn(), notice: vi.fn(), toast: vi.fn() }))
vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  return { rendererApplication: { generationRuntime: new GenerationRuntimeStore() } }
})
vi.mock('@/stores/session/generation', () => ({ generateMore: mocks.generate }))
vi.mock('@/utils/session-lock-copy', () => ({ notifySessionLockBlocked: mocks.notice }))
vi.mock('@/stores/toastActions', () => ({ add: mocks.toast }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { rendererApplication } from '@/app/renderer-application'
import { useReplyBelowAction } from './useReplyBelowAction'

const runtime = rendererApplication.generationRuntime

afterEach(() => {
  cleanup()
  runtime.dispose()
  vi.resetAllMocks()
})

describe('Reply Below action feedback', () => {
  it('disables while a stop gate is held and reenables after release', () => {
    const { result } = renderHook(() => useReplyBelowAction('session', 'prompt', false, IDLE_SESSION_LOCK_STATE))
    expect(result.current.gate.allowed).toBe(true)
    let gate: ReturnType<typeof runtime.beginSessionStop> | undefined
    act(() => {
      gate = runtime.beginSessionStop('session')
    })
    expect(result.current.gate).toMatchObject({ allowed: false, reason: 'generating' })
    act(() => {
      runtime.clearSessionStop('session', gate)
    })
    expect(result.current.gate.allowed).toBe(true)
  })

  it('rechecks a gate opened since the rendered callback and shows a notice', async () => {
    const { result } = renderHook(() => useReplyBelowAction('session', 'prompt', false, IDLE_SESSION_LOCK_STATE))
    const click = result.current.run
    await act(async () => {
      runtime.beginSessionStop('session')
      await click()
    })
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.notice).toHaveBeenCalledWith('generating', expect.any(Function))
  })

  it.each([new SessionActionBlockedError('reply-below', 'generating'), new Error('Storage unavailable')])(
    'consumes command rejection and provides feedback for %s',
    async (error) => {
      mocks.generate.mockRejectedValueOnce(error)
      const { result } = renderHook(() => useReplyBelowAction('session', 'prompt', false, IDLE_SESSION_LOCK_STATE))
      await act(async () => {
        await expect(result.current.run()).resolves.toBeUndefined()
      })
      if (error instanceof SessionActionBlockedError)
        expect(mocks.notice).toHaveBeenCalledWith('generating', expect.any(Function))
      else expect(mocks.toast).toHaveBeenCalledWith('Storage unavailable', 2500)
    }
  )
})
