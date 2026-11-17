import type { Message } from '@shared/types'
import type { SessionService } from '@chatbox/core/application/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ guard: vi.fn(), execute: vi.fn<SessionService['executeStructureCommand']>() }))
vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      sessions: { executeStructureCommand: mocks.execute },
    },
  }
})
vi.mock('./action-guard', () => ({ guardSessionAction: mocks.guard }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'id') }))
import { createSaveAndResendFork, deleteFork, switchForkTo } from './forks'
import { rendererApplication } from '@/app/renderer-application'
const runtime = rendererApplication.generationRuntime
const replacement: Message = { id: 'edited', role: 'user', contentParts: [{ type: 'text', text: 'edited' }] }

beforeEach(() => {
  mocks.guard.mockReset().mockResolvedValue(true)
  mocks.execute.mockReset()
  runtime.abort('session')
})

describe('fork row command effects', () => {
  it('discards exactly the committed branch runtimes, including nested replies', async () => {
    const removed = runtime.start('session', 'removed')
    const nested = runtime.start('session', 'nested')
    const kept = runtime.start('session', 'kept')
    mocks.execute.mockImplementation(async (_id, operation, committed) => {
      expect(operation.activeGenerationMessageIds).toEqual(['removed', 'nested', 'kept'])
      const result = { applied: true, cancelMessageIds: ['removed', 'nested'] }
      committed?.(result)
      return result
    })
    await deleteFork('session', 'pivot')
    expect(removed.abortController.signal).toMatchObject({ aborted: true, reason: 'fork-deleted' })
    expect(nested.abortController.signal.aborted).toBe(true)
    expect(kept.abortController.signal.aborted).toBe(false)
    expect(runtime.get('session', 'kept')).toBe(kept)
  })
  it('keeps runtimes alive when no row commit succeeds', async () => {
    const active = runtime.start('session', 'active')
    mocks.execute.mockRejectedValue(new Error('storage failed'))
    await expect(deleteFork('session', 'pivot')).rejects.toThrow('storage failed')
    expect(active.abortController.signal.aborted).toBe(false)
  })
  it('keeps committed cancellation after a later callback failure', async () => {
    const active = runtime.start('session', 'active')
    mocks.execute.mockImplementation(async (_id, _operation, committed) => {
      committed?.({ applied: true, cancelMessageIds: ['active'] })
      throw new Error('notification failed')
    })
    await expect(deleteFork('session', 'pivot')).rejects.toThrow('notification failed')
    expect(active.abortController.signal.aborted).toBe(true)
  })
  it('switches using stable branch identity', async () => {
    mocks.execute.mockResolvedValue({ applied: true, cancelMessageIds: [] })
    await switchForkTo('session', 'pivot', 'branch-id')
    expect(mocks.execute).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ action: 'fork-switch', target: { branchId: 'branch-id' } }),
      undefined
    )
  })
  it('honors the action gate before submitting a row command', async () => {
    mocks.guard.mockResolvedValue(false)
    await switchForkTo('session', 'pivot', 'branch-id')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('reports a committed Save & Resend after post-commit notification fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.execute.mockImplementation(async (_id, _operation, committed) => {
      committed?.({ applied: true, cancelMessageIds: [] })
      throw new Error('notification failed')
    })
    await expect(createSaveAndResendFork('session', 'original', replacement)).resolves.toBe(true)
    warn.mockRestore()
  })
  it('rejects Save & Resend when persistence fails', async () => {
    mocks.execute.mockRejectedValue(new Error('storage failed'))
    await expect(createSaveAndResendFork('session', 'original', replacement)).rejects.toThrow('storage failed')
  })
  it('reports a missing Save & Resend target without replaying another mutation', async () => {
    mocks.execute.mockResolvedValue({ applied: false, cancelMessageIds: [] })
    await expect(createSaveAndResendFork('session', 'missing', replacement)).resolves.toBe(false)
    expect(mocks.execute).toHaveBeenCalledOnce()
  })
})
