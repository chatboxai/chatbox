import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computationQueue, generateTaskId } from '../computation-queue'
import { getTokenizationTextDigest } from '../draft-tokenization'
import { executeTask, initializeExecutor, setResultPersister } from '../task-executor'
import type { ComputationTask } from '../types'

const { log, tokenizer, readMessages, getBlob } = vi.hoisted(() => ({
  log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
  tokenizer: { calls: 0, error: null as Error | null },
  readMessages: vi.fn(),
  getBlob: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({ getLogger: () => log }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessions: { readSessionMessages: readMessages } },
}))
vi.mock('@/adapters/CurrentBlobStorage', () => ({ currentBlobStorage: { get: getBlob } }))
vi.mock('../tokenizer', () => ({
  CJK_CHARACTER_PATTERN: /\p{Script=Han}/u,
  estimateTokensForTokenizerType: () => {
    tokenizer.calls++
    if (tokenizer.error) throw tokenizer.error
    return 7
  },
}))
vi.mock('../draft-tokenizer-worker-client', () => ({ tokenizeDraftOffMainThread: vi.fn() }))

type TaskInput = Omit<ComputationTask, 'id' | 'createdAt'>
const textSnapshot = 'Synthetic message for the task logging fixture.'

function input(index: number): TaskInput {
  return {
    type: 'message-text',
    sessionId: 'logging-session',
    messageId: `message-${index}`,
    tokenizerType: 'default',
    priority: index,
    textSnapshot,
    textDigest: getTokenizationTextDigest(textSnapshot),
  }
}

function task(overrides: Partial<ComputationTask> = {}): ComputationTask {
  const value = input(0)
  return { ...value, id: generateTaskId(value), createdAt: 1, ...overrides }
}

function drained(): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = computationQueue.subscribe(() => {
      const status = computationQueue.getStatus()
      if (status.pending === 0 && status.running === 0) {
        unsubscribe()
        resolve()
      }
    })
  })
}

describe('token task logging', () => {
  beforeEach(() => {
    computationQueue._reset()
    vi.clearAllMocks()
    tokenizer.calls = 0
    tokenizer.error = null
  })

  afterEach(() => {
    computationQueue._reset()
    setResultPersister({ addResult() {} })
    vi.restoreAllMocks()
  })

  it.each([10_000, 100_000])(
    'completes all %i successful tasks without per-task logs',
    async (count) => {
      let persisted = 0
      setResultPersister({
        addResult(result) {
          if (result.tokens !== 7 || result.messageId !== `message-${persisted}`) throw new Error('Unexpected result')
          persisted++
        },
      })
      const finished = drained()
      initializeExecutor()
      // Cover both enqueue entry points while keeping the same complete workload.
      computationQueue.enqueue(input(0))
      computationQueue.enqueueBatch(Array.from({ length: count - 1 }, (_, index) => input(index + 1)))
      await finished

      expect(persisted).toBe(count)
      expect(tokenizer.calls).toBe(count)
      expect(computationQueue._getState().completed.size).toBe(count)
      expect(computationQueue.getStatus()).toEqual({ pending: 0, running: 0 })
      expect(readMessages).not.toHaveBeenCalled()
      process.stdout.write(
        `${JSON.stringify({ count, persisted, tokenized: tokenizer.calls, debugCalls: log.debug.mock.calls.length })}\n`
      )
      expect(log.debug.mock.calls.length).toBe(0)
      expect(log.error).not.toHaveBeenCalled()
      expect(log.warn).not.toHaveBeenCalled()
    },
    30_000
  )

  it.each(['', 'Synthetic attachment content'])('does not log successful attachment content %j', async (content) => {
    readMessages.mockResolvedValue({
      messages: [{ id: 'message-0', files: [{ id: 'file-0', storageKey: 'blob-0', name: 'fixture.txt' }] }],
    })
    getBlob.mockResolvedValue(content)
    const result = await executeTask(task({ type: 'attachment', attachmentId: 'file-0', attachmentType: 'file' }))

    expect(result.success).toBe(true)
    expect(result.result?.tokens).toBe(content ? 14 : 0)
    expect(log.debug.mock.calls.length).toBe(0)
  })

  it('keeps thrown failure diagnostics with the failed task and error', async () => {
    const error = new Error('Synthetic tokenizer failure')
    tokenizer.error = error
    const finished = drained()
    initializeExecutor()
    computationQueue.enqueue(input(0))
    await finished

    expect(log.error).toHaveBeenCalledWith('Task execution failed', { taskId: generateTaskId(input(0)), error })
  })

  it('keeps cancellation diagnostics', async () => {
    vi.spyOn(computationQueue, 'isSessionCancelled').mockReturnValue(true)
    const cancelled = task()
    const result = await executeTask(cancelled)

    expect(result).toEqual({ success: false, error: 'session_cancelled', silent: true })
    expect(log.debug).toHaveBeenCalledWith('Task cancelled due to session cancellation', { taskId: cancelled.id })
  })

  it('keeps stale source diagnostics', async () => {
    const stale = task({ textDigest: 'stale' })
    const result = await executeTask(stale)

    expect(result).toEqual({ success: false, error: 'stale_message_text', silent: true })
    expect(log.debug).toHaveBeenCalledWith('Message text task source changed before execution', {
      taskId: stale.id,
      messageId: stale.messageId,
    })
  })

  it('keeps attachment read failure diagnostics and retryability', async () => {
    readMessages.mockResolvedValue({
      messages: [{ id: 'message-0', files: [{ id: 'file-0', storageKey: 'blob-0', name: 'fixture.txt' }] }],
    })
    const error = new Error('Synthetic blob failure')
    getBlob.mockRejectedValue(error)
    const failed = task({ type: 'attachment', attachmentId: 'file-0', attachmentType: 'file' })
    const result = await executeTask(failed)

    expect(result).toEqual({ success: false, error: 'attachment_read_failed', retryable: true })
    expect(log.debug).toHaveBeenCalledWith('Failed to retrieve attachment content', {
      taskId: failed.id,
      attachmentId: failed.attachmentId,
      error,
    })
  })
})
