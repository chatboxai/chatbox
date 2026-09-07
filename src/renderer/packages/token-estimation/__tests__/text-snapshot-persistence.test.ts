import {
  RowBackedSessionRepository,
  SessionEventBus,
  SessionService,
  SessionWriteCoordinator,
} from '@chatbox/core/application/session'
import { InMemorySessionRecordStore, InMemorySessionRepository, InMemorySessionRowStore } from '@chatbox/core/testing'
import type { Message, Session } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeContextTokens } from '../analyzer'
import { ComputationQueue, computationQueue, generateTaskId } from '../computation-queue'
import { getTokenizationTextDigest } from '../draft-tokenization'
import { _resetExactTokenizationFallbacks, getExactTokenizationFallbackCount } from '../exact-retry'
import { ResultPersister } from '../result-persister'
import { executeTask } from '../task-executor'
import type { ComputationTask, TaskResult } from '../types'

const { readMessages, patchDerived, tokenizeWorker } = vi.hoisted(() => ({
  readMessages: vi.fn(),
  patchDerived: vi.fn(),
  tokenizeWorker: vi.fn(),
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { readSessionMessages: readMessages, patchSessionMessageDerivedData: patchDerived },
  },
}))
vi.mock('../draft-tokenizer-worker-client', () => ({ tokenizeDraftOffMainThread: tokenizeWorker }))

function requireResult(result: TaskResult): NonNullable<TaskResult['result']> {
  expect(result.success).toBe(true)
  if (!result.result) throw new Error('Expected a token result')
  return result.result
}

async function readMessage(repository: RowBackedSessionRepository): Promise<Message> {
  const source = await repository.readSessionMessages({ sessionId: 's', messageIds: ['m'] })
  const message = source?.messages[0]
  if (!message) throw new Error('Expected the stored message')
  return message
}

function analyzeTask(message: Message): ComputationTask {
  const { pendingTasks } = analyzeContextTokens({
    contextMessages: [message],
    tokenizerType: 'default',
    modelSupportToolUseForFile: false,
  })
  expect(pendingTasks).toHaveLength(1)
  const task = { ...pendingTasks[0], sessionId: 's' }
  return { ...task, id: generateTaskId(task), createdAt: Date.now() }
}

async function setup(text = 'hello') {
  const records = new InMemorySessionRecordStore()
  const rows = new InMemorySessionRowStore()
  const repository = Object.assign(new RowBackedSessionRepository({ rows, records }), {
    meta: new InMemorySessionRepository().meta,
  })
  const message: Message = {
    id: 'm',
    role: 'assistant',
    contentParts: [{ type: 'text', text }],
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 80 },
    tokenCount: 20,
    tokensUsed: 120,
  }
  const session: Session = { id: 's', type: 'chat', name: 'test', messages: [message] }
  await repository.setSession(session)
  const service = new SessionService(repository, new SessionWriteCoordinator(repository), new SessionEventBus(), {
    createId: () => 'new',
  })
  readMessages.mockImplementation(service.readSessionMessages.bind(service))
  patchDerived.mockImplementation(service.patchSessionMessageDerivedData.bind(service))
  const source = await service.getSessionContextSource({ sessionId: 's' })
  if (!source) throw new Error('Expected a context source')
  const task = analyzeTask(source.candidateMessages[0])
  return { repository, rows, records, service, message, task }
}

