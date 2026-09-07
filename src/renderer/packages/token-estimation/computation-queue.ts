/**
 * Computation Queue for Token Estimation
 *
 * Manages background processing of token computation tasks with:
 * - Priority-based scheduling (lower number = higher priority)
 * - Deduplication by task ID
 * - Concurrency control (max 1 concurrent task)
 * - Session-based cancellation
 */

import { getLogger } from '@/lib/utils'
import type { ComputationTask, QueueState, TaskResult } from './types'

const log = getLogger('token-estimation:queue')

// ============================================================================
// Task ID Generation
// ============================================================================

/**
 * Generate a unique task ID for deduplication
 * - Message text: `msg:{sessionId}:{messageId}:{tokenizerType}:{textDigest}:{retryAttempt}`
 * - Attachment: `att:{sessionId}:{messageId}:{attachmentId}:{tokenizerType}:{contentMode}`
 */
export function generateTaskId(task: Omit<ComputationTask, 'id' | 'createdAt'>): string {
  if (task.type === 'message-text') {
    const sourceSuffix = task.textDigest ? `:${task.textDigest}:${task.retryAttempt ?? 0}` : ''
    return `msg:${task.sessionId}:${task.messageId}:${task.tokenizerType}${sourceSuffix}`
  }
  return `att:${task.sessionId}:${task.messageId}:${task.attachmentId}:${task.tokenizerType}:${task.contentMode}`
}

// ============================================================================
// Priority Constants
// ============================================================================

/**
 * Priority values for different task types
 * Lower number = higher priority
 */
export const PRIORITY = {
  /** Current input text (highest priority) */
  CURRENT_INPUT_TEXT: 0,
  /** Current input attachments */
  CURRENT_INPUT_ATTACHMENT: 1,
  /** Context message text (base priority) */
  CONTEXT_TEXT: 10,
  /** Context message attachments (base priority) */
  CONTEXT_ATTACHMENT: 11,
} as const

/**
 * Calculate priority for a task based on its context
 *
 * @param isCurrentInput - Whether this is for the current input (not yet sent)
 * @param type - Task type ('message-text' or 'attachment')
 * @param messageIndex - Position in context (0 = most recent, only used for context messages)
 * @returns Priority value (lower = higher priority)
 */
export function getPriority(
  isCurrentInput: boolean,
  type: 'message-text' | 'attachment',
  messageIndex: number
): number {
  if (isCurrentInput) {
    return type === 'message-text' ? PRIORITY.CURRENT_INPUT_TEXT : PRIORITY.CURRENT_INPUT_ATTACHMENT
  }
  const base = type === 'message-text' ? PRIORITY.CONTEXT_TEXT : PRIORITY.CONTEXT_ATTACHMENT
  return base + messageIndex
}

// ============================================================================
// Computation Queue
// ============================================================================

/**
 * Queue for managing token computation tasks
 *
 * Features:
 * - Automatic deduplication by task ID
 * - Priority-based scheduling
 * - Concurrency control (max 1 concurrent)
 * - Session-based cancellation
 * - State change subscriptions
 */
export class ComputationQueue {
  private state: QueueState = {
    pending: [],
    running: new Map(),
    completed: new Set(),
  }

  private maxConcurrency = 1
  /** Interval between task executions (ms) - helps visualize progress */
  private taskIntervalMs = 5
  private listeners = new Set<() => void>()
  private taskExecutor: ((task: ComputationTask) => Promise<TaskResult>) | null = null

  private cancelledSessions = new Set<string>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Set the task executor function
   * This will be called by task-executor.ts to provide the actual computation logic
   */
  setExecutor(executor: (task: ComputationTask) => Promise<TaskResult>): void {
    this.taskExecutor = executor
    this.processQueue()
  }

