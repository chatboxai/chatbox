import {
  finishAbortedGeneration,
  type GenerationRuntimeState,
  type GenerationRuntimeStore,
} from '@chatbox/core/generation'
import { getCurrentConversationMessages } from '@chatbox/core/session/generation-state'
import { findMessageLocation } from '@shared/session/message-forks'
import type { Message, Session } from '@shared/types'

export { cancelRunningToolCallBatch, finishAbortedGeneration } from '@chatbox/core/generation'

export interface GenerationCancellationDependencies {
  runtime: Pick<GenerationRuntimeStore, 'beginStop' | 'clear' | 'get' | 'list' | 'requestAbort'>
  getSession: (sessionId: string) => Promise<Session | null>
  removeMessage: (sessionId: string, messageId: string) => Promise<void>
  persistMessage: (sessionId: string, message: Message) => Promise<void>
}

const sessionStopTasks = new Map<string, Promise<void>>()

function serializeSessionStop(sessionId: string, operation: () => Promise<void>): Promise<void> {
  const previous = sessionStopTasks.get(sessionId)
  const task = previous ? previous.catch(() => {}).then(operation) : operation()
  let trackedTask: Promise<void>
  trackedTask = task.finally(() => {
    if (sessionStopTasks.get(sessionId) === trackedTask) sessionStopTasks.delete(sessionId)
  })
  sessionStopTasks.set(sessionId, trackedTask)
  return trackedTask
}

async function getDefaultDependencies(): Promise<GenerationCancellationDependencies> {
  const [{ rendererApplication }, { modifyMessage, removeMessage }] = await Promise.all([
    import('@/app/renderer-application'),
    import('./messages'),
  ])
  return {
    runtime: rendererApplication.generationRuntime,
    getSession: (sessionId) => rendererApplication.sessionQueryBridge.getSession(sessionId),
    removeMessage,
    persistMessage: (sessionId, message) => modifyMessage(sessionId, message, true),
  }
}

async function finalizeMessages(
  sessionId: string,
  messageIds: ReadonlySet<string>,
  session: Session,
  dependencies: GenerationCancellationDependencies,
  stoppedAt: number
): Promise<void> {
  const updates: Promise<void>[] = []
  for (const messageId of messageIds) {
    const location = findMessageLocation(session, messageId)
    if (!location) continue
    const message = location.list[location.index]
    if (!message.generating) continue
    updates.push(
      message.contentParts.length === 0
        ? dependencies.removeMessage(sessionId, message.id)
        : dependencies.persistMessage(sessionId, finishAbortedGeneration(message, message.contentParts, stoppedAt))
    )
  }

  const results = await Promise.allSettled(updates)
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to persist one or more stopped generations')
  }
}

export function stopMessageGeneration(
  sessionId: string,
  messageId: string,
  dependencies?: GenerationCancellationDependencies,
  stoppedAt = Date.now()
): Promise<void> {
  return serializeSessionStop(sessionId, async () => {
    const resolvedDependencies = dependencies ?? (await getDefaultDependencies())
    const initialRuntime = resolvedDependencies.runtime.get(sessionId, messageId)
    if (initialRuntime?.phase === 'paused') return
    let stoppingRuntime = initialRuntime
      ? resolvedDependencies.runtime.beginStop(sessionId, messageId, stoppedAt, initialRuntime)
      : undefined
    try {
      const session = await resolvedDependencies.getSession(sessionId)
      if (!session) return
      const location = findMessageLocation(session, messageId)
      if (!location?.list[location.index].generating) return

      // A placeholder can register its controller while the Session read is in
      // flight. Re-read the runtime so that late registration also retains the
      // generation lock until terminal persistence settles.
      const currentRuntime = resolvedDependencies.runtime.get(sessionId, messageId)
      if (currentRuntime?.phase === 'paused') return
      if (currentRuntime && currentRuntime !== stoppingRuntime) {
        stoppingRuntime = resolvedDependencies.runtime.beginStop(sessionId, messageId, stoppedAt, currentRuntime)
      } else if (!currentRuntime) {
        resolvedDependencies.runtime.requestAbort(sessionId, messageId, stoppedAt)
      }
      await finalizeMessages(sessionId, new Set([messageId]), session, resolvedDependencies, stoppedAt)
    } finally {
      if (stoppingRuntime) {
        resolvedDependencies.runtime.clear(sessionId, messageId, stoppingRuntime)
      }
    }
  })
}

export function stopAllMessageGenerations(
  sessionId: string,
  dependencies?: GenerationCancellationDependencies,
  stoppedAt = Date.now()
): Promise<void> {
  return serializeSessionStop(sessionId, async () => {
    const resolvedDependencies = dependencies ?? (await getDefaultDependencies())
    const activeRuntimes = resolvedDependencies.runtime.list(sessionId).filter((runtime) => runtime.phase !== 'paused')
    const stoppingRuntimes = new Map<string, GenerationRuntimeState>()
    for (const runtime of activeRuntimes) {
      const stopping = resolvedDependencies.runtime.beginStop(sessionId, runtime.messageId, stoppedAt, runtime)
      if (stopping) stoppingRuntimes.set(runtime.messageId, stopping)
    }

    try {
      // Read after aborting so the terminal write is derived from the freshest
      // cache projection instead of a Message snapshot captured by the UI.
      const session = await resolvedDependencies.getSession(sessionId)
      if (!session) return
      const messageIds = new Set(activeRuntimes.map((runtime) => runtime.messageId))
      for (const runtime of resolvedDependencies.runtime.list(sessionId)) {
        if (runtime.phase === 'paused') continue
        const stopping = resolvedDependencies.runtime.beginStop(sessionId, runtime.messageId, stoppedAt, runtime)
        if (stopping) stoppingRuntimes.set(runtime.messageId, stopping)
        messageIds.add(runtime.messageId)
      }
      const activeRuntimeMessageIds = new Set(messageIds)
      for (const message of getCurrentConversationMessages(session)) {
        if (message.role === 'assistant' && message.generating) messageIds.add(message.id)
      }
      for (const messageId of messageIds) {
        if (!activeRuntimeMessageIds.has(messageId)) {
          resolvedDependencies.runtime.requestAbort(sessionId, messageId, stoppedAt)
        }
      }
      await finalizeMessages(sessionId, messageIds, session, resolvedDependencies, stoppedAt)
    } finally {
      for (const [messageId, runtime] of stoppingRuntimes) {
        resolvedDependencies.runtime.clear(sessionId, messageId, runtime)
      }
    }
  })
}
