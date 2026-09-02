import type { Message, Session } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, submitMock, insertMessageMock, generateMock } = vi.hoisted(() => {
  // The queue persists itself to localStorage, which node's test env lacks.
  const backing = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: () => null,
    get length() {
      return backing.size
    },
  } as Storage
  return {
    getSessionMock: vi.fn(),
    submitMock: vi.fn(),
    insertMessageMock: vi.fn(),
    generateMock: vi.fn(),
  }
})

vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      sessionQueryBridge: { getSession: getSessionMock },
    },
  }
})
vi.mock('@/stores/session/messages', () => ({
  submitNewUserMessageUnlocked: submitMock,
  insertMessage: insertMessageMock,
  modifyMessage: vi.fn(() => Promise.resolve()),
  attachLargeFileRagMetadata: vi.fn((_sessionId: string, message: Message) => Promise.resolve(message)),
}))
vi.mock('@/stores/session/generation', () => ({ _generateWithoutSessionLock: generateMock }))
vi.mock('@/lib/utils', () => ({
  getLogger: () => ({ error: vi.fn() }),
}))

import { resetSessionGenerationLocksForTests } from '@chatbox/core/generation'
import { rendererApplication } from '@/app/renderer-application'
import {
  clearPendingQueuedMessages,
  clearQueue,
  enqueueUserMessage,
  flushMessageQueueForTests,
  isSteerableQueuedMessage,
  MAX_QUEUED_MESSAGES,
  messageQueueStore,
  releaseInFlightQueuedMessage,
  removeQueuedMessage,
  requestSteerQueuedMessage,
  resetMessageQueueForTests,
  resumeQueueAndDrain,
  takeRequestedSteerableMessage,
  updateQueuedMessageText,
  wakeQueuedUserMessages,
} from './message-queue'

const generationRuntimeStore = rendererApplication.generationRuntime

function userMessage(id: string, text = `text-${id}`): Message {
  return { id, role: 'user', contentParts: [{ type: 'text', text }] }
}

function createSession(): Session {
  return {
    id: 'session-1',
    name: 'Session',
    messages: [
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', contentParts: [{ type: 'text', text: 'hello' }], finishReason: 'stop' },
    ],
  }
}

function getQueueIds(sessionId = 'session-1'): string[] {
  return (messageQueueStore.getState().queues[sessionId] ?? []).map((item) => item.id)
}

