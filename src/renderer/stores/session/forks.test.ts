import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { guardSessionActionMock, updateSessionWithMessagesMock } = vi.hoisted(() => ({
  guardSessionActionMock: vi.fn(() => Promise.resolve(true)),
  updateSessionWithMessagesMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      sessions: { updateSessionWithMessages: updateSessionWithMessagesMock },
    },
  }
})
vi.mock('./action-guard', () => ({ guardSessionAction: guardSessionActionMock }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'id') }))

import { createSaveAndResendFork, deleteFork } from './forks'
import { rendererApplication } from '@/app/renderer-application'

const generationRuntimeStore = rendererApplication.generationRuntime

function message(id: string, role: Message['role'] = 'assistant'): Message {
  return { id, role, contentParts: [], generating: role === 'assistant' }
}

describe('fork runtime cleanup', () => {
  beforeEach(() => {
    guardSessionActionMock.mockClear()
    updateSessionWithMessagesMock.mockReset()
    generationRuntimeStore.abort('session-1')
  })

  it('discards runtimes made unreachable by deleting a branch, including nested fork replies', async () => {
    const pivot = message('pivot', 'user')
    const removedReply = message('removed-reply')
    const nestedPivot = message('nested-pivot', 'user')
    const nestedReply = message('nested-reply')
    const keptReply = message('kept-reply')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [pivot, removedReply, nestedPivot],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'saved', messages: [keptReply] },
          ],
          createdAt: 1,
        },
        [nestedPivot.id]: {
          position: 0,
          lists: [
            { id: 'nested-current', messages: [] },
            { id: 'nested-saved', messages: [nestedReply] },
          ],
          createdAt: 2,
        },
      },
    }
    updateSessionWithMessagesMock.mockImplementation((_sessionId, updater, options) => {
      if (typeof updater !== 'function') throw new Error('Expected updater')
      const updated = updater(session)
      options?.onFullSessionPersisted?.(updated)
      return Promise.resolve(updated)
    })
    const removedRuntime = generationRuntimeStore.start(session.id, removedReply.id)
    const nestedRuntime = generationRuntimeStore.start(session.id, nestedReply.id)
    const keptRuntime = generationRuntimeStore.start(session.id, keptReply.id)

    await deleteFork(session.id, pivot.id)

    expect(removedRuntime.abortController.signal).toMatchObject({ aborted: true, reason: 'fork-deleted' })
    expect(nestedRuntime.abortController.signal).toMatchObject({ aborted: true, reason: 'fork-deleted' })
    expect(keptRuntime.abortController.signal.aborted).toBe(false)
    expect(generationRuntimeStore.get(session.id, keptReply.id)).toBe(keptRuntime)
  })

  it('keeps runtimes alive when the branch update fails to persist', async () => {
    const runtime = generationRuntimeStore.start('session-1', 'reply')
    updateSessionWithMessagesMock.mockRejectedValue(new Error('storage failed'))

    await expect(deleteFork('session-1', 'pivot')).rejects.toThrow('storage failed')

    expect(runtime.abortController.signal.aborted).toBe(false)
    expect(generationRuntimeStore.get('session-1', 'reply')).toBe(runtime)
  })

  it('aborts a runtime that registers after its fork branch was deleted', async () => {
    const pivot = message('pivot', 'user')
    const reply = message('reply')
    const keptReply = message('kept-reply')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [pivot, reply],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'saved', messages: [keptReply] },
          ],
          createdAt: 1,
        },
      },
    }
    updateSessionWithMessagesMock.mockImplementation((_sessionId, updater, options) => {
      if (typeof updater !== 'function') throw new Error('Expected updater')
      const updated = updater(session)
      options?.onFullSessionPersisted?.(updated)
      return Promise.resolve(updated)
    })

    await deleteFork(session.id, pivot.id)
    const lateRuntime = generationRuntimeStore.start(session.id, reply.id)

    expect(lateRuntime.abortController.signal).toMatchObject({ aborted: true, reason: 'fork-deleted' })
  })

  it('discards runtimes when the full Session persisted before metadata failed', async () => {
    const pivot = message('pivot', 'user')
    const reply = message('reply')
    const keptReply = message('kept-reply')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [pivot, reply],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'saved', messages: [keptReply] },
          ],
          createdAt: 1,
        },
      },
    }
    updateSessionWithMessagesMock.mockImplementation((_sessionId, updater, options) => {
      if (typeof updater !== 'function') throw new Error('Expected updater')
      const updated = updater(session)
      options?.onFullSessionPersisted?.(updated)
      return Promise.reject(new Error('metadata failed'))
    })
    const runtime = generationRuntimeStore.start(session.id, reply.id)

    await expect(deleteFork(session.id, pivot.id)).rejects.toThrow('metadata failed')

    expect(runtime.abortController.signal).toMatchObject({ aborted: true, reason: 'fork-deleted' })
    expect(generationRuntimeStore.get(session.id, reply.id)).toBeUndefined()
  })
})

describe('Save & Resend fork write', () => {
  const original: Message = { id: 'user-1', role: 'user', contentParts: [{ type: 'text', text: 'original' }] }
  const replacement: Message = { id: 'user-2', role: 'user', contentParts: [{ type: 'text', text: 'edited' }] }

  function sessionWithPredecessor(): Session {
    return {
      id: 'session-1',
      name: 'Session',
      messages: [message('assistant-0'), original, message('assistant-1')],
    }
  }

  beforeEach(() => {
    updateSessionWithMessagesMock.mockReset()
  })

  it('reports the fork when the full Session persisted before metadata failed', async () => {
    const session = sessionWithPredecessor()
    let persistedSession: Session | undefined
    updateSessionWithMessagesMock.mockImplementation((_sessionId, updater, options) => {
      if (typeof updater !== 'function') throw new Error('Expected updater')
      persistedSession = updater(session)
      options?.onFullSessionPersisted?.(persistedSession)
      return Promise.reject(new Error('metadata failed'))
    })

    await expect(createSaveAndResendFork(session.id, original.id, replacement)).resolves.toBe(true)

    // The branch owns the original id, so the caller must not re-save the edit
    // under it — that would overwrite the archived prompt in place.
    const archived = Object.values(persistedSession?.messageForksHash ?? {}).flatMap((fork) => fork.lists)
    expect(archived.some((list) => list.messages[0]?.id === original.id)).toBe(true)
    expect(persistedSession?.messages.at(-1)).toMatchObject({ id: replacement.id })
  })

  it('rejects when the write fails before anything is persisted', async () => {
    updateSessionWithMessagesMock.mockRejectedValue(new Error('storage failed'))

    await expect(createSaveAndResendFork('session-1', original.id, replacement)).rejects.toThrow('storage failed')
  })
})
