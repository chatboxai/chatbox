import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComputationQueue, computationQueue, generateTaskId, getPriority, PRIORITY } from '../computation-queue'
import type { ComputationTask, TaskResult } from '../types'

type TaskInput = Omit<ComputationTask, 'id' | 'createdAt'>

describe('retryable task failures', () => {
  afterEach(() => vi.useRealTimers())

  it('retries transient failures at most three times and stops after success', async () => {
    vi.useFakeTimers()
    const queue = new ComputationQueue()
    const executor = vi.fn().mockResolvedValue({ success: false, retryable: true, error: 'attachment_content_missing' })
    queue.setExecutor(executor)
    queue.enqueue(createAttachmentTask())
    await vi.runAllTimersAsync()
    expect(executor).toHaveBeenCalledTimes(3)
    expect(queue.getStatus().running).toBe(0)
    executor.mockClear().mockResolvedValueOnce({ success: false, retryable: true }).mockResolvedValue({ success: true })
    queue.enqueue(createAttachmentTask({ messageId: 'next' }))
    await vi.runAllTimersAsync()
    expect(executor).toHaveBeenCalledTimes(2)
    queue._reset()
  })

  it('does not retry after session cancellation during backoff', async () => {
    vi.useFakeTimers()
    const queue = new ComputationQueue()
    const executor = vi.fn().mockResolvedValue({ success: false, retryable: true })
    queue.setExecutor(executor)
    queue.enqueue(createAttachmentTask())
    await vi.advanceTimersByTimeAsync(0)
    queue.cancelBySession('session-1')
    await vi.runAllTimersAsync()
    expect(executor).toHaveBeenCalledTimes(1)
    queue._reset()
  })
})

function createMessageTextTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    type: 'message-text',
    sessionId: 'session-1',
    messageId: 'msg-1',
    tokenizerType: 'default',
    priority: PRIORITY.CONTEXT_TEXT,
    ...overrides,
  }
}

function createAttachmentTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    type: 'attachment',
    sessionId: 'session-1',
    messageId: 'msg-1',
    attachmentId: 'att-1',
    attachmentType: 'file',
    tokenizerType: 'default',
    contentMode: 'full',
    priority: PRIORITY.CONTEXT_ATTACHMENT,
    ...overrides,
  }
}

describe('generateTaskId', () => {
  it('generates correct ID for message-text tasks', () => {
    const task = createMessageTextTask({
      sessionId: 'sess-123',
      messageId: 'msg-456',
      tokenizerType: 'default',
    })
    expect(generateTaskId(task)).toBe('msg:sess-123:msg-456:default')
  })

  it('generates correct ID for message-text with deepseek tokenizer', () => {
    const task = createMessageTextTask({
      sessionId: 'sess-123',
      messageId: 'msg-456',
      tokenizerType: 'deepseek',
    })
    expect(generateTaskId(task)).toBe('msg:sess-123:msg-456:deepseek')
  })

  it('generates correct ID for attachment tasks', () => {
    const task = createAttachmentTask({
      sessionId: 'sess-123',
      messageId: 'msg-456',
      attachmentId: 'att-789',
      tokenizerType: 'default',
      contentMode: 'full',
    })
    expect(generateTaskId(task)).toBe('att:sess-123:msg-456:att-789:default:full')
  })

  it('generates correct ID for attachment with preview mode', () => {
    const task = createAttachmentTask({
      sessionId: 'sess-123',
      messageId: 'msg-456',
      attachmentId: 'att-789',
      tokenizerType: 'deepseek',
      contentMode: 'preview',
    })
    expect(generateTaskId(task)).toBe('att:sess-123:msg-456:att-789:deepseek:preview')
  })
})