describe('message queue', () => {
  let currentSession: Session

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetMessageQueueForTests()
    resetSessionGenerationLocksForTests()
    generationRuntimeStore.clear('session-1')
    currentSession = createSession()
    getSessionMock.mockImplementation(() => Promise.resolve(currentSession))
    submitMock.mockImplementation((_sessionId: string, params: { newUserMsg: Message }) => {
      currentSession.messages.push(params.newUserMsg)
      currentSession.messages.push({
        id: `reply-${params.newUserMsg.id}`,
        role: 'assistant',
        contentParts: [{ type: 'text', text: 'ok' }],
        finishReason: 'stop',
      })
      return Promise.resolve()
    })
    insertMessageMock.mockImplementation((_sessionId: string, message: Message) => {
      currentSession.messages.push(message)
      return Promise.resolve()
    })
    generateMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetMessageQueueForTests()
    resetSessionGenerationLocksForTests()
    generationRuntimeStore.clear('session-1')
    vi.useRealTimers()
  })

  it('delivers queued messages in order once the session is idle', async () => {
    enqueueUserMessage('session-1', userMessage('m1'))
    enqueueUserMessage('session-1', userMessage('m2'))
    await flushMessageQueueForTests()

    expect(submitMock).toHaveBeenCalledTimes(2)
    expect(submitMock.mock.calls.map(([, params]) => params.newUserMsg.id)).toEqual(['m1', 'm2'])
    expect(getQueueIds()).toEqual([])
  })

  it('defers while a cancellable generating assistant message exists', async () => {
    generationRuntimeStore.start('session-1', 'active')
    currentSession.messages.push({
      id: 'active',
      role: 'assistant',
      contentParts: [],
      generating: true,
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()
    expect(submitMock).not.toHaveBeenCalled()
    expect(getQueueIds()).toEqual(['m1'])

    // The generation completes: the assistant message stays in the conversation.
    currentSession = {
      ...currentSession,
      messages: currentSession.messages.map((message) =>
        message.id === 'active'
          ? {
              ...message,
              generating: false,
              finishReason: 'stop',
              contentParts: [{ type: 'text', text: 'done' }],
            }
          : message
      ),
    }
    generationRuntimeStore.clear('session-1', 'active')
    wakeQueuedUserMessages('session-1')
    await vi.runOnlyPendingTimersAsync()
    expect(submitMock).toHaveBeenCalledOnce()
  })

  it('honors a wake that arrives while a deferred drain is still unwinding', async () => {
    generationRuntimeStore.start('session-1', 'active')
    const activeSession: Session = {
      ...currentSession,
      messages: [
        ...currentSession.messages,
        {
          id: 'active',
          role: 'assistant',
          contentParts: [],
          generating: true,
        },
      ],
    }
    currentSession = activeSession
    enqueueUserMessage('session-1', userMessage('m1'), 'active')

    getSessionMock.mockImplementationOnce(() => {
      currentSession = {
        ...activeSession,
        messages: activeSession.messages.map((message) =>
          message.id === 'active' ? { ...message, generating: false, finishReason: 'stop' as const } : message
        ),
      }
      generationRuntimeStore.clear('session-1', 'active')
      wakeQueuedUserMessages('session-1')
      return Promise.resolve(activeSession)
    })

    await flushMessageQueueForTests()
    await vi.runOnlyPendingTimersAsync()

    expect(submitMock).toHaveBeenCalledOnce()
    expect(getQueueIds()).toEqual([])
  })

  it('defers while a tool call is paused waiting for approval', async () => {
    currentSession.messages.push({
      id: 'paused',
      role: 'assistant',
      contentParts: [
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'tool-1',
          toolName: 'user_exec',
          args: {},
          pauseReason: { type: 'user_exec_approval', command: 'ls' },
        },
      ],
      finishReason: 'tool-call-paused',
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()
    expect(submitMock).not.toHaveBeenCalled()
    expect(getQueueIds()).toEqual(['m1'])
  })

  it('pauses the queue when the last assistant reply was canceled, and resumes via Send now', async () => {
    currentSession.messages.push({
      id: 'stopped',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'partial' }],
      finishReason: 'canceled',
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()
    expect(submitMock).not.toHaveBeenCalled()
    expect(messageQueueStore.getState().paused['session-1']).toBe('stopped')

    resumeQueueAndDrain('session-1')
    await vi.runOnlyPendingTimersAsync()
    expect(submitMock).toHaveBeenCalledOnce()
    expect(messageQueueStore.getState().paused['session-1']).toBeUndefined()
  })

  it('pauses the queue when the last assistant reply errored', async () => {
    currentSession.messages.push({
      id: 'failed',
      role: 'assistant',
      contentParts: [],
      errorCode: 500,
      error: 'boom',
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()
    expect(submitMock).not.toHaveBeenCalled()
    expect(messageQueueStore.getState().paused['session-1']).toBe('error')
  })

  it('consumes the force-resume flag only once', async () => {
    currentSession.messages.push({
      id: 'stopped',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'partial' }],
      finishReason: 'canceled',
    })
    // The delivered reply is also canceled, so the second item must pause again.
    submitMock.mockImplementation((_sessionId: string, params: { newUserMsg: Message }) => {
      currentSession.messages.push(params.newUserMsg)
      currentSession.messages.push({
        id: `reply-${params.newUserMsg.id}`,
        role: 'assistant',
        contentParts: [{ type: 'text', text: 'partial' }],
        finishReason: 'canceled',
      })
      return Promise.resolve()
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    enqueueUserMessage('session-1', userMessage('m2'))
    await flushMessageQueueForTests()
    expect(messageQueueStore.getState().paused['session-1']).toBe('stopped')

    resumeQueueAndDrain('session-1')
    await vi.runOnlyPendingTimersAsync()
    expect(submitMock).toHaveBeenCalledOnce()
    expect(getQueueIds()).toEqual(['m2'])
    expect(messageQueueStore.getState().paused['session-1']).toBe('stopped')
  })

  it('marks the item in-flight during delivery so steering cannot double-consume it while it stays durable', async () => {
    const seenDuringSubmit: { queueIds: string[]; headInFlight: boolean | undefined; steered: string | undefined }[] =
      []
    submitMock.mockImplementation((_sessionId: string, params: { newUserMsg: Message }) => {
      const queue = messageQueueStore.getState().queues['session-1'] ?? []
      seenDuringSubmit.push({
        queueIds: queue.map((item) => item.id),
        headInFlight: queue[0]?.inFlight,
        // The delivering item must not be steerable even though it is still queued.
        steered: takeRequestedSteerableMessage('session-1', () => true)?.id,
      })
      currentSession.messages.push(params.newUserMsg)
      currentSession.messages.push({
        id: `reply-${params.newUserMsg.id}`,
        role: 'assistant',
        contentParts: [{ type: 'text', text: 'ok' }],
        finishReason: 'stop',
      })
      return Promise.resolve()
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()

    // During m1's delivery it stays in the (persisted) queue, flagged in-flight,
    // and steering skips it; afterwards it is removed.
    expect(seenDuringSubmit).toEqual([{ queueIds: ['m1'], headInFlight: true, steered: undefined }])
    expect(getQueueIds()).toEqual([])
  })

  it('resumes with a generated reply instead of re-submitting an already persisted message', async () => {
    submitMock.mockImplementationOnce((_sessionId: string, params: { newUserMsg: Message }) => {
      // The user message lands in the session, then the submit fails afterwards
      // (e.g. inserting the assistant placeholder).
      currentSession.messages.push(params.newUserMsg)
      return Promise.reject(new Error('placeholder insert failed'))
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()
    expect(getQueueIds()).toEqual(['m1'])

    await flushMessageQueueForTests()
    expect(submitMock).toHaveBeenCalledTimes(1)
    expect(getQueueIds()).toEqual([])
    // No duplicate of the user message, and the missing reply was resumed.
    expect(currentSession.messages.filter((message) => message.id === 'm1')).toHaveLength(1)
    expect(insertMessageMock).toHaveBeenCalledOnce()
    expect(generateMock).toHaveBeenCalledOnce()
    expect(currentSession.messages.at(-1)?.role).toBe('assistant')
  })

  it('reuses an existing orphaned placeholder when resuming', async () => {
    submitMock.mockImplementationOnce((_sessionId: string, params: { newUserMsg: Message }) => {
      // Both the user message and the assistant placeholder land, then the
      // submit rejects (e.g. the initial streaming persist failed).
      currentSession.messages.push(params.newUserMsg)
      currentSession.messages.push({ id: 'placeholder', role: 'assistant', contentParts: [], generating: true })
      return Promise.reject(new Error('initial persist failed'))
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()
    expect(getQueueIds()).toEqual(['m1'])

    await flushMessageQueueForTests()
    expect(submitMock).toHaveBeenCalledTimes(1)
    expect(getQueueIds()).toEqual([])
    // The existing placeholder is reused: no second insert, generation resumed on it.
    expect(insertMessageMock).not.toHaveBeenCalled()
    expect(generateMock).toHaveBeenCalledOnce()
    expect(generateMock.mock.calls[0][1]).toMatchObject({ id: 'placeholder', generating: true })
  })

  it('clears a stale paused reason when the final queued item is removed', async () => {
    currentSession.messages.push({
      id: 'stopped',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'partial' }],
      finishReason: 'canceled',
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()
    expect(messageQueueStore.getState().paused['session-1']).toBe('stopped')

    removeQueuedMessage('session-1', 'm1')
    expect(getQueueIds()).toEqual([])
    expect(messageQueueStore.getState().paused['session-1']).toBeUndefined()
  })

  it('retries a failed delivery without dropping the message, then parks the queue after repeated failures', async () => {
    submitMock.mockRejectedValue(new Error('temporary failure'))

    enqueueUserMessage('session-1', userMessage('m1'))
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await flushMessageQueueForTests()
    }

    expect(getQueueIds()).toEqual(['m1'])
    expect(messageQueueStore.getState().paused['session-1']).toBe('error')
  })

  it('pauses when the originating conversation was replaced before delivery', async () => {
    generationRuntimeStore.start('session-1', 'active')
    currentSession.messages.push({
      id: 'active',
      role: 'assistant',
      contentParts: [],
      generating: true,
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    // First pass defers on the running generation; the conversation anchor gets stamped.
    await flushMessageQueueForTests()
    expect(submitMock).not.toHaveBeenCalled()

    // A thread switch replaces the conversation entirely.
    currentSession.messages = [{ id: 'fresh-user', role: 'user', contentParts: [{ type: 'text', text: 'new thread' }] }]
    await flushMessageQueueForTests()

    expect(submitMock).not.toHaveBeenCalled()
    expect(messageQueueStore.getState().paused['session-1']).toBe('conversation-changed')
    expect(getQueueIds()).toEqual(['m1'])
  })

  it('pauses when a fork switch left the anchor reachable only through a saved branch', async () => {
    generationRuntimeStore.start('session-1', 'active')
    currentSession.messages.push({
      id: 'active',
      role: 'assistant',
      contentParts: [],
      generating: true,
    })

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()
    expect(submitMock).not.toHaveBeenCalled()

    // A fork switch: the old branch (with the anchor) stays reachable through
    // messageForksHash, but the active linear path no longer contains it.
    const oldBranch = currentSession.messages.slice(1)
    currentSession.messages = [
      currentSession.messages[0],
      {
        id: 'other-fork-reply',
        role: 'assistant',
        contentParts: [{ type: 'text', text: 'other' }],
        finishReason: 'stop',
      },
    ]
    currentSession.messageForksHash = {
      [currentSession.messages[0].id]: {
        position: 0,
        lists: [{ id: 'branch-1', messages: oldBranch }],
        createdAt: Date.now(),
      },
    }
    await flushMessageQueueForTests()

    expect(submitMock).not.toHaveBeenCalled()
    expect(messageQueueStore.getState().paused['session-1']).toBe('conversation-changed')
    expect(getQueueIds()).toEqual(['m1'])
  })

  it('does not discard a partially persisted queued turn after switching forks', async () => {
    submitMock.mockImplementationOnce((_sessionId: string, params: { newUserMsg: Message }) => {
      currentSession = { ...currentSession, messages: [...currentSession.messages, params.newUserMsg] }
      return Promise.reject(new Error('placeholder insert failed'))
    })

    enqueueUserMessage('session-1', userMessage('m1'), 'a1')
    await flushMessageQueueForTests()
    expect(getQueueIds()).toEqual(['m1'])

    const oldBranch = currentSession.messages.slice(1)
    currentSession = {
      ...currentSession,
      messages: [
        currentSession.messages[0],
        { id: 'other-fork-reply', role: 'assistant', contentParts: [{ type: 'text', text: 'other' }] },
      ],
      messageForksHash: {
        [currentSession.messages[0].id]: {
          position: 0,
          lists: [{ id: 'branch-1', messages: oldBranch }],
          createdAt: Date.now(),
        },
      },
    }

    await flushMessageQueueForTests()

    expect(generateMock).not.toHaveBeenCalled()
    expect(messageQueueStore.getState().paused['session-1']).toBe('conversation-changed')
    expect(getQueueIds()).toEqual(['m1'])
  })

  it('restores queued items from persistence after a reload, clearing stale in-flight flags', async () => {
    currentSession.messages.push({
      id: 'active',
      role: 'assistant',
      contentParts: [],
      generating: true,
    })
    enqueueUserMessage('session-1', userMessage('m1'))
    // Simulate a crash mid-delivery: the persisted item carries the in-flight flag.
    messageQueueStore.setState((state) => ({
      queues: {
        ...state.queues,
        'session-1': (state.queues['session-1'] ?? []).map((item) => ({ ...item, inFlight: true })),
      },
    }))

    // Simulate an app restart: a fresh module instance hydrates from localStorage.
    vi.resetModules()
    const fresh = await import('./message-queue')
    const restored = fresh.messageQueueStore.getState().queues['session-1'] ?? []
    expect(restored.map((item) => item.id)).toEqual(['m1'])
    expect(restored[0]?.inFlight).toBeUndefined()
  })

  it('discards the queue when the session no longer exists', async () => {
    getSessionMock.mockResolvedValue(undefined)

    enqueueUserMessage('session-1', userMessage('m1'))
    await flushMessageQueueForTests()
    expect(submitMock).not.toHaveBeenCalled()
    expect(getQueueIds()).toEqual([])
  })

  it('supports removing a single item and clearing the queue', () => {
    currentSession.messages.push({
      id: 'active',
      role: 'assistant',
      contentParts: [],
      generating: true,
    })
    enqueueUserMessage('session-1', userMessage('m1'))
    enqueueUserMessage('session-1', userMessage('m2'))

    removeQueuedMessage('session-1', 'm1')
    expect(getQueueIds()).toEqual(['m2'])

    clearQueue('session-1')
    expect(getQueueIds()).toEqual([])
    expect(messageQueueStore.getState().paused['session-1']).toBeUndefined()
  })

  it('clears pending items without deleting an in-flight durable record', () => {
    currentSession.messages.push({
      id: 'active',
      role: 'assistant',
      contentParts: [],
      generating: true,
    })
    enqueueUserMessage('session-1', userMessage('m1'))
    enqueueUserMessage('session-1', userMessage('m2'))
    messageQueueStore.setState((state) => ({
      queues: {
        ...state.queues,
        'session-1': (state.queues['session-1'] ?? []).map((item) =>
          item.id === 'm1' ? { ...item, inFlight: true } : item
        ),
      },
    }))

    clearPendingQueuedMessages('session-1')

    expect(getQueueIds()).toEqual(['m1'])
    expect(messageQueueStore.getState().queues['session-1']?.[0]?.inFlight).toBe(true)
  })

  it('rejects new items when the queue is full', () => {
    currentSession.messages.push({
      id: 'active',
      role: 'assistant',
      contentParts: [],
      generating: true,
    })
    for (let index = 0; index < MAX_QUEUED_MESSAGES; index += 1) {
      expect(enqueueUserMessage('session-1', userMessage(`m${index}`))).toBe('queued')
    }
    expect(enqueueUserMessage('session-1', userMessage('overflow'))).toBe('full')
    expect(getQueueIds()).toHaveLength(MAX_QUEUED_MESSAGES)
  })

  it('refuses a non-durable enqueue when persistence fails', () => {
    const setItemSpy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    try {
      expect(enqueueUserMessage('session-1', userMessage('m1'))).toBe('persist-failed')
      expect(getQueueIds()).toEqual([])
    } finally {
      setItemSpy.mockRestore()
    }
    // Storage recovered: the same message can be queued normally again.
    expect(enqueueUserMessage('session-1', userMessage('m1'))).toBe('queued')
  })

  describe('manual steering (requestSteerQueuedMessage / takeRequestedSteerableMessage)', () => {
    /** Wait for the async conversation-anchor stamp without firing drain timers. */
    async function flushMicrotasks(): Promise<void> {
      for (let i = 0; i < 5; i += 1) await Promise.resolve()
    }
    const acceptAll = () => true

    it('does not consume items the user has not asked to jump the queue', async () => {
      enqueueUserMessage('session-1', userMessage('m1'))
      await flushMicrotasks()
      expect(takeRequestedSteerableMessage('session-1', acceptAll)).toBeUndefined()
      expect(getQueueIds()).toEqual(['m1'])
    })

    it('claims a requested item as in-flight, removed only after the caller confirms', async () => {
      enqueueUserMessage('session-1', userMessage('m1'))
      enqueueUserMessage('session-1', userMessage('m2'))
      await flushMicrotasks()

      // The user can ask any plain-text item to jump, not only the head.
      expect(requestSteerQueuedMessage('session-1', 'm2')).toBe(true)
      const claimed = takeRequestedSteerableMessage('session-1', acceptAll)
      expect(claimed?.id).toBe('m2')
      // Still queued (crash durability), flagged in-flight, not re-claimable.
      expect(getQueueIds()).toEqual(['m1', 'm2'])
      expect(messageQueueStore.getState().queues['session-1']?.[1]?.inFlight).toBe(true)
      expect(takeRequestedSteerableMessage('session-1', acceptAll)).toBeUndefined()

      removeQueuedMessage('session-1', 'm2')
      expect(getQueueIds()).toEqual(['m1'])
    })

    it('rejects a steer request for items with attachments or while paused', async () => {
      const withFile: Message = { ...userMessage('m1'), files: [{ id: 'f', name: 'f.txt', fileType: 'text/plain' }] }
      enqueueUserMessage('session-1', withFile)
      enqueueUserMessage('session-1', userMessage('m2'))
      await flushMicrotasks()

      expect(isSteerableQueuedMessage(withFile)).toBe(false)
      expect(requestSteerQueuedMessage('session-1', 'm1')).toBe(false)

      messageQueueStore.setState((state) => ({ paused: { ...state.paused, 'session-1': 'stopped' as const } }))
      expect(requestSteerQueuedMessage('session-1', 'm2')).toBe(false)
    })

    it('does not consume a requested item from another conversation or an unstamped item', async () => {
      enqueueUserMessage('session-1', userMessage('m1'))
      requestSteerQueuedMessage('session-1', 'm1')
      // Unstamped yet: the async anchor stamp has not resolved.
      expect(takeRequestedSteerableMessage('session-1', acceptAll)).toBeUndefined()

      await flushMicrotasks()
      // Stamped, but the anchor belongs to another conversation.
      expect(takeRequestedSteerableMessage('session-1', () => false)).toBeUndefined()
      expect(getQueueIds()).toEqual(['m1'])
    })

    it('releaseInFlightQueuedMessage clears both the claim and the steer request', async () => {
      enqueueUserMessage('session-1', userMessage('m1'))
      await flushMicrotasks()
      requestSteerQueuedMessage('session-1', 'm1')
      const claimed = takeRequestedSteerableMessage('session-1', acceptAll)
      expect(claimed?.id).toBe('m1')

      releaseInFlightQueuedMessage('session-1', 'm1')
      expect(getQueueIds()).toEqual(['m1'])
      // The failed jump does not loop: the user must ask again.
      expect(takeRequestedSteerableMessage('session-1', acceptAll)).toBeUndefined()
      requestSteerQueuedMessage('session-1', 'm1')
      expect(takeRequestedSteerableMessage('session-1', acceptAll)?.id).toBe('m1')
    })

    it('updateQueuedMessageText replaces the text and keeps the position', async () => {
      enqueueUserMessage('session-1', userMessage('m1'))
      enqueueUserMessage('session-1', userMessage('m2'))
      updateQueuedMessageText('session-1', 'm1', 'edited text')

      expect(getQueueIds()).toEqual(['m1', 'm2'])
      const first = messageQueueStore.getState().queues['session-1']?.[0]
      expect(first?.message.contentParts).toEqual([{ type: 'text', text: 'edited text' }])
    })

    it('editing a queued item drops the counts computed for its previous text', async () => {
      const seeded: Message = {
        ...userMessage('m1', 'original long draft'),
        tokenCount: 999,
        tokenCountMap: { default: 424242 },
        tokenCalculatedAt: { default: 123 },
        tokenCountApproximate: { default: true },
      }
      enqueueUserMessage('session-1', seeded)
      await flushMicrotasks()

      updateQueuedMessageText('session-1', 'm1', 'edited text')

      // Both consumers read this message object: ordinary delivery inserts it
      // as-is, and a steer claim injects it mid-generation. Stale counts here
      // would be trusted by the send path and the analyzer alike.
      const delivered = messageQueueStore.getState().queues['session-1']?.[0]?.message
      expect(delivered?.tokenCount).toBeUndefined()
      expect(delivered?.tokenCountMap).toBeUndefined()
      expect(delivered?.tokenCalculatedAt).toBeUndefined()
      expect(delivered?.tokenCountApproximate).toBeUndefined()
    })

    it('a steer-claimed item edited in the queue carries no stale counts', async () => {
      const seeded: Message = {
        ...userMessage('m1', 'original long draft'),
        tokenCountMap: { default: 424242 },
      }
      enqueueUserMessage('session-1', seeded)
      await flushMicrotasks()

      updateQueuedMessageText('session-1', 'm1', 'edited text')
      expect(requestSteerQueuedMessage('session-1', 'm1')).toBe(true)

      const claimed = takeRequestedSteerableMessage('session-1', acceptAll)
      expect(claimed?.message.contentParts).toEqual([{ type: 'text', text: 'edited text' }])
      expect(claimed?.message.tokenCountMap).toBeUndefined()
    })

    it('an edit that leaves the text unchanged keeps the carried counts', async () => {
      const seeded: Message = {
        ...userMessage('m1', 'same text'),
        tokenCountMap: { default: 424242 },
      }
      enqueueUserMessage('session-1', seeded)
      await flushMicrotasks()

      updateQueuedMessageText('session-1', 'm1', 'same text')

      expect(messageQueueStore.getState().queues['session-1']?.[0]?.message.tokenCountMap).toEqual({ default: 424242 })
    })
  })
})
