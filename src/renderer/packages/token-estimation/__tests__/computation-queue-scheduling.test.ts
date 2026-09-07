import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputationQueue, generateTaskId } from '../computation-queue'
import type { ComputationTask, TaskResult } from '../types'

type TaskInput = Omit<ComputationTask, 'id' | 'createdAt'>

function tasks(count: number, sessionId = 'session'): TaskInput[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'message-text',
    sessionId,
    messageId: `message-${index}`,
    tokenizerType: 'default',
    priority: index,
  }))
}

describe('indexed queue scheduling', () => {
  const queue = new ComputationQueue()

  afterEach(() => {
    queue._reset()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('uses indexed membership for new and repeated batches', () => {
    const scan = vi.spyOn(queue._getState().pending, 'some')
    const input = tasks(1_000)
    queue.enqueueBatch(input)
    queue.enqueueBatch(input)
    queue.enqueue(input[0])
    expect(queue.getStatus()).toEqual({ pending: 1_000, running: 0 })
    expect(scan).not.toHaveBeenCalled()
  })

  it('does not revisit pending IDs when adding new or already queued tasks', () => {
    const input = tasks(1_000)
    queue.enqueueBatch(input)
    let idReads = 0
    for (const task of queue.getPendingTasks()) {
      const id = task.id
      Object.defineProperty(task, 'id', {
        get: () => {
          idReads++
          return id
        },
      })
    }
    queue.enqueueBatch(tasks(1_000, 'other'))
    queue.enqueueBatch(input)
    expect(queue.getStatus().pending).toBe(2_000)
    expect(idReads).toBe(0)
  })

  it('makes removed IDs available after cancellation and both retention filters', () => {
    const input = tasks(3)
    const other = tasks(1, 'other')
    queue.enqueueBatch([...input, ...other])
    queue.retainOnlyMessages('session', new Set([input[0].messageId]))
    queue.enqueueBatch(input)
    expect(queue.getStatus().pending).toBe(4)
    queue.retainOnlyTokenizerType('session', 'deepseek')
    queue.enqueueBatch(input)
    expect(queue.getStatus().pending).toBe(4)
    queue.cancelBySession('session')
    queue.enqueueBatch([...input, ...input])
    expect(queue.getStatus().pending).toBe(4)
    queue._reset()
    queue.enqueueBatch(input)
    expect(queue.getStatus().pending).toBe(3)
  })

  it('allows invalidated completed IDs to be enqueued again', async () => {
    vi.useFakeTimers()
    const input = tasks(1)
    const execute = vi.fn((): Promise<TaskResult> => Promise.resolve({ success: true }))
    queue.setExecutor(execute)
    queue.enqueueBatch(input)
    await vi.runAllTimersAsync()
    queue.invalidateCompletedTasks(input.map(generateTaskId))
    queue.enqueueBatch([...input, ...input])
    await vi.runAllTimersAsync()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
  })

  it.each([
    [512, 0],
    [513, 1],
    [1025, 2],
  ])('executes %i immediate tasks with %i timer yields', async (count, yields) => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const schedule = vi.spyOn(globalThis, 'setTimeout')
    const executed: string[] = []
    let maxRunning = 0
    const execute = vi.fn((task: ComputationTask): Promise<TaskResult> => {
      executed.push(task.id)
      maxRunning = Math.max(maxRunning, queue.getStatus().running)
      return Promise.resolve({ success: true })
    })
    queue.setExecutor(execute)
    const input = tasks(count)
    queue.enqueueBatch(input)
    await vi.runAllTimersAsync()
    expect(executed).toEqual(input.map(generateTaskId))
    expect(schedule).toHaveBeenCalledTimes(yields)
    expect(maxRunning).toBe(1)
    expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
  })

  it('yields a large immediate batch so cancellation can run', async () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const execute = vi.fn((): Promise<TaskResult> => Promise.resolve({ success: true }))
    queue.setExecutor(execute)
    queue.enqueueBatch(tasks(1_000))
    let atCancel = 0
    setTimeout(() => {
      atCancel = execute.mock.calls.length
      expect(queue.getStatus().pending).toBe(488)
      queue.cancelBySession('session')
    }, 0)
    await vi.runAllTimersAsync()
    expect(atCancel).toBe(512)
    expect(execute).toHaveBeenCalledTimes(atCancel)
    expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
  })

  it('also yields when the time budget is reached before the task limit', async () => {
    vi.useFakeTimers()
    let time = 0
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    const execute = vi.fn((): Promise<TaskResult> => {
      time += 3
      return Promise.resolve({ success: true })
    })
    queue.setExecutor(execute)
    queue.enqueueBatch(tasks(100))
    let atYield = 0
    setTimeout(() => {
      atYield = execute.mock.calls.length
      queue.cancelBySession('session')
    }, 0)
    await vi.runAllTimersAsync()
    expect(atYield).toBe(3)
    expect(execute).toHaveBeenCalledTimes(3)
    expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
  })

  it('deduplicates reentry while running and after a yielded cancellation', async () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const input = tasks(1200)
    const executed: string[] = []
    const execute = vi.fn((task: ComputationTask): Promise<TaskResult> => {
      executed.push(task.id)
      if (executed.length === 1) {
        queue.cancelBySession('session')
        queue.enqueueBatch([...input, ...input])
      }
      return Promise.resolve({ success: true })
    })
    queue.setExecutor(execute)
    queue.enqueueBatch(input)
    setTimeout(() => {
      expect(executed).toHaveLength(512)
      expect(queue.getStatus().pending).toBe(688)
      queue.cancelBySession('session')
      queue.enqueueBatch([...input, ...input])
    }, 0)
    await vi.runAllTimersAsync()
    expect(executed).toEqual(input.map(generateTaskId))
    expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
  })

  it('keeps priority and FIFO ordering when tasks arrive during a yield', async () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const input = tasks(1200).map((task) => ({ ...task, priority: 10 }))
    const urgent = { ...tasks(1, 'urgent')[0], priority: 0 }
    const executed: string[] = []
    queue.enqueueBatch(input)
    let insertedAfter = 0
    setTimeout(() => {
      insertedAfter = executed.length
      expect(queue.getStatus().pending).toBe(688)
      queue.enqueue(urgent)
    }, 0)
    queue.setExecutor((task) => {
      executed.push(task.id)
      return Promise.resolve({ success: true })
    })
    await vi.runAllTimersAsync()
    expect(insertedAfter).toBe(512)
    expect(executed).toEqual(
      [...input.slice(0, insertedAfter), urgent, ...input.slice(insertedAfter)].map(generateTaskId)
    )
  })

  it('does not resume a reset queue after its task-limit yield', async () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const input = tasks(1200)
    const replacement = tasks(600, 'replacement')
    const executed: string[] = []
    const execute = (task: ComputationTask): Promise<TaskResult> => {
      executed.push(task.id)
      return Promise.resolve({ success: true })
    }
    queue.setExecutor(execute)
    queue.enqueueBatch(input)
    setTimeout(() => {
      expect(executed).toHaveLength(512)
      queue._reset()
      queue.setExecutor(execute)
      queue.enqueueBatch(replacement)
    }, 0)
    await vi.runAllTimersAsync()
    expect(executed).toEqual([...input.slice(0, 512), ...replacement].map(generateTaskId))
    expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
    expect(queue._getState().completed).toEqual(new Set(replacement.map(generateTaskId)))
  })

  it('releases IDs of tasks skipped while their session is cancelled', async () => {
    vi.useFakeTimers()
    let finish: ((result: TaskResult) => void) | undefined
    queue.setExecutor(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const input = tasks(2)
    queue.enqueue(input[0])
    queue.cancelBySession('session')
    queue.enqueue(input[1])
    finish?.({ success: true })
    await vi.runAllTimersAsync()
    expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
    const execute = vi.fn((): Promise<TaskResult> => Promise.resolve({ success: true }))
    queue.setExecutor(execute)
    queue.enqueueBatch(input)
    await vi.runAllTimersAsync()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('ignores completion from a reset queue while a new task is running', async () => {
    vi.useFakeTimers()
    let finishOld: ((result: TaskResult) => void) | undefined
    queue.setExecutor(
      () =>
        new Promise((resolve) => {
          finishOld = resolve
        })
    )
    queue.enqueueBatch(tasks(1))
    queue._reset()
    let finishNew: ((result: TaskResult) => void) | undefined
    queue.setExecutor(
      () =>
        new Promise((resolve) => {
          finishNew = resolve
        })
    )
    queue.enqueueBatch(tasks(1))
    finishOld?.({ success: true })
    await vi.runAllTimersAsync()
    expect(queue.getStatus()).toEqual({ pending: 0, running: 1 })
    expect(queue._getState().completed.size).toBe(0)
    finishNew?.({ success: true })
    await vi.runAllTimersAsync()
    expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
    expect(queue._getState().completed.size).toBe(1)
  })
})