describe('getPriority', () => {
  it('returns CURRENT_INPUT_TEXT for current input text', () => {
    expect(getPriority(true, 'message-text', 0)).toBe(PRIORITY.CURRENT_INPUT_TEXT)
    expect(getPriority(true, 'message-text', 5)).toBe(PRIORITY.CURRENT_INPUT_TEXT)
  })

  it('returns CURRENT_INPUT_ATTACHMENT for current input attachment', () => {
    expect(getPriority(true, 'attachment', 0)).toBe(PRIORITY.CURRENT_INPUT_ATTACHMENT)
    expect(getPriority(true, 'attachment', 5)).toBe(PRIORITY.CURRENT_INPUT_ATTACHMENT)
  })

  it('returns CONTEXT_TEXT + messageIndex for context text', () => {
    expect(getPriority(false, 'message-text', 0)).toBe(PRIORITY.CONTEXT_TEXT + 0)
    expect(getPriority(false, 'message-text', 5)).toBe(PRIORITY.CONTEXT_TEXT + 5)
    expect(getPriority(false, 'message-text', 10)).toBe(PRIORITY.CONTEXT_TEXT + 10)
  })

  it('returns CONTEXT_ATTACHMENT + messageIndex for context attachment', () => {
    expect(getPriority(false, 'attachment', 0)).toBe(PRIORITY.CONTEXT_ATTACHMENT + 0)
    expect(getPriority(false, 'attachment', 5)).toBe(PRIORITY.CONTEXT_ATTACHMENT + 5)
    expect(getPriority(false, 'attachment', 10)).toBe(PRIORITY.CONTEXT_ATTACHMENT + 10)
  })

  it('maintains priority order: current input > context', () => {
    const currentInputText = getPriority(true, 'message-text', 0)
    const currentInputAttachment = getPriority(true, 'attachment', 0)
    const contextText = getPriority(false, 'message-text', 0)
    const contextAttachment = getPriority(false, 'attachment', 0)

    expect(currentInputText).toBeLessThan(currentInputAttachment)
    expect(currentInputAttachment).toBeLessThan(contextText)
    expect(contextText).toBeLessThan(contextAttachment)
  })
})

describe('PRIORITY constants', () => {
  it('has correct values', () => {
    expect(PRIORITY.CURRENT_INPUT_TEXT).toBe(0)
    expect(PRIORITY.CURRENT_INPUT_ATTACHMENT).toBe(1)
    expect(PRIORITY.CONTEXT_TEXT).toBe(10)
    expect(PRIORITY.CONTEXT_ATTACHMENT).toBe(11)
  })
})