  /**
   * Add a single task to the queue
   * - Generates task ID automatically
   * - Skips if task already exists (pending, running, or completed)
   * - Sorts pending queue by priority
   */
  enqueue(task: Omit<ComputationTask, 'id' | 'createdAt'>): void {
    const id = generateTaskId(task)

    if (this.state.completed.has(id)) return
    if (this.state.running.has(id)) return
    if (this.state.pending.some((t) => t.id === id)) return

    const fullTask: ComputationTask = {
      ...task,
      id,
      createdAt: Date.now(),
    }

    log.debug('Task enqueued', { taskId: id, type: task.type, priority: task.priority })

    this.state.pending.push(fullTask)
    this.sortPending()
    this.processQueue()
    this.notifyListeners()
  }

  /**
   * Add multiple tasks efficiently
   * - Batches deduplication and sorting
   * - Only notifies listeners once
   */
  enqueueBatch(tasks: Omit<ComputationTask, 'id' | 'createdAt'>[]): void {
    if (tasks.length === 0) return

    // Clear cancelled status for sessions being enqueued
    // This handles React Strict Mode (double mount) and session re-activation
    const sessionIds = new Set(tasks.map((t) => t.sessionId))
    for (const sid of sessionIds) {
      this.cancelledSessions.delete(sid)
    }

    let added = 0
    let skippedCompleted = 0
    let skippedRunning = 0
    let skippedPending = 0
    const now = Date.now()

    for (const task of tasks) {
      const id = generateTaskId(task)

      if (this.state.completed.has(id)) {
        skippedCompleted++
        continue
      }
      if (this.state.running.has(id)) {
        skippedRunning++
        continue
      }
      if (this.state.pending.some((t) => t.id === id)) {
        skippedPending++
        continue
      }

      const fullTask: ComputationTask = {
        ...task,
        id,
        createdAt: now,
      }

      this.state.pending.push(fullTask)
      added++
    }

    if (added > 0) {
      this.sortPending()
      this.processQueue()
      this.notifyListeners()
    }
  }

  /**
   * Cancel all tasks for a specific session
   * - Removes pending tasks
   * - Marks running tasks for cancellation (they'll check this flag)
   */
  cancelBySession(sessionId: string): void {
    const beforeCount = this.state.pending.length
    this.state.pending = this.state.pending.filter((t) => t.sessionId !== sessionId)

    for (const [, task] of this.state.running) {
      if (task.sessionId === sessionId) {
        this.cancelledSessions.add(sessionId)
      }
    }

    if (beforeCount !== this.state.pending.length || this.cancelledSessions.has(sessionId)) {
      this.notifyListeners()
    }
  }

  /**
   * Cancel tasks for messages not in the allowed set (context changed)
   */
  retainOnlyMessages(sessionId: string, allowedMessageIds: Set<string>): void {
    const beforeCount = this.state.pending.length
    this.state.pending = this.state.pending.filter(
      (t) => t.sessionId !== sessionId || allowedMessageIds.has(t.messageId)
    )

    if (beforeCount !== this.state.pending.length) {
      this.notifyListeners()
    }
  }

  /**
   * Cancel tasks for a session that don't match the current tokenizerType
   * Called when user switches models (tokenizerType changes)
   */
  retainOnlyTokenizerType(sessionId: string, tokenizerType: string): void {
    const beforeCount = this.state.pending.length
    this.state.pending = this.state.pending.filter(
      (t) => t.sessionId !== sessionId || t.tokenizerType === tokenizerType
    )

    if (beforeCount !== this.state.pending.length) {
      this.notifyListeners()
    }
  }

  /**
   * Check if a session has been cancelled
   * Used by task executor to abort early
   */
  isSessionCancelled(sessionId: string): boolean {
    return this.cancelledSessions.has(sessionId)
  }

  /**
   * Get current queue status
   */
  getStatus(): { pending: number; running: number } {
    return {
      pending: this.state.pending.length,
      running: this.state.running.size,
    }
  }

  /**
   * Get queue status for a specific session only
   */
  getStatusForSession(sessionId: string): { pending: number; running: number } {
    const pending = this.state.pending.filter((t) => t.sessionId === sessionId).length
    let running = 0
    for (const [, task] of this.state.running) {
      if (task.sessionId === sessionId) {
        running++
      }
    }
    return { pending, running }
  }

