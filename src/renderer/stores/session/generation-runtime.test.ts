import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginSessionGeneration,
  cancelAndWaitForSessionGenerations,
  cancelSessionGenerationMessages,
  generationRuntimeStore,
  isSessionGenerating,
  reconcileSessionGenerationRuntime,
  registerSessionGenerationCancel,
  releaseSessionGenerationBlock,
  resetSessionGenerationRuntime,
  settleSessionGeneration,
} from './generation-runtime'

function message(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: 'assistant', contentParts: [], ...overrides }
}

function session(messages: Message[]): Session {
  return { id: 'session-1', name: 'Test', messages }
}

describe('generation runtime', () => {
  beforeEach(() => resetSessionGenerationRuntime())

  it('tracks concurrent generations until all tokens settle', () => {
    beginSessionGeneration('session-1', 'reply-1')
    beginSessionGeneration('session-1', 'reply-2')

    expect(settleSessionGeneration('session-1', 'reply-1')).toBe(true)
    expect(isSessionGenerating(generationRuntimeStore.getState(), 'session-1')).toBe(true)

    expect(settleSessionGeneration('session-1', 'reply-2')).toBe(true)
    expect(isSessionGenerating(generationRuntimeStore.getState(), 'session-1')).toBe(false)
  })

  it('aborts a controller registered after a destructive mutation', () => {
    const cancel = vi.fn()
    beginSessionGeneration('session-1', 'reply-1')

    reconcileSessionGenerationRuntime(session([]))
    registerSessionGenerationCancel('session-1', 'reply-1', cancel)

    expect(cancel).toHaveBeenCalledOnce()
    expect(isSessionGenerating(generationRuntimeStore.getState(), 'session-1')).toBe(false)
  })

  it('cancels generations removed by a whole-session transform', () => {
    const cancel = vi.fn()
    const active = message('reply-1', { generating: true, cancel })
    beginSessionGeneration('session-1', active.id)
    registerSessionGenerationCancel('session-1', active.id, cancel)

    reconcileSessionGenerationRuntime(session([]))

    expect(cancel).toHaveBeenCalledOnce()
    expect(settleSessionGeneration('session-1', active.id)).toBe(false)
  })

  it('treats messages in an unreachable fork as removed', () => {
    const cancel = vi.fn()
    const active = message('fork-reply', { generating: true })
    beginSessionGeneration('session-1', active.id)
    registerSessionGenerationCancel('session-1', active.id, cancel)

    reconcileSessionGenerationRuntime({
      ...session([]),
      messageForksHash: {
        'discarded-pivot': {
          position: 0,
          lists: [{ id: 'discarded-list', messages: [active] }],
          createdAt: 1,
        },
      },
    })

    expect(cancel).toHaveBeenCalledOnce()
    expect(isSessionGenerating(generationRuntimeStore.getState(), 'session-1')).toBe(false)
  })

  it('falls back to a message cancel handler for generations outside this runtime', () => {
    const cancel = vi.fn()

    cancelSessionGenerationMessages('session-1', [message('legacy-reply', { generating: true, cancel })])

    expect(cancel).toHaveBeenCalledOnce()
  })

  it('blocks new generation and waits for canceled work to settle during deletion', async () => {
    const cancel = vi.fn()
    expect(beginSessionGeneration('session-1', 'reply-1')).toBe(true)
    registerSessionGenerationCancel('session-1', 'reply-1', cancel)

    let finished = false
    const waiting = cancelAndWaitForSessionGenerations('session-1').then(() => {
      finished = true
    })
    await Promise.resolve()

    expect(cancel).toHaveBeenCalledOnce()
    expect(finished).toBe(false)
    expect(beginSessionGeneration('session-1', 'reply-2')).toBe(false)

    settleSessionGeneration('session-1', 'reply-1')
    await waiting
    expect(finished).toBe(true)

    releaseSessionGenerationBlock('session-1')
    expect(beginSessionGeneration('session-1', 'reply-2')).toBe(true)
  })

  it('does not inspect session history when no generation is active', () => {
    const idleSession = {
      id: 'session-1',
      name: 'Test',
      get messages(): Message[] {
        throw new Error('messages should not be read')
      },
    } as Session

    expect(() => reconcileSessionGenerationRuntime(idleSession)).not.toThrow()
  })
})