describe('analyzed text snapshots and durable derived patches', () => {
  let persister: ResultPersister
  beforeEach(() => {
    vi.resetAllMocks()
    computationQueue._reset()
    _resetExactTokenizationFallbacks()
    persister = new ResultPersister()
  })
  afterEach(() => {
    persister.cancel()
    computationQueue._reset()
    _resetExactTokenizationFallbacks()
    vi.useRealTimers()
  })

  it('preserves the current result when an older snapshot finishes later in the same flush window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)
    const oldText = 'old context word '.repeat(400)
    const currentText = 'current context word '.repeat(400)
    const oldDigest = getTokenizationTextDigest(oldText)
    const currentDigest = getTokenizationTextDigest(currentText)
    const h = await setup(oldText)
    persister.addResult({
      type: 'message-text',
      sessionId: 's',
      messageId: 'primer',
      tokenizerType: 'default',
      tokens: 1,
      textDigest: getTokenizationTextDigest('primer'),
      calculatedAt: 5000,
    })
    await persister.flushNow()
    patchDerived.mockClear()
    tokenizeWorker.mockImplementation((text: string) => {
      if (text === oldText) return Promise.reject(new Error('old snapshot worker unavailable'))
      expect(text).toBe(currentText)
      return Promise.resolve(777)
    })
    const queue = new ComputationQueue()
    let release: () => void = () => {}
    const blocker = new Promise<void>((resolve) => {
      release = resolve
    })
    const order: string[] = []
    queue.setExecutor(async (task) => {
      if (task.messageId === 'blocker') {
        await blocker
        return { success: true }
      }
      vi.setSystemTime(Date.now() + 1)
      const result = requireResult(await executeTask(task))
      order.push(result.textDigest ?? '')
      persister.addResult(result)
      return { success: true, result }
    })
    try {
      queue.enqueue({ ...h.task, messageId: 'blocker', priority: 0 })
      queue.enqueue({ ...h.task, priority: 100 })
      await h.service.updateMessage('s', 'm', { contentParts: [{ type: 'text', text: currentText }] })
      const current = analyzeTask(await readMessage(h.repository))
      queue.retainOnlyMessages('s', new Set(['m']))
      queue.enqueue({ ...current, priority: 10 })
      release()
      await vi.advanceTimersByTimeAsync(20)
      expect(order).toEqual([currentDigest, oldDigest])
      expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
      expect(queue._getState().completed.has(current.id)).toBe(true)
      expect(queue._getState().completed.has(h.task.id)).toBe(true)
      expect(patchDerived).not.toHaveBeenCalled()
      await persister.flushNow()
      const saved = await readMessage(h.repository)
      expect(saved.tokenCountMap?.default).toBe(777)
      expect(saved.tokenCountApproximate?.default).toBeUndefined()
      expect(saved).toMatchObject({ usage: h.message.usage, tokenCount: 20, tokensUsed: 120 })
      const submitted = patchDerived.mock.calls[0][1][0].text
      expect(submitted).toHaveLength(2)
      expect(submitted[1].calculatedAt).toBeGreaterThan(submitted[0].calculatedAt)
      const accepted = await patchDerived.mock.results[0].value
      expect(accepted.patches[0].text).toEqual([expect.objectContaining({ sourceDigest: currentDigest, tokens: 777 })])
      expect(getExactTokenizationFallbackCount('m', 'default', oldDigest)).toBe(0)
      expect(readMessages).not.toHaveBeenCalled()
    } finally {
      release()
      queue._reset()
    }
  })

  it('persists only derived fields and leaves provider usage intact', async () => {
    const h = await setup()
    const fullRead = vi.spyOn(h.repository, 'getSession')
    const result = await executeTask(h.task)
    expect(result.success).toBe(true)
    expect(result.result).not.toHaveProperty('textSnapshot')
    expect(readMessages).not.toHaveBeenCalled()
    persister.addResult(requireResult(result))
    await persister.flushNow()
    expect(fullRead).not.toHaveBeenCalled()
    const saved = (await h.repository.readSessionMessages({ sessionId: 's', messageIds: ['m'] }))?.messages[0]
    expect(saved).toMatchObject({
      usage: h.message.usage,
      tokenCount: 20,
      tokensUsed: 120,
      tokenCountMap: { default: result.result?.tokens },
    })
    expect(saved).not.toHaveProperty('textSnapshot')
    expect(patchDerived.mock.calls[0][1]).toEqual([
      {
        messageId: 'm',
        text: [
          {
            tokenizerType: 'default',
            sourceDigest: h.task.textDigest,
            tokens: result.result?.tokens,
            calculatedAt: result.result?.calculatedAt,
            approximate: false,
          },
        ],
      },
    ])
  })

  it('rejects a queued snapshot after the message is edited even though calculation is newer', async () => {
    const h = await setup()
    await h.service.updateMessage('s', 'm', { contentParts: [{ type: 'text', text: 'edited' }] })
    const result = await executeTask(h.task)
    expect(result.success).toBe(true)
    expect(result.result?.textDigest).toBe(getTokenizationTextDigest('hello'))
    expect(readMessages).not.toHaveBeenCalled()
    persister.addResult(requireResult(result))
    await persister.flushNow()
    expect((await patchDerived.mock.results[0].value).patches).toEqual([])
    const saved = (await h.repository.readSessionMessages({ sessionId: 's', messageIds: ['m'] }))?.messages[0]
    expect(saved).toMatchObject({ contentParts: [{ type: 'text', text: 'edited' }], usage: h.message.usage })
    expect(saved?.tokenCountMap).toBeUndefined()
  })

  it.each(['message', 'session'])('does not recreate a deleted %s from a late snapshot result', async (target) => {
    const h = await setup()
    if (target === 'message') await h.service.removeMessage('s', 'm')
    else await h.service.deleteSession('s')
    const result = await executeTask(h.task)
    expect(result.success).toBe(true)
    expect(readMessages).not.toHaveBeenCalled()
    persister.addResult(requireResult(result))
    await persister.flushNow()
    if (target === 'message') {
      expect((await h.repository.getSession('s'))?.messages).toEqual([])
      expect((await patchDerived.mock.results[0].value).patches).toEqual([])
    } else {
      expect(await h.repository.getSession('s')).toBeNull()
      expect(h.rows.snapshot()).toEqual([])
      expect(h.records.snapshot()).toEqual([])
    }
  })

  it('retries accepted worker fallbacks with the same exact snapshot and a new task identity', async () => {
    const text = 'context word '.repeat(400)
    const textDigest = getTokenizationTextDigest(text)
    const h = await setup(text)
    tokenizeWorker.mockRejectedValueOnce(new Error('worker unavailable')).mockResolvedValueOnce(1234)
    const approximate = await executeTask(h.task)
    expect(approximate.result?.approximate).toBe(true)
    persister.addResult(requireResult(approximate))
    await persister.flushNow()
    expect(getExactTokenizationFallbackCount('m', 'default', textDigest)).toBe(1)
    const saved = await readMessage(h.repository)
    const retry = analyzeTask(saved)
    expect(retry).toMatchObject({ textSnapshot: text, textDigest: h.task.textDigest, retryAttempt: 1 })
    expect(retry.id).not.toBe(h.task.id)
    const exact = await executeTask(retry)
    expect(exact.result).toMatchObject({ tokens: 1234, approximate: false })
    persister.addResult(requireResult(exact))
    await persister.flushNow()
    expect(getExactTokenizationFallbackCount('m', 'default', textDigest)).toBe(0)
    expect(readMessages).not.toHaveBeenCalled()
    expect((await h.repository.readSessionMessages({ sessionId: 's', messageIds: ['m'] }))?.messages[0]).toMatchObject({
      usage: h.message.usage,
      tokenCount: 20,
      tokensUsed: 120,
      tokenCountMap: { default: 1234 },
    })
  })
})