  /**
   * Get distinct message IDs with pending or running tasks for a session.
   */
  getUnfinishedMessageIdsForSession(sessionId: string): Set<string> {
    const messageIds = new Set<string>()
    for (const task of this.state.pending) {
      if (task.sessionId === sessionId) messageIds.add(task.messageId)
    }
    for (const task of this.state.running.values()) {
      if (task.sessionId === sessionId) messageIds.add(task.messageId)
    }
    return messageIds
  }

  /**
   * Get all pending tasks (for debugging/testing)
   */
  getPendingTasks(): ComputationTask[] {
    return [...this.state.pending]
  }

  /**
   * Remove completed markers for the given task IDs so they can be re-enqueued
   */
  invalidateCompletedTasks(taskIds: string[]): void {
    if (taskIds.length === 0) return
    let removed = 0
    for (const id of taskIds) {
      if (this.state.completed.delete(id)) {
        removed++
      }
    }
    if (removed > 0) {
      this.notifyListeners()
    }
  }

  /**
   * Subscribe to state changes
   * @returns Unsubscribe function
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Clear completed task IDs for a session
   * Call this when a session is deleted to free memory
   */
  clearCompletedBySession(sessionId: string): void {
    const toRemove: string[] = []
    for (const id of this.state.completed) {
      const parts = id.split(':')
      if (parts[1] === sessionId) {
        toRemove.push(id)
      }
    }
    for (const id of toRemove) {
      this.state.completed.delete(id)
    }

    this.cancelledSessions.delete(sessionId)
  }

  /**
   * Process the queue - start tasks up to max concurrency
   */
  private processQueue(): void {
    if (!this.taskExecutor) return

    while (this.state.running.size < this.maxConcurrency && this.state.pending.length > 0) {
      const task = this.state.pending.shift()
      if (!task) break

      if (this.cancelledSessions.has(task.sessionId)) {
        continue
      }

      this.state.running.set(task.id, task)
      void this.executeTask(task)
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: ComputationTask): Promise<void> {
    if (!this.taskExecutor) return

    log.debug('Task execution started', { taskId: task.id, type: task.type })

    try {
      await this.taskExecutor(task)
      log.debug('Task execution completed', { taskId: task.id })
    } catch (error) {
      log.error('Task execution failed', { taskId: task.id, error })
    } finally {
      this.state.running.delete(task.id)

      if (!this.cancelledSessions.has(task.sessionId)) {
        this.state.completed.add(task.id)
      }

      if (this.taskIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.taskIntervalMs))
      }

      this.processQueue()
      this.notifyListeners()
    }
  }

  /**
   * Sort pending tasks by priority (lower = higher priority)
   */
  private sortPending(): void {
    this.state.pending.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }
      return a.createdAt - b.createdAt
    })
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // empty: listener errors should not break queue
      }
    }
  }

  /**
   * Start periodic cleanup of old completed task IDs
   * Keeps only the most recent 500 completed IDs to prevent memory bloat
   */
  startCleanup(): void {
    if (this.cleanupInterval) return
    log.debug('Starting cleanup interval')
    this.cleanupInterval = setInterval(() => {
      // Cleanup: When completed set exceeds 1000 entries, keep only the most recent 500
      if (this.state.completed.size > 1000) {
        const toKeep = Array.from(this.state.completed).slice(-500)
        this.state.completed = new Set(toKeep)
        log.debug('Cleanup executed', { completedCount: this.state.completed.size })
      }
    }, 60000) // Every minute
  }

  /**
   * Stop periodic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
      log.debug('Cleanup interval stopped')
    }
  }

  // ============================================================================
  // Testing Helpers
  // ============================================================================

  /**
   * Reset queue state (for testing only)
   */
  _reset(): void {
    this.state = {
      pending: [],
      running: new Map(),
      completed: new Set(),
    }
    this.cancelledSessions.clear()
    this.listeners.clear()
    this.taskExecutor = null
  }

  /**
   * Get internal state (for testing only)
   */
  _getState(): QueueState {
    return this.state
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const computationQueue = new ComputationQueue()
