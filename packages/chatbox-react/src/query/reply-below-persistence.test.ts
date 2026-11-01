import {
  ChatMessageService,
  GenerationRuntimeStore,
  type Session,
  SessionEventBus,
  SessionService,
  SessionWriteCoordinator,
} from '@chatbox/core'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionQueryBridge } from './session-query-bridge'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function harness() {
  const session: Session = {
    id: 'session',
    name: 'Session',
    messages: [
      { id: 'prompt', role: 'user', contentParts: [{ type: 'text', text: 'Question' }] },
      { id: 'other', role: 'assistant', generating: true, contentParts: [{ type: 'text', text: 'checkpoint' }] },
    ],
  }
  const repository = new InMemorySessionRepository()
  await repository.seedSession(session)
  repository.records.set(session.id, { id: session.id, name: session.name, sortOrder: 1, createdAt: 1 })
  const events = new SessionEventBus()
  const sessions = new SessionService(repository, new SessionWriteCoordinator(repository), events, {
    createId: () => 'unused',
    now: () => 1,
  })
  const queryClient = new QueryClient()
  const bridge = new SessionQueryBridge(queryClient, sessions, events)
  await queryClient.fetchQuery(bridge.definitions.header(session.id))
  const otherQuery = bridge.definitions.message(session.id, 'other')
  await queryClient.fetchQuery(otherQuery)
  await bridge.updateMessageCache(session.id, 'other', {
    ...session.messages[1],
    contentParts: [{ type: 'text', text: 'live text' }],
  })
  const runtime = new GenerationRuntimeStore()
  const orchestrate = vi.fn(async () => {})
  const chat = new ChatMessageService({
    sessions,
    runtime,
    generation: { orchestrate },
    createId: () => 'candidate',
    now: () => 1,
  })
  return {
    repository,
    sessions,
    events,
    bridge,
    runtime,
    orchestrate,
    chat,
    candidate: async () =>
      (await repository.readSessionMessages({ sessionId: 'session', messageIds: ['candidate'] }))?.messages[0],
    cachedOther: () =>
      queryClient.getQueryData<Awaited<ReturnType<typeof otherQuery.queryFn>>>(otherQuery.queryKey)?.message,
    dispose() {
      bridge.dispose()
      queryClient.clear()
      runtime.dispose()
    },
  }
}

