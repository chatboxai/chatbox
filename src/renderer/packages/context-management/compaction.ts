import {
  type CompactionRequest,
  type CompactionRunOptions,
  CompactionService,
  type CompactionServiceResult,
  isAutoCompactionEnabled,
} from '@chatbox/core/application/context'
import { hasPendingSessionGeneration, withSessionGenerationLock } from '@chatbox/core/generation'
import type { SessionLockState } from '@chatbox/core/session/action-gates'
import { v4 as uuidv4 } from 'uuid'
import { withSessionWorkAccess } from '@/adapters/session-work-lock'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { settingsService } from '@/settings-runtime'
import { setCompactionUIState } from '@/stores/atoms/compactionAtoms'
import { getSessionLockStateNow } from '@/stores/session/action-guard'
import { getSessionAgentModeEntry } from '@/stores/session/agent-mode'
import { conversationAnchorIdOf, enqueueCompactionRequest, hasQueuedWork } from '@/stores/session/message-queue'
import { getSessionSettings } from '@/stores/session/session-settings'
import { estimateCompactionInputTokens } from '../token-estimation/compaction-input'
import { resolveTokenEstimationPolicy } from '../token-estimation/policy'
import { getCompactionContext } from './compaction-context'
import { checkOverflow } from './compaction-detector'
import { getConfiguredContextWindow } from './context-pressure'
import { generateSummaryWithStream } from './summary-generator'

const log = getLogger('compaction')

const compactionService = new CompactionService({
  sessions: {
    getSession: (sessionId) => rendererApplication.sessionQueryBridge.getSession(sessionId),
    getSessionSettings: (sessionId) => getSessionSettings(sessionId),
    updateSessionWithMessages: (sessionId, updater) =>
      rendererApplication.sessions.updateSessionWithMessages(sessionId, updater),
  },
  settings: settingsService,
  policy: {
    async shouldCompact({ sessionId, session, sessionSettings, globalSettings, pendingMessage }) {
      const providerId = session.settings?.provider ?? globalSettings.defaultChatModel?.provider
      const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
      if (!modelId) return false

      try {
        const model = providerId ? { provider: providerId, modelId } : undefined
        const policy = await resolveTokenEstimationPolicy(
          { ...sessionSettings, provider: providerId, modelId },
          getSessionAgentModeEntry(sessionId, session).value === 'on'
        )
        const contextTokens = await estimateCompactionInputTokens(
          session,
          pendingMessage,
          model,
          sessionSettings.maxContextMessageCount,
          policy
        )

        return checkOverflow({
          tokens: contextTokens,
          modelId,
          settings: { compactionThreshold: globalSettings.compactionThreshold },
          contextWindow: getConfiguredContextWindow(globalSettings, providerId, modelId),
        }).isOverflow
      } catch (error) {
        log.warn('Failed to estimate automatic compaction input', { sessionId, error })
        return false
      }
    },
    getCompactionContext(session, sessionSettings, pendingMessage) {
      return getCompactionContext(session, sessionSettings, pendingMessage)
    },
  },
  summaries: {
    generate: (input) => generateSummaryWithStream(input),
  },
  logger: {
    log(level, message, context) {
      log.log(level, message, context)
    },
  },
  createId: uuidv4,
})

export interface ManualCompactionOptions {
  force?: boolean
  prompt?: string
}

/**
 * `started` — the session was free and compression runs in the background.
 * `queued` — the request was persisted in the session queue. The remaining outcomes mean
 * the request was not accepted and the caller still holds it.
 */
export type ManualCompactionOutcome = 'started' | 'queued' | 'queue-full' | 'queue-failed'

export { isAutoCompactionEnabled }

export function isCompactionInProgress(sessionId: string): boolean {
  return compactionService.isInProgress(sessionId)
}

export function needsCompaction(sessionId: string): Promise<boolean> {
  return compactionService.needsCompaction(sessionId)
}

export async function runCompactionWithUIState(
  sessionId: string,
  request: CompactionRequest,
  options: CompactionRunOptions = {}
): Promise<CompactionServiceResult> {
  return (
    (await rendererApplication.backupOperations.runBackground(() =>
      withSessionWorkAccess(() => compactWithUIState(sessionId, request, options))
    )) ?? { status: 'skipped', reason: 'backup_busy' }
  )
}

/**
 * Conversation-state checks shared by admission and the locked decision.
 * Generation turn ownership is checked separately before acquiring the lock.
 */
