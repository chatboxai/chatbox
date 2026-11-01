import type {
  GenerationRuntimeState,
  GenerationRuntimeStore,
  GenerationSessionStopGate,
} from '../../generation/runtime-store'
import type { SessionEventBus } from './session-events'

export type GenerationStopRecoveryRuntime = Pick<
  GenerationRuntimeStore,
  'get' | 'list' | 'clear' | 'clearSessionStop' | 'isSessionStopRequested' | 'subscribe'
>

export interface GenerationStopRecoveryDurableState {
  generatingMessageIds: readonly string[]
  currentConversationGeneratingCount: number
}

interface GenerationStopRecoveryOptions {
  runtime: GenerationStopRecoveryRuntime
  events: Pick<SessionEventBus, 'subscribe'>
  sessionId: string
  targetMessageId?: string
  stopGate?: GenerationSessionStopGate
  preparationBarrier?: Promise<void>
  readDurableState: () => Promise<GenerationStopRecoveryDurableState | null>
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
  let durableEpoch = 0
  let needsDurableRead = true
  let readingDurable = false
  let durableState: GenerationStopRecoveryDurableState | null | undefined
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
    if (durableState === undefined) return
    const isTerminal = (messageId: string) => !durableState?.generatingMessageIds.includes(messageId)
    reconciling = true
    try {
      for (const [messageId, expected] of stoppingRuntimes) {
        if (isTerminal(messageId)) runtime.clear(sessionId, messageId, expected)
      }
      if (stopGate) {
        const hasGeneratingMessage = (durableState?.currentConversationGeneratingCount ?? 0) > 0
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

  const refreshDurableState = () => {
    if (disposed || !failed || !needsDurableRead || readingDurable || !options.readDurableState) return
    readingDurable = true
    needsDurableRead = false
    const epoch = durableEpoch
    void options
      .readDurableState()
      .then(
        (session) => {
          if (disposed || epoch !== durableEpoch) return
          durableState = session
          reconcile()
        },
        () => {
          // Keep the stop gate closed until a later durable write or explicit retry.
        }
      )
      .finally(() => {
        readingDurable = false
        refreshDurableState()
      })
  }

  unsubscribeEvents = events.subscribe((event) => {
    if (event.type === 'session-command-committed' && event.delta.sessionId === sessionId) {
      durableEpoch += 1
      durableState = undefined
      needsDurableRead = true
      refreshDurableState()
      return
    }
    if (event.type === 'session-deleted' && event.ids.includes(sessionId)) durableState = null
    else return
    durableEpoch += 1
    needsDurableRead = false
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
      refreshDurableState()
    },
  }
}
