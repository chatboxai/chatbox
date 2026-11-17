import { createGenerationStopRecovery, type SessionEventBus } from '@chatbox/core/application/session'
import {
  finishAbortedGeneration,
  type GenerationRuntimeState,
  type GenerationRuntimeStore,
} from '@chatbox/core/generation'
import type { Message } from '@shared/types'
import { rendererApplication } from '@/app/renderer-application'
import { SessionRowConflictError } from '@chatbox/core/ports'

export { cancelRunningToolCallBatch, finishAbortedGeneration } from '@chatbox/core/generation'

export interface GenerationCancellationDependencies {
  runtime: Pick<
    GenerationRuntimeStore,
    | 'beginSessionStop'
    | 'beginStop'
    | 'clear'
    | 'clearSessionStop'
    | 'get'
    | 'getLiveMessage'
    | 'list'
    | 'subscribe'
    | 'isSessionStopRequested'
    | 'requestAbort'
    | 'waitForGenerationPreparationLeases'
  >
  sessionEvents: Pick<SessionEventBus, 'subscribe'>
  readState: (
    sessionId: string,
    messageIds: readonly string[],
    includePersisted: boolean
  ) => Promise<{
    messages: Message[]
    generatingMessageIds: readonly string[]
    currentConversationGeneratingCount: number
  } | null>
  removeMessage: (sessionId: string, messageId: string) => Promise<void>
  persistMessage: (sessionId: string, message: Message) => Promise<void>
}

const sessionStopTasks = new Map<string, Promise<void>>()

async function readStopState<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read()
    } catch (error) {
      if (!(error instanceof SessionRowConflictError) || attempt >= 2) throw error
    }
  }
}

function serializeSessionStop(sessionId: string, operation: () => Promise<void>): Promise<void> {
  const previous = sessionStopTasks.get(sessionId)
  const task = previous ? previous.catch(() => {}).then(operation) : operation()
  const trackedTask = task.finally(() => {
    if (sessionStopTasks.get(sessionId) === trackedTask) sessionStopTasks.delete(sessionId)
  })
  sessionStopTasks.set(sessionId, trackedTask)
  return trackedTask
}

async function getDefaultDependencies(): Promise<GenerationCancellationDependencies> {
  const { persistStreamingMessage, removeMessage } = await import('./messages')
  return {
    runtime: rendererApplication.generationRuntime,
    sessionEvents: rendererApplication.sessionEvents,
    async readState(sessionId, messageIds, includePersisted) {
      const control = await rendererApplication.sessions.readSessionGenerationControl({
        sessionId,
        activeGenerationMessageIds: messageIds,
        includePersisted,
      })
      if (!control) return null
      const ids = [...new Set([...messageIds, ...control.cancellableMessageIds])]
      const read = await rendererApplication.sessions.readSessionMessages({
        sessionId,
        messageIds: ids,
        expectedRevision: control.revision,
      })
      if (!read) return null
      const messages = read.messages.map((message) =>
        message.generating
          ? (rendererApplication.generationRuntime.getLiveMessage(sessionId, message.id) ?? message)
          : message
      )
      return {
        messages,
        generatingMessageIds: read.messages.filter((message) => message.generating).map((message) => message.id),
        currentConversationGeneratingCount: control.anyReplyGenerating ? 1 : 0,
      }
    },
    removeMessage,
    persistMessage: (sessionId, message) =>
      persistStreamingMessage(sessionId, message, { refreshCounting: true, onlyIfGenerating: true }),
  }
}