function canCompressNow(sessionId: string, locks: SessionLockState | null): boolean {
  if (hasQueuedWork(sessionId)) return false
  if (!locks) return true
  return !locks.anyReplyGenerating && !locks.compactionRunning && !locks.awaitingPauseDecision
}

function enqueueManualCompaction(
  sessionId: string,
  request: { prompt?: string; force?: boolean },
  conversationAnchorId?: string
): ManualCompactionOutcome {
  const result = enqueueCompactionRequest(sessionId, request, conversationAnchorId)
  if (result === 'queued') return 'queued'
  return result === 'full' ? 'queue-full' : 'queue-failed'
}

/**
 * Start a compression the user asked for, or queue it when the session is busy.
 *
 * A compression rewrites the conversation prefix, so it must not run while a
 * reply streams into the same conversation: the summary would cover a
 * half-written answer, and that reply would keep writing past the boundary the
 * summary already covers. A busy session therefore queues the request, which
 * then runs in its turn through the session queue.
 */
export async function requestManualCompaction(
  sessionId: string,
  options: ManualCompactionOptions = {}
): Promise<ManualCompactionOutcome> {
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  const locks = await getSessionLockStateNow(sessionId, session)
  const request = { prompt: options.prompt, force: options.force === true }
  // Recorded before the lock is taken: the request is bound to the conversation
  // the user confirmed it in, not to whatever the session looks like later.
  const conversationAnchorId = session ? conversationAnchorIdOf(session) : undefined
  // Accepted submissions can own the generation turn before their placeholder
  // appears. Check ownership only before acquiring our own turn.
  if (hasPendingSessionGeneration(sessionId) || !canCompressNow(sessionId, locks)) {
    return enqueueManualCompaction(sessionId, request, conversationAnchorId)
  }

  return runAcceptedCompaction(sessionId, options, request, conversationAnchorId)
}

async function runAcceptedCompaction(
  sessionId: string,
  options: ManualCompactionOptions,
  request: { prompt?: string; force?: boolean },
  conversationAnchorId?: string
): Promise<ManualCompactionOutcome> {
  // Resolve the acceptance decision independently of the summary lifetime;
  // subsequent sends still wait for the complete generation turn.
  return new Promise((resolve, reject) => {
    let started = false
    const action = withSessionGenerationLock(sessionId, async () => {
      if (!canCompressNow(sessionId, await getSessionLockStateNow(sessionId))) {
        resolve(enqueueManualCompaction(sessionId, request, conversationAnchorId))
        return
      }
      started = true
      resolve('started')
      await runCompactionWithUIState(
        sessionId,
        { kind: options.force ? 'manual' : 'automatic' },
        { prompt: options.prompt }
      )
    })

    void action.catch((error: unknown) => {
      if (!started) {
        reject(error)
        return
      }
      setCompactionUIState(sessionId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        retryPrompt: options.prompt,
      })
      log.log('error', 'Manual compaction could not run', { error })
    })
  })
}

async function compactWithUIState(
  sessionId: string,
  request: CompactionRequest,
  options: CompactionRunOptions
): Promise<CompactionServiceResult> {
  if (compactionService.isInProgress(sessionId)) return { status: 'skipped', reason: 'busy' }
  if (options.abortSignal?.aborted) return { status: 'cancelled' }
  if (request.kind === 'automatic' && !(await compactionService.needsCompaction(sessionId, request.pendingMessage))) {
    return { status: 'skipped', reason: 'not_needed' }
  }
  setCompactionUIState(sessionId, {
    status: 'running',
    error: null,
    streamingText: '',
    summaryMessageId: null,
  })
  const result = await compactionService.run(sessionId, request, {
    ...options,
    onStreamUpdate: (text) => {
      setCompactionUIState(sessionId, { streamingText: text })
      options.onStreamUpdate?.(text)
    },
  })
  if (result.status === 'skipped' && result.reason === 'busy') return result
  switch (result.status) {
    case 'compacted':
      setCompactionUIState(sessionId, {
        status: 'completed',
        error: null,
        streamingText: '',
        summaryMessageId: result.summaryMessageId,
      })
      break
    case 'failed':
      setCompactionUIState(sessionId, {
        status: 'failed',
        error: result.failure.message,
        streamingText: '',
        summaryMessageId: null,
        retryPrompt: options.prompt,
      })
      break
    case 'skipped':
    case 'cancelled':
      setCompactionUIState(sessionId, {
        status: 'idle',
        error: null,
        streamingText: '',
        summaryMessageId: null,
      })
      break
  }
  return result
}
