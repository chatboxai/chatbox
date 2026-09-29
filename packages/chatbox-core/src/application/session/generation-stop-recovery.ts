import type {
  GenerationRuntimeState,
  GenerationRuntimeStore,
  GenerationSessionStopGate,
} from '../../generation/runtime-store'
import { findMessageLocation } from '../../session/message-forks'
import { getCurrentConversationMessages } from '../../session/generation-state'
import type { Session } from '../../types'
import type { SessionEventBus } from './session-events'

export type GenerationStopRecoveryRuntime = Pick<
  GenerationRuntimeStore,
  'get' | 'list' | 'clear' | 'clearSessionStop' | 'isSessionStopRequested' | 'subscribe'
>

interface GenerationStopRecoveryOptions {
  runtime: GenerationStopRecoveryRuntime
  events: Pick<SessionEventBus, 'subscribe'>
  sessionId: string
  targetMessageId?: string
  stopGate?: GenerationSessionStopGate
  preparationBarrier?: Promise<void>
  stoppingRuntimes: ReadonlyMap<string, GenerationRuntimeState>
}

const recoveries = new WeakMap<GenerationStopRecoveryRuntime, Map<string, Map<string | undefined, () => void>>>()

/**
 * Observe durable Session writes before aborting. A generation's terminal write
 * can finish either before or after the Stop command reports a storage failure.
 * Failed attempts keep one observer per target until persistence or a retry
 * resolves them; a new Stop-all supersedes every older attempt in that session.
 */
export function createGenerationStopRecovery(options: GenerationStopRecoveryOptions) {
  const { runtime, events, sessionId, targetMessageId, stopGate, stoppingRuntimes } = options
  const sessions = recoveries.get(runtime) ?? new Map<string, Map<string | undefined, () => void>>()
  recoveries.set(runtime, sessions)
  const targets = sessions.get(sessionId) ?? new Map<string | undefined, () => void>()
  sessions.set(sessionId, targets)
  if (stopGate) for (const dispose of [...targets.values()]) dispose()
  else targets.get(targetMessageId)?.()
  // Disposing a previous attempt can remove the empty session registry.
  sessions.set(sessionId, targets)

  let disposed = false
  let failed = false
  let reconciling = false
  let preparationFinished = !options.preparationBarrier
  let durableSession: Session | null | undefined
  let unsubscribeEvents = () => {}
  let unsubscribeRuntime = () => {}
  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribeEvents()
    unsubscribeRuntime()
    if (targets.get(targetMessageId) === dispose) targets.delete(targetMessageId)
    if (!targets.size) sessions.delete(sessionId)
  }
  targets.set(targetMessageId, dispose)

  const reconcile = () => {
    if (disposed || reconciling) return
    if (stopGate && !runtime.isSessionStopRequested(sessionId, stopGate)) {
      dispose()
      return
    }
    if (!failed) return
    for (const [messageId, expected] of stoppingRuntimes) {
      const current = runtime.get(sessionId, messageId)
      if (current && (current.abortController !== expected.abortController || current.phase !== 'stopping')) {
        dispose()
        return
      }
    }
    if (!stopGate && ![...stoppingRuntimes.keys()].some((id) => runtime.get(sessionId, id))) {
      dispose()
      return
    }
    if (durableSession === undefined) return
    const isTerminal = (messageId: string) => {
      if (!durableSession) return true
      const location = findMessageLocation(durableSession, messageId)
      return !location?.list[location.index].generating
    }
    reconciling = true
    try {
      for (const [messageId, expected] of stoppingRuntimes) {
        if (isTerminal(messageId)) runtime.clear(sessionId, messageId, expected)
      }
      if (stopGate) {
        const hasGeneratingMessage =
          durableSession &&
          getCurrentConversationMessages(durableSession).some(
            (message) =>
              message.role === 'assistant' &&
              message.generating &&
              runtime.get(sessionId, message.id)?.phase !== 'paused'
          )
        if (
          !preparationFinished ||
          hasGeneratingMessage ||
          [...stoppingRuntimes.keys()].some((id) => !isTerminal(id)) ||
          runtime.list(sessionId).some((state) => state.phase !== 'paused')
        )
          return
        runtime.clearSessionStop(sessionId, stopGate)
      } else if (targetMessageId && !isTerminal(targetMessageId)) return
      dispose()
    } finally {
      reconciling = false
    }
  }

  unsubscribeEvents = events.subscribe((event) => {
    if (event.type === 'session-updated' && event.session.id === sessionId) durableSession = event.session
    else if (event.type === 'session-deleted' && event.ids.includes(sessionId)) durableSession = null
    else return
    reconcile()
  })
  unsubscribeRuntime = runtime.subscribe(reconcile)
  if (options.preparationBarrier) {
    void options.preparationBarrier.then(() => {
      preparationFinished = true
      reconcile()
    }, dispose)
  }
  return {
    dispose,
    recover() {
      failed = true
      reconcile()
    },
  }
}