describe('Reply Below durable row insertion failures', () => {
  it('does not dispatch or publish a candidate when the content transaction fails', async () => {
    const h = await harness()
    const error = new Error('body unavailable')
    const writes = vi.spyOn(h.repository.rowStore, 'applyDiff').mockRejectedValueOnce(error)
    try {
      await expect(h.chat.replyBelow('session', 'prompt')).rejects.toBe(error)
      expect(await h.candidate()).toBeUndefined()
      expect(writes).toHaveBeenCalledOnce()
      expect(h.cachedOther()?.contentParts).toEqual([{ type: 'text', text: 'live text' }])
      expect(h.orchestrate).not.toHaveBeenCalled()
      expect(h.runtime.waitForGenerationPreparationLeases('session')).toBeUndefined()
      expect(h.runtime.list('session')).toHaveLength(0)
    } finally {
      h.dispose()
    }
  })

  it('dispatches a committed candidate when only metadata projection fails', async () => {
    const h = await harness()
    vi.spyOn(h.repository.meta, 'update').mockRejectedValueOnce(new Error('metadata unavailable'))
    const leases: boolean[] = []
    h.events.subscribe((event) => {
      if (event.type === 'session-command-committed')
        leases.push(h.runtime.waitForGenerationPreparationLeases('session') !== undefined)
    })
    try {
      await h.chat.replyBelow('session', 'prompt')
      expect(await h.candidate()).toMatchObject({ generating: true })
      expect(leases).toEqual([true])
      expect(h.orchestrate).toHaveBeenCalledOnce()
      expect(h.cachedOther()?.contentParts).toEqual([{ type: 'text', text: 'live text' }])
      expect(h.runtime.waitForGenerationPreparationLeases('session')).toBeUndefined()
    } finally {
      h.dispose()
    }
  })

  it.each(['deleted', 'stopped'] as const)(
    'preserves a candidate already %s before failed generation cleanup',
    async (state) => {
      const h = await harness()
      const error = new Error('generation unavailable')
      h.orchestrate.mockImplementation(async () => {
        if (state === 'deleted')
          await h.sessions.executeStructureCommand('session', {
            action: 'message-remove',
            messageId: 'candidate',
            replacementPivotId: 'replacement',
          })
        else await h.sessions.updateMessage('session', 'candidate', { generating: false, finishReason: 'canceled' })
        throw error
      })
      try {
        await expect(h.chat.replyBelow('session', 'prompt')).rejects.toBe(error)
        const candidate = await h.candidate()
        if (state === 'deleted') expect(candidate).toBeUndefined()
        else {
          expect(candidate).toMatchObject({ generating: false, finishReason: 'canceled' })
          expect(candidate?.error).toBeUndefined()
        }
        expect(h.runtime.waitForGenerationPreparationLeases('session')).toBeUndefined()
      } finally {
        h.dispose()
      }
    }
  )

  it('settles the latest body in an inactive branch while preserving a newer stop gate', async () => {
    const h = await harness()
    const error = new Error('generation unavailable')
    let stopGate: ReturnType<typeof h.runtime.beginSessionStop> | undefined
    h.orchestrate.mockImplementation(async () => {
      stopGate = h.runtime.beginSessionStop('session')
      await h.sessions.updateMessage('session', 'candidate', {
        contentParts: [{ type: 'text', text: 'latest content' }],
      })
      await h.sessions.executeStructureCommand('session', {
        action: 'fork-create',
        pivotId: 'prompt',
        identity: { seedListId: 'seed', storedListId: 'saved', newListId: 'active', createdAt: 1 },
      })
      throw error
    })
    try {
      await expect(h.chat.replyBelow('session', 'prompt')).rejects.toBe(error)
      expect(await h.candidate()).toMatchObject({
        generating: false,
        error: error.message,
        contentParts: [{ type: 'text', text: 'latest content' }],
      })
      const visible = await h.repository.readSessionTranscriptWindow({
        sessionId: 'session',
        limit: 50,
        origin: 'tail',
      })
      expect(visible?.messages.some((row) => row.messageId === 'candidate')).toBe(false)
      expect(stopGate).toBeDefined()
      expect(h.runtime.isSessionStopRequested('session', stopGate)).toBe(true)
      expect(h.runtime.waitForGenerationPreparationLeases('session')).toBeUndefined()
    } finally {
      h.dispose()
    }
  })

  it.each(['body', 'metadata'] as const)(
    'releases admission when generation and cleanup %s persistence fail',
    async (failure) => {
      const h = await harness()
      const generationError = new Error('generation unavailable')
      const cleanupError = new Error(`cleanup ${failure} unavailable`)
      h.orchestrate.mockImplementation(async () => {
        if (failure === 'body') vi.spyOn(h.repository.rowStore, 'applyDiff').mockRejectedValueOnce(cleanupError)
        else vi.spyOn(h.repository.meta, 'update').mockRejectedValueOnce(cleanupError)
        throw generationError
      })
      try {
        await expect(h.chat.replyBelow('session', 'prompt')).rejects.toBe(
          failure === 'body' ? cleanupError : generationError
        )
        expect((await h.candidate())?.generating).toBe(failure === 'body')
        expect(h.runtime.waitForGenerationPreparationLeases('session')).toBeUndefined()
        expect(h.runtime.list('session')).toHaveLength(0)
        expect(h.orchestrate).toHaveBeenCalledOnce()
      } finally {
        h.dispose()
      }
    }
  )
})
