import type { Message } from '@shared/types'
import type { ModelMessage } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }))

vi.mock('@/lib/utils', () => ({
  getLogger: () => ({ error: vi.fn() }),
}))
vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      sessionQueryBridge: { getSession: getSessionMock },
    },
  }
})

import {
  enqueueUserMessage,
  messageQueueStore,
  requestSteerQueuedMessage,
  resetMessageQueueForTests,
} from './message-queue'
import { registerSteeringConsumer, resetSteeringForTests } from './steering'

function userMessage(id: string, text = `text-${id}`): Message {
  return { id, role: 'user', contentParts: [{ type: 'text', text }] }
}

function steeredModelMessage(text: string): ModelMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

const baseMessages: ModelMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: [{ type: 'text', text: 'do the task' }] },
]

// Conversation of the generation under test. Queued items get stamped with the
// mocked session's newest message id ('anchor-live') by the async enqueue stamp.
const conversationIds: ReadonlySet<string> = new Set(['prompt-1', 'anchor-live'])

/** Wait for the async conversation-anchor stamp without firing drain timers. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

async function enqueueStamped(sessionId: string, message: Message): Promise<void> {
  enqueueUserMessage(sessionId, message)
  await flushMicrotasks()
}

/** Enqueue, wait for the anchor stamp, and ask the item to jump the queue. */
async function enqueueRequested(sessionId: string, message: Message): Promise<void> {
  await enqueueStamped(sessionId, message)
  requestSteerQueuedMessage(sessionId, message.id)
}

function register(sessionId = 'session-1', ids: ReadonlySet<string> = conversationIds) {
  return registerSteeringConsumer(sessionId, ids, persistMock)
}

const persistMock = vi.fn<(message: Message, afterMessageId: string) => Promise<void>>()