describe('ComputationQueue', () => {
  let queue: ComputationQueue

  beforeEach(() => {
    queue = new ComputationQueue()
  })

  afterEach(() => {
    queue._reset()
  })

  describe('enqueue', () => {
    it('adds task to pending queue', () => {
      queue.enqueue(createMessageTextTask())
      expect(queue.getStatus().pending).toBe(1)
    })

    it('deduplicates tasks with same ID', () => {
      const task = createMessageTextTask()
      queue.enqueue(task)
      queue.enqueue(task)
      queue.enqueue(task)
      expect(queue.getStatus().pending).toBe(1)
    })

    it('allows different tasks', () => {
      queue.enqueue(createMessageTextTask({ messageId: 'msg-1' }))
      queue.enqueue(createMessageTextTask({ messageId: 'msg-2' }))
      queue.enqueue(createMessageTextTask({ messageId: 'msg-3' }))
      expect(queue.getStatus().pending).toBe(3)
    })

    it('sorts tasks by priority (lower first)', () => {
      queue.enqueue(createMessageTextTask({ messageId: 'msg-1', priority: 20 }))
      queue.enqueue(createMessageTextTask({ messageId: 'msg-2', priority: 5 }))
      queue.enqueue(createMessageTextTask({ messageId: 'msg-3', priority: 10 }))

      const pending = queue.getPendingTasks()
      expect(pending[0].priority).toBe(5)
      expect(pending[1].priority).toBe(10)
      expect(pending[2].priority).toBe(20)
    })

    it('sorts by createdAt when priority is equal', () => {
      vi.useFakeTimers()
      try {
        const now = Date.now()
        vi.setSystemTime(now)
        queue.enqueue(createMessageTextTask({ messageId: 'msg-1', priority: 10 }))

        vi.setSystemTime(now + 100)
        queue.enqueue(createMessageTextTask({ messageId: 'msg-2', priority: 10 }))

        vi.setSystemTime(now + 50)
        queue.enqueue(createMessageTextTask({ messageId: 'msg-3', priority: 10 }))

        const pending = queue.getPendingTasks()
        expect(pending[0].messageId).toBe('msg-1')
        expect(pending[1].messageId).toBe('msg-3')
        expect(pending[2].messageId).toBe('msg-2')
      } finally {
        vi.useRealTimers()
      }
    })

    it('notifies listeners when task is added', () => {
      const listener = vi.fn()
      queue.subscribe(listener)
      queue.enqueue(createMessageTextTask())
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('does not notify when duplicate task is added', () => {
      const task = createMessageTextTask()
      queue.enqueue(task)

      const listener = vi.fn()
      queue.subscribe(listener)
      queue.enqueue(task)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('enqueueBatch', () => {
    it('preserves FIFO across same-time single and batch arrivals', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(1000)
      const shift = vi.spyOn(queue._getState().pending, 'shift')
      const tasks = Array.from({ length: 8 }, (_, index) => createMessageTextTask({ messageId: `fifo-${index}` }))
      const executed: string[] = []
      const snapshots: string[][] = []
      try {
        queue.enqueueBatch(tasks.slice(0, 2))
        queue.enqueue(tasks[2])
        queue.enqueueBatch([tasks[1], tasks[3], tasks[4]])
        queue.enqueueBatch(tasks.slice(0, 5))
        expect(queue.getPendingTasks().map((task) => task.messageId)).toEqual(
          tasks.slice(0, 5).map((task) => task.messageId)
        )
        queue.enqueue(tasks[5])
        queue.setExecutor((task) => {
          executed.push(task.messageId)
          if (task.messageId === tasks[0].messageId) {
            queue.enqueue(tasks[6])
            queue.enqueueBatch([tasks[7], tasks[2]])
            snapshots.push(queue.getPendingTasks().map((pending) => pending.messageId))
          }
          return Promise.resolve({ success: true })
        })
        await vi.runAllTimersAsync()
        expect(executed).toEqual(tasks.map((task) => task.messageId))
        expect(snapshots).toEqual([tasks.slice(1).map((task) => task.messageId)])
        expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
        expect(shift).not.toHaveBeenCalled()
      } finally {
        shift.mockRestore()
        vi.useRealTimers()
      }
    })

    it('adds multiple tasks at once', () => {
      queue.enqueueBatch([
        createMessageTextTask({ messageId: 'msg-1' }),
        createMessageTextTask({ messageId: 'msg-2' }),
        createMessageTextTask({ messageId: 'msg-3' }),
      ])
      expect(queue.getStatus().pending).toBe(3)
    })

    it('deduplicates within batch', () => {
      const task = createMessageTextTask()
      queue.enqueueBatch([task, task, task])
      expect(queue.getStatus().pending).toBe(1)
    })

    it('deduplicates against existing tasks', () => {
      queue.enqueue(createMessageTextTask({ messageId: 'msg-1' }))
      queue.enqueueBatch([createMessageTextTask({ messageId: 'msg-1' }), createMessageTextTask({ messageId: 'msg-2' })])
      expect(queue.getStatus().pending).toBe(2)
    })

    it('notifies listeners only once for batch', () => {
      const listener = vi.fn()
      queue.subscribe(listener)
      queue.enqueueBatch([
        createMessageTextTask({ messageId: 'msg-1' }),
        createMessageTextTask({ messageId: 'msg-2' }),
        createMessageTextTask({ messageId: 'msg-3' }),
      ])
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('does not notify when all tasks are duplicates', () => {
      const task = createMessageTextTask()
      queue.enqueue(task)

      const listener = vi.fn()
      queue.subscribe(listener)
      queue.enqueueBatch([task, task])
      expect(listener).not.toHaveBeenCalled()
    })

    it('handles empty batch', () => {
      const listener = vi.fn()
      queue.subscribe(listener)
      queue.enqueueBatch([])
      expect(listener).not.toHaveBeenCalled()
      expect(queue.getStatus().pending).toBe(0)
    })
  })

  describe('cancelBySession', () => {
    it('removes pending tasks for session', () => {
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-1' }))
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-2' }))
      queue.enqueue(createMessageTextTask({ sessionId: 'session-2', messageId: 'msg-3' }))

      queue.cancelBySession('session-1')

      expect(queue.getStatus().pending).toBe(1)
      expect(queue.getPendingTasks()[0].sessionId).toBe('session-2')
    })

    it('notifies listeners when tasks are removed', () => {
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1' }))

      const listener = vi.fn()
      queue.subscribe(listener)
      queue.cancelBySession('session-1')
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('does not notify when no tasks are removed', () => {
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1' }))

      const listener = vi.fn()
      queue.subscribe(listener)
      queue.cancelBySession('session-2')
      expect(listener).not.toHaveBeenCalled()
    })

    it('marks session as cancelled for running tasks', async () => {
      const executor = vi.fn().mockImplementation(
        () =>
          new Promise<TaskResult>((resolve) => {
            setTimeout(() => resolve({ success: true }), 100)
          })
      )
      queue.setExecutor(executor)
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1' }))

      await vi.waitFor(() => expect(queue.getStatus().running).toBe(1))

      queue.cancelBySession('session-1')
      expect(queue.isSessionCancelled('session-1')).toBe(true)
    })
  })

  describe('getStatusForSession', () => {
    it('returns counts for specific session only', () => {
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-1' }))
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-2' }))
      queue.enqueue(createMessageTextTask({ sessionId: 'session-2', messageId: 'msg-3' }))

      const status = queue.getStatusForSession('session-1')
      expect(status.pending).toBe(2)
      expect(status.running).toBe(0)
    })

    it('returns zero for session with no tasks', () => {
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1' }))

      const status = queue.getStatusForSession('session-2')
      expect(status.pending).toBe(0)
      expect(status.running).toBe(0)
    })

    it('correctly counts both pending and running tasks', async () => {
      const resolvers: Array<(value: TaskResult) => void> = []
      const executor = vi.fn().mockImplementation(
        () =>
          new Promise<TaskResult>((resolve) => {
            resolvers.push(resolve)
          })
      )
      queue.setExecutor(executor)

      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-1' }))
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-2' }))
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-3' }))
      queue.enqueue(createMessageTextTask({ sessionId: 'session-2', messageId: 'msg-4' }))

      await vi.waitFor(() => expect(queue.getStatus().running).toBeGreaterThan(0))

      const status1 = queue.getStatusForSession('session-1')
      const status2 = queue.getStatusForSession('session-2')

      expect(status1.pending + status1.running).toBe(3)
      expect(status2.pending + status2.running).toBe(1)
    })
  })

  describe('enqueueBatch clears cancelled status', () => {
    it('clears cancelled status when re-enqueueing tasks for a session', async () => {
      const resolvers: Array<(value: TaskResult) => void> = []
      const executor = vi.fn().mockImplementation(
        () =>
          new Promise<TaskResult>((resolve) => {
            resolvers.push(resolve)
          })
      )
      queue.setExecutor(executor)

      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-1' }))
      await vi.waitFor(() => expect(queue.getStatus().running).toBe(1))

      queue.cancelBySession('session-1')
      expect(queue.isSessionCancelled('session-1')).toBe(true)

      queue.enqueueBatch([createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-2' })])

      expect(queue.isSessionCancelled('session-1')).toBe(false)
      expect(queue.getStatusForSession('session-1').pending).toBe(1)

      resolvers[0]({ success: true })
    })
  })

  describe('concurrency control', () => {
    it('limits concurrent tasks to maxConcurrency (1)', async () => {
      const resolvers: Array<(value: TaskResult) => void> = []
      const executor = vi.fn().mockImplementation(
        () =>
          new Promise<TaskResult>((resolve) => {
            resolvers.push(resolve)
          })
      )
      queue.setExecutor(executor)

      for (let i = 0; i < 10; i++) {
        queue.enqueue(createMessageTextTask({ messageId: `msg-${i}` }))
      }

      await vi.waitFor(() => expect(queue.getStatus().running).toBe(1))
      expect(queue.getStatus().pending).toBe(9)

      resolvers[0]({ success: true })
      await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(2))
      expect(queue.getStatus().pending).toBe(8)
    })

    it('processes next task when one completes', async () => {
      const resolvers: Array<(value: TaskResult) => void> = []
      const executor = vi.fn().mockImplementation(
        () =>
          new Promise<TaskResult>((resolve) => {
            resolvers.push(resolve)
          })
      )
      queue.setExecutor(executor)

      for (let i = 0; i < 5; i++) {
        queue.enqueue(createMessageTextTask({ messageId: `msg-${i}` }))
      }

      // With maxConcurrency=1, only 1 running, 4 pending
      await vi.waitFor(() => expect(queue.getStatus().running).toBe(1))
      expect(queue.getStatus().pending).toBe(4)

      // Resolve tasks one by one to verify sequential processing
      for (let i = 0; i < 4; i++) {
        resolvers[i]({ success: true })
        await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(i + 2))
      }
      // After resolving 4, the 5th is now running
      expect(queue.getStatus().pending).toBe(0)
    })
  })

  describe('task execution', () => {
    it('calls executor with task', async () => {
      const executor = vi.fn().mockResolvedValue({ success: true })
      queue.setExecutor(executor)

      const task = createMessageTextTask()
      queue.enqueue(task)

      await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(1))
      expect(executor.mock.calls[0][0]).toMatchObject({
        type: 'message-text',
        sessionId: 'session-1',
        messageId: 'msg-1',
      })
    })

    it('adds completed task ID to completed set', async () => {
      const executor = vi.fn().mockResolvedValue({ success: true })
      queue.setExecutor(executor)

      queue.enqueue(createMessageTextTask())

      await vi.waitFor(() => expect(queue.getStatus().running).toBe(0))
      expect(queue._getState().completed.size).toBe(1)
    })

    it('does not add to completed if session was cancelled', async () => {
      let resolveTask: ((value: TaskResult) => void) | undefined
      const executor = vi.fn().mockImplementation(
        () =>
          new Promise<TaskResult>((resolve) => {
            resolveTask = resolve
          })
      )
      queue.setExecutor(executor)

      queue.enqueue(createMessageTextTask({ sessionId: 'session-1' }))
      await vi.waitFor(() => expect(queue.getStatus().running).toBe(1))

      queue.cancelBySession('session-1')
      if (resolveTask) resolveTask({ success: true })

      await vi.waitFor(() => expect(queue.getStatus().running).toBe(0))
      expect(queue._getState().completed.size).toBe(0)
    })

    it('skips completed tasks on re-enqueue', async () => {
      const executor = vi.fn().mockResolvedValue({ success: true })
      queue.setExecutor(executor)

      const task = createMessageTextTask()
      queue.enqueue(task)

      await vi.waitFor(() => expect(queue.getStatus().running).toBe(0))
      expect(executor).toHaveBeenCalledTimes(1)

      queue.enqueue(task)
      expect(queue.getStatus().pending).toBe(0)
      expect(executor).toHaveBeenCalledTimes(1)
    })

    it('handles executor errors gracefully', async () => {
      const executor = vi.fn().mockRejectedValue(new Error('Test error'))
      queue.setExecutor(executor)

      queue.enqueue(createMessageTextTask({ messageId: 'msg-1' }))
      queue.enqueue(createMessageTextTask({ messageId: 'msg-2' }))

      await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(2))
      expect(queue.getStatus().running).toBe(0)
    })
  })

  describe('subscribe', () => {
    it('returns unsubscribe function', () => {
      const listener = vi.fn()
      const unsubscribe = queue.subscribe(listener)

      queue.enqueue(createMessageTextTask({ messageId: 'msg-1' }))
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()
      queue.enqueue(createMessageTextTask({ messageId: 'msg-2' }))
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('handles listener errors gracefully', () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const normalListener = vi.fn()

      queue.subscribe(errorListener)
      queue.subscribe(normalListener)

      queue.enqueue(createMessageTextTask())

      expect(errorListener).toHaveBeenCalled()
      expect(normalListener).toHaveBeenCalled()
    })
  })

  describe('clearCompletedBySession', () => {
    it('removes completed task IDs for session', async () => {
      const executor = vi.fn().mockResolvedValue({ success: true })
      queue.setExecutor(executor)

      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-1' }))
      queue.enqueue(createMessageTextTask({ sessionId: 'session-1', messageId: 'msg-2' }))
      queue.enqueue(createMessageTextTask({ sessionId: 'session-2', messageId: 'msg-3' }))

      await vi.waitFor(() => expect(queue._getState().completed.size).toBe(3))

      queue.clearCompletedBySession('session-1')

      expect(queue._getState().completed.size).toBe(1)
      expect(queue._getState().completed.has('msg:session-2:msg-3:default')).toBe(true)
    })

    it('clears cancelled session flag', async () => {
      const resolvers: Array<(value: TaskResult) => void> = []
      const executor = vi.fn().mockImplementation(
        () =>
          new Promise<TaskResult>((resolve) => {
            resolvers.push(resolve)
          })
      )
      queue.setExecutor(executor)

      queue.enqueue(createMessageTextTask({ sessionId: 'session-1' }))
      await vi.waitFor(() => expect(queue.getStatus().running).toBe(1))

      queue.cancelBySession('session-1')
      expect(queue.isSessionCancelled('session-1')).toBe(true)

      queue.clearCompletedBySession('session-1')
      expect(queue.isSessionCancelled('session-1')).toBe(false)
    })
  })

  describe('getStatus', () => {
    it('returns correct counts', async () => {
      const resolvers: Array<(value: TaskResult) => void> = []
      const executor = vi.fn().mockImplementation(
        () =>
          new Promise<TaskResult>((resolve) => {
            resolvers.push(resolve)
          })
      )
      queue.setExecutor(executor)

      expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })

      queue.enqueue(createMessageTextTask({ messageId: 'msg-1' }))
      queue.enqueue(createMessageTextTask({ messageId: 'msg-2' }))
      queue.enqueue(createMessageTextTask({ messageId: 'msg-3' }))

      await vi.waitFor(() => expect(queue.getStatus().running).toBeGreaterThan(0))

      const status = queue.getStatus()
      expect(status.running + status.pending).toBe(3)
    })
  })

  describe('getPendingTasks', () => {
    it('returns copy of pending tasks', () => {
      queue.enqueue(createMessageTextTask({ messageId: 'msg-1' }))
      queue.enqueue(createMessageTextTask({ messageId: 'msg-2' }))

      const pending = queue.getPendingTasks()
      expect(pending).toHaveLength(2)

      pending.push({} as ComputationTask)
      expect(queue.getPendingTasks()).toHaveLength(2)
    })
  })

  describe('setExecutor', () => {
    it('processes pending tasks when executor is set', async () => {
      queue.enqueue(createMessageTextTask({ messageId: 'msg-1' }))
      queue.enqueue(createMessageTextTask({ messageId: 'msg-2' }))

      expect(queue.getStatus().pending).toBe(2)
      expect(queue.getStatus().running).toBe(0)

      const executor = vi.fn().mockResolvedValue({ success: true })
      queue.setExecutor(executor)

      await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(2))
    })
  })
})

describe('computationQueue singleton', () => {
  afterEach(() => {
    computationQueue._reset()
  })

  it('is a ComputationQueue instance', () => {
    expect(computationQueue).toBeInstanceOf(ComputationQueue)
  })

  it('can be used directly', () => {
    computationQueue.enqueue(createMessageTextTask())
    expect(computationQueue.getStatus().pending).toBe(1)
  })
})