async function finalizeMessages(
  sessionId: string,
  messageIds: ReadonlySet<string>,
  messages: Message[],
  dependencies: GenerationCancellationDependencies,
  stoppedAt: number
): Promise<void> {
  const updates: Promise<void>[] = []
  for (const messageId of messageIds) {
    const message = messages.find((message) => message.id === messageId)
    if (!message) continue
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
  const runtime = dependencies?.runtime ?? rendererApplication.generationRuntime
  const initialRuntime = runtime.get(sessionId, messageId)
  if (initialRuntime?.phase === 'paused') return Promise.resolve()
  const stoppingRuntimes = new Map<string, GenerationRuntimeState>()
  const recovery = createGenerationStopRecovery({
    runtime,
    events: dependencies?.sessionEvents ?? rendererApplication.sessionEvents,
    sessionId,
    targetMessageId: messageId,
    stoppingRuntimes,
    readDurableState: async () => {
      const resolved = dependencies ?? (await getDefaultDependencies())
      return readStopState(() => resolved.readState(sessionId, [...stoppingRuntimes.keys(), messageId], false))
    },
  })
  let stoppingRuntime = initialRuntime ? runtime.beginStop(sessionId, messageId, stoppedAt, initialRuntime) : undefined
  if (stoppingRuntime) stoppingRuntimes.set(messageId, stoppingRuntime)

  return serializeSessionStop(sessionId, async () => {
    const resolvedDependencies = dependencies ?? (await getDefaultDependencies())
    let canReleaseRuntime = false
    try {
      const session = await readStopState(() => resolvedDependencies.readState(sessionId, [messageId], false))
      if (!session) {
        canReleaseRuntime = true
        return
      }
      const message = session.messages.find((message) => message.id === messageId)
      if (!message?.generating) {
        canReleaseRuntime = true
        return
      }

      // A placeholder can register its controller while the row read is in
      // flight. Re-read the runtime so that late registration also retains the
      // generation lock until terminal persistence settles.
      const currentRuntime = resolvedDependencies.runtime.get(sessionId, messageId)
      if (currentRuntime?.phase === 'paused') {
        recovery.dispose()
        return
      }
      if (currentRuntime && currentRuntime !== stoppingRuntime) {
        stoppingRuntime = resolvedDependencies.runtime.beginStop(sessionId, messageId, stoppedAt, currentRuntime)
        if (stoppingRuntime) stoppingRuntimes.set(messageId, stoppingRuntime)
      } else if (!currentRuntime) {
        resolvedDependencies.runtime.requestAbort(sessionId, messageId, stoppedAt)
      }
      await finalizeMessages(sessionId, new Set([messageId]), session.messages, resolvedDependencies, stoppedAt)
      canReleaseRuntime = true
    } finally {
      if (canReleaseRuntime) {
        recovery.dispose()
        if (stoppingRuntime) resolvedDependencies.runtime.clear(sessionId, messageId, stoppingRuntime)
      } else recovery.recover()
    }
  })
}

export function stopAllMessageGenerations(
  sessionId: string,
  dependencies?: GenerationCancellationDependencies,
  stoppedAt = Date.now()
): Promise<void> {
  const runtime = dependencies?.runtime ?? rendererApplication.generationRuntime
  const stopGate = runtime.beginSessionStop(sessionId, stoppedAt)
  const preparationBarrier = runtime.waitForGenerationPreparationLeases(sessionId)
  const activeRuntimes = runtime.list(sessionId).filter((candidate) => candidate.phase !== 'paused')
  const stoppingRuntimes = new Map<string, GenerationRuntimeState>()
  const recovery = createGenerationStopRecovery({
    runtime,
    events: dependencies?.sessionEvents ?? rendererApplication.sessionEvents,
    sessionId,
    stopGate,
    preparationBarrier,
    stoppingRuntimes,
    readDurableState: async () => {
      const resolved = dependencies ?? (await getDefaultDependencies())
      return readStopState(() => resolved.readState(sessionId, [...stoppingRuntimes.keys()], true))
    },
  })
  for (const activeRuntime of activeRuntimes) {
    const stopping = runtime.beginStop(sessionId, activeRuntime.messageId, stoppedAt, activeRuntime)
    if (stopping) stoppingRuntimes.set(activeRuntime.messageId, stopping)
  }

  return serializeSessionStop(sessionId, async () => {
    const resolvedDependencies = dependencies ?? (await getDefaultDependencies())
    await preparationBarrier
    for (const currentRuntime of resolvedDependencies.runtime.list(sessionId)) {
      if (currentRuntime.phase === 'paused') continue
      const stopping = resolvedDependencies.runtime.beginStop(
        sessionId,
        currentRuntime.messageId,
        stoppedAt,
        currentRuntime
      )
      if (stopping) stoppingRuntimes.set(currentRuntime.messageId, stopping)
    }

    let canReleaseRuntimes = false
    try {
      // Read after aborting so the terminal write is derived from the freshest
      // active stream state independent of mounted transcript pages.
      const session = await readStopState(() =>
        resolvedDependencies.readState(sessionId, [...stoppingRuntimes.keys()], true)
      )
      if (!session) {
        canReleaseRuntimes = true
        return
      }
      const messageIds = new Set(activeRuntimes.map((activeRuntime) => activeRuntime.messageId))
      for (const currentRuntime of resolvedDependencies.runtime.list(sessionId)) {
        if (currentRuntime.phase === 'paused') continue
        const stopping = resolvedDependencies.runtime.beginStop(
          sessionId,
          currentRuntime.messageId,
          stoppedAt,
          currentRuntime
        )
        if (stopping) stoppingRuntimes.set(currentRuntime.messageId, stopping)
        messageIds.add(currentRuntime.messageId)
      }
      const activeRuntimeMessageIds = new Set(messageIds)
      for (const message of session.messages) {
        if (message.role === 'assistant' && message.generating) messageIds.add(message.id)
      }
      for (const messageId of messageIds) {
        if (!activeRuntimeMessageIds.has(messageId)) {
          resolvedDependencies.runtime.requestAbort(sessionId, messageId, stoppedAt)
        }
      }
      await finalizeMessages(sessionId, messageIds, session.messages, resolvedDependencies, stoppedAt)
      canReleaseRuntimes = true
    } finally {
      if (canReleaseRuntimes) {
        recovery.dispose()
        for (const [messageId, runtime] of stoppingRuntimes) {
          resolvedDependencies.runtime.clear(sessionId, messageId, runtime)
        }
        resolvedDependencies.runtime.clearSessionStop(sessionId, stopGate)
      } else recovery.recover()
    }
  })
}
