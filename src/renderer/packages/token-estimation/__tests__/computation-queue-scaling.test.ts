import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputationQueue } from '../computation-queue'
import type { ComputationTask } from '../types'

vi.mock('@/lib/utils', () => ({
  getLogger: () => ({ debug: () => {}, error: () => {} }),
}))

type TaskInput = Omit<ComputationTask, 'id' | 'createdAt'>

function fixture(count: number): TaskInput[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'message-text',
    sessionId: 'scaling-session',
    messageId: `message-${index}`,
    tokenizerType: 'default',
    priority: count - index,
  }))
}

describe('queue scaling', () => {
  const queue = new ComputationQueue()
  afterEach(() => queue._reset())

  it.each([1_000, 10_000, 100_000])(
    'enqueues and deduplicates all %i tasks',
    (count) => {
      const tasks = fixture(count)
      const start = performance.now()
      queue.enqueueBatch(tasks)
      const enqueued = performance.now()
      queue.enqueueBatch(tasks)
      const deduplicated = performance.now()
      expect(queue.getStatus()).toEqual({ pending: count, running: 0 })
      expect(queue.getPendingTasks().map((task) => task.messageId)).toEqual(
        tasks.toReversed().map((task) => task.messageId)
      )
      process.stdout.write(
        `${JSON.stringify({ count, enqueueMs: enqueued - start, duplicateMs: deduplicated - enqueued })}\n`
      )
    },
    180_000
  )

  it.each([1_000, 10_000, 100_000])(
    'fully drains %i tasks with event-loop yields',
    async (count) => {
      queue.enqueueBatch(fixture(count))
      let completed = 0
      let heartbeats = 0
      const heartbeat = setInterval(() => heartbeats++, 0)
      const drained = new Promise<void>((resolve) => {
        queue.subscribe(() => {
          const status = queue.getStatus()
          if (status.pending === 0 && status.running === 0) resolve()
        })
      })
      const start = performance.now()
      try {
        queue.setExecutor((task) => {
          expect(task.messageId).toBe(`message-${count - completed - 1}`)
          completed++
          return Promise.resolve({ success: true })
        })
        await drained
      } finally {
        clearInterval(heartbeat)
      }
      const elapsedMs = performance.now() - start
      expect(completed).toBe(count)
      expect(queue.getStatus()).toEqual({ pending: 0, running: 0 })
      expect(heartbeats).toBeGreaterThan(0)
      process.stdout.write(`${JSON.stringify({ count, completed, drainMs: elapsedMs, heartbeats })}\n`)
    },
    180_000
  )
})