describe('steering consumer', () => {
  beforeEach(() => {
    // Fake timers keep the queue's own drain from running during these tests.
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetMessageQueueForTests()
    resetSteeringForTests()
    persistMock.mockResolvedValue(undefined)
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      name: 'Session',
      messages: [
        { id: 'prompt-1', role: 'user', contentParts: [{ type: 'text', text: 'do the task' }] },
        { id: 'anchor-live', role: 'assistant', contentParts: [], generating: true },
      ],
    })
  })

  afterEach(() => {
    resetMessageQueueForTests()
    resetSteeringForTests()
    vi.useRealTimers()
  })

  it('release clears steer requests the generation never consumed', async () => {
    const consumer = register()
    await enqueueRequested('session-1', userMessage('m1'))

    consumer?.release()
    const item = messageQueueStore.getState().queues['session-1']?.[0]
    expect(item?.id).toBe('m1')
    expect(item?.steerRequested).toBeUndefined()
  })

  it('is first-wins per session and can be re-registered after release', () => {
    const first = register()
    expect(first).not.toBeNull()
    expect(register()).toBeNull()
    expect(register('session-2')).not.toBeNull()

    first?.release()
    expect(register()).not.toBeNull()
  })

  it('returns unchanged messages when there is nothing to steer', async () => {
    const consumer = register()
    await expect(consumer?.inject(baseMessages, 'a1')).resolves.toEqual({ messages: undefined, consumed: [] })
  })

  it('does not consume queued items by default — only user-requested jumps', async () => {
    await enqueueStamped('session-1', userMessage('m1'))
    const consumer = register()

    const result = await consumer?.inject(baseMessages, 'a1')
    expect(result).toEqual({ messages: undefined, consumed: [] })
    expect(persistMock).not.toHaveBeenCalled()
    expect((messageQueueStore.getState().queues['session-1'] ?? []).map((item) => item.id)).toEqual(['m1'])
  })

  it('persists before injecting and anchors each steered message after the previous one', async () => {
    await enqueueRequested('session-1', userMessage('m1'))
    await enqueueRequested('session-1', userMessage('m2'))
    const consumer = register()

    const result = await consumer?.inject(baseMessages, 'a1')

    expect(persistMock).toHaveBeenCalledTimes(2)
    expect(persistMock.mock.calls[0][0]).toMatchObject({ id: 'm1', generating: false, steered: true })
    expect(persistMock.mock.calls[0][1]).toBe('a1')
    expect(persistMock.mock.calls[1][0]).toMatchObject({ id: 'm2' })
    expect(persistMock.mock.calls[1][1]).toBe('m1')
    expect(result?.messages).toEqual([...baseMessages, steeredModelMessage('text-m1'), steeredModelMessage('text-m2')])
    expect(result?.consumed.map((message) => message.id)).toEqual(['m1', 'm2'])
    expect(messageQueueStore.getState().queues['session-1']).toBeUndefined()
  })

  it('anchors a later boundary at the caller-provided continuation message', async () => {
    const consumer = register()
    if (!consumer) throw new Error('consumer not registered')

    await enqueueRequested('session-1', userMessage('m1'))
    await consumer.inject(baseMessages, 'a1')

    // The generation finalized segment a1, created continuation a2, and passes
    // it as the anchor of the next boundary.
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      name: 'Session',
      messages: [{ id: 'a2', role: 'assistant', contentParts: [], generating: true }],
    })
    consumer.admitAnchor('a2')
    await enqueueRequested('session-1', userMessage('m2'))
    const result = await consumer.inject([...baseMessages], 'a2')

    expect(persistMock).toHaveBeenCalledTimes(2)
    expect(persistMock.mock.calls[1][1]).toBe('a2')
    expect(result.consumed.map((message) => message.id)).toEqual(['m2'])
  })

  it('re-splices earlier records at their original positions as the step messages grow', async () => {
    const consumer = register()
    if (!consumer) throw new Error('consumer not registered')

    // Step 1: consume m1 at the tail of the current context.
    await enqueueRequested('session-1', userMessage('m1'))
    const step1 = await consumer.inject(baseMessages, 'a1')
    expect(step1.messages).toEqual([...baseMessages, steeredModelMessage('text-m1')])

    // Step 2: the SDK appended its own assistant output and tool result to the
    // base (without our override), and a new steering message arrives.
    const sdkAppended: ModelMessage[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'working on it' }] },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 't1', toolName: 'x', output: { type: 'text', value: 'done' } }],
      },
    ]
    const step2Base = [...baseMessages, ...sdkAppended]
    await enqueueRequested('session-1', userMessage('m2'))
    const step2 = await consumer.inject(step2Base, 'a2')
    expect(step2.messages).toEqual([
      ...baseMessages,
      steeredModelMessage('text-m1'),
      ...sdkAppended,
      steeredModelMessage('text-m2'),
    ])

    // Step 3: nothing new to consume; both records stay at their positions.
    const step3Base = [...step2Base, { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'more' }] }]
    const step3 = await consumer.inject(step3Base, 'a3')
    expect(step3.consumed).toEqual([])
    expect(step3.messages).toEqual([
      ...baseMessages,
      steeredModelMessage('text-m1'),
      ...sdkAppended,
      steeredModelMessage('text-m2'),
      { role: 'assistant', content: [{ type: 'text', text: 'more' }] },
    ])
    expect(consumer.getInjectedMessageIds()).toEqual(['m1', 'm2'])
  })

  it('keeps the message queued (at the head) when persistence fails', async () => {
    await enqueueRequested('session-1', userMessage('m1'))
    await enqueueRequested('session-1', userMessage('m2'))
    persistMock.mockRejectedValueOnce(new Error('storage failure'))
    const consumer = register()

    const result = await consumer?.inject(baseMessages, 'a1')

    expect(result).toEqual({ messages: undefined, consumed: [] })
    expect((messageQueueStore.getState().queues['session-1'] ?? []).map((item) => item.id)).toEqual(['m1', 'm2'])
  })

  it('does not steer a head message with attachments', async () => {
    await enqueueStamped('session-1', {
      ...userMessage('m1'),
      files: [{ id: 'f', name: 'f.txt', fileType: 'text/plain' }],
    })
    const consumer = register()

    const result = await consumer?.inject(baseMessages, 'a1')
    expect(result).toEqual({ messages: undefined, consumed: [] })
    expect(persistMock).not.toHaveBeenCalled()
    expect((messageQueueStore.getState().queues['session-1'] ?? []).map((item) => item.id)).toEqual(['m1'])
  })

  it('does not steer a message queued for another conversation (fork switch)', async () => {
    // The user switched forks: the active conversation's newest message is not
    // part of this generation's conversation.
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      name: 'Session',
      messages: [{ id: 'other-fork-tip', role: 'assistant', contentParts: [], generating: true }],
    })
    await enqueueStamped('session-1', userMessage('m1'))
    requestSteerQueuedMessage('session-1', 'm1')
    const consumer = register()

    const result = await consumer?.inject(baseMessages, 'a1')
    expect(result).toEqual({ messages: undefined, consumed: [] })
    expect(persistMock).not.toHaveBeenCalled()
    expect((messageQueueStore.getState().queues['session-1'] ?? []).map((item) => item.id)).toEqual(['m1'])
  })

  it('does not steer an item whose conversation anchor has not been stamped yet', async () => {
    enqueueUserMessage('session-1', userMessage('m1'))
    requestSteerQueuedMessage('session-1', 'm1')
    const consumer = register()

    // Inject synchronously before the async stamp resolves.
    const result = await consumer?.inject(baseMessages, 'a1')
    expect(result).toEqual({ messages: undefined, consumed: [] })
    expect(persistMock).not.toHaveBeenCalled()
    expect((messageQueueStore.getState().queues['session-1'] ?? []).map((item) => item.id)).toEqual(['m1'])
  })

  it('accepts an item anchored to a message it steered earlier in the same generation', async () => {
    const consumer = register()
    if (!consumer) throw new Error('consumer not registered')

    await enqueueRequested('session-1', userMessage('m1'))
    await consumer.inject(baseMessages, 'a1')

    // A follow-up queued while the steered message is the newest conversation message.
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      name: 'Session',
      messages: [{ id: 'm1', role: 'user', contentParts: [{ type: 'text', text: 'text-m1' }] }],
    })
    await enqueueRequested('session-1', userMessage('m2'))
    const result = await consumer.inject([...baseMessages], 'a2')

    expect(persistMock).toHaveBeenCalledTimes(2)
    expect((messageQueueStore.getState().queues['session-1'] ?? []).length).toBe(0)
    expect(result.messages?.at(-1)).toEqual(steeredModelMessage('text-m2'))
  })
})
