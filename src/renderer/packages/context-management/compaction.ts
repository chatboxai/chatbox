import {
  CompactionService,
  type CompactionServiceResult,
  isAutoCompactionEnabled,
} from '@chatbox/core/application/context'
import { hasPendingSessionGeneration, withSessionGenerationLock } from '@chatbox/core/generation'
import type { SessionLockState } from '@chatbox/core/session/action-gates'
import type { Message } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { withSessionWorkAccess } from '@/adapters/session-work-lock'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { getTokenizerType } from '@/packages/token-estimation'
import { settingsService } from '@/settings-runtime'
import { setCompactionUIState } from '@/stores/atoms/compactionAtoms'
import queryClient from '@/stores/queryClient'
import { getSessionLockStateNow } from '@/stores/session/action-guard'
import { conversationAnchorIdOf, enqueueCompactionRequest, hasQueuedWork } from '@/stores/session/message-queue'
import { getSessionSettings } from '@/stores/session/session-settings'
import { sumCachedTokensFromMessages } from '../token'
import { getCompactionContext } from './compaction-context'
import { checkOverflow } from './compaction-detector'
import { getConfiguredContextWindow } from './context-pressure'
import {
  type ContextTokensCacheValue,
  getContextMessagesForTokenEstimation,
  getContextTokensCacheKey,
  getLatestCompactionBoundaryId,
} from './context-tokens'
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
    async shouldCompact({ sessionId, session, sessionSettings, globalSettings }) {
      const providerId = session.settings?.provider ?? globalSettings.defaultChatModel?.provider
      const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
      if (!modelId) return false

      const maxContextMessageCount = sessionSettings.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER
      const contextMessages = getContextMessagesForTokenEstimation(session, { settings: sessionSettings })
      const tokenizerType = getTokenizerType(providerId && modelId ? { provider: providerId, modelId } : undefined)
      const cacheKey = getContextTokensCacheKey({
        sessionId,
        maxContextMessageCount,
        latestContextMessageId: contextMessages[contextMessages.length - 1]?.id ?? null,
        latestCompactionBoundaryId: getLatestCompactionBoundaryId(session.compactionPoints),
        tokenizerType,
      })

      let contextTokens = queryClient.getQueryData<ContextTokensCacheValue>(cacheKey)?.contextTokens
      if (contextTokens === undefined) {
        const sandboxMode = contextMessages.some((message) => message.files?.length)
        contextTokens = sumCachedTokensFromMessages(contextMessages, undefined, sandboxMode)
        queryClient.setQueryData(cacheKey, {
          contextTokens,
          messageCount: contextMessages.length,
          timestamp: Date.now(),
        })
      }

      return checkOverflow({
        tokens: contextTokens,
        modelId,
        settings: { compactionThreshold: globalSettings.compactionThreshold },
        contextWindow: getConfiguredContextWindow(globalSettings, providerId, modelId),
      }).isOverflow
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

export interface CompactionOptions {
  target?: { targetMessageId: string; boundaryMessageId: string }
  pendingMessage?: Message
  force?: boolean
  prompt?: string
  abortSignal?: AbortSignal
}

export interface CompactionResult {
  success: boolean
  compacted: boolean
  error?: Error
  summaryMessageId?: string
  summary?: string
  boundaryMessageId?: string
  /** Another compaction for this session was already streaming. */
  alreadyRunning?: boolean
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
  options: CompactionOptions = {}
): Promise<CompactionResult> {
  return (
    (await rendererApplication.backupOperations.runBackground(() =>
      withSessionWorkAccess(() => compactWithUIState(sessionId, options))
    )) ?? { success: true, compacted: false }
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
  options: CompactionOptions = {}
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
  options: CompactionOptions,
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
      await runCompactionWithUIState(sessionId, options)
    })

    void action.catch((error: unknown) => {
      if (!started) {
        reject(error)
        return
      }
      setCompactionUIState(sessionId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      log.log('error', 'Manual compaction could not run', { error })
    })
  })
}

async function compactWithUIState(sessionId: string, options: CompactionOptions = {}): Promise<CompactionResult> {
  if (compactionService.isInProgress(sessionId)) {
    return { success: true, compacted: false, alreadyRunning: true }
  }
  if (!options.force && !(await compactionService.needsCompaction(sessionId))) {
    return { success: true, compacted: false }
  }

  setCompactionUIState(sessionId, {
    status: 'running',
    error: null,
    streamingText: '',
    summaryMessageId: null,
  })
  // The pre-check above is only a cheap fast-path for UI state; pass the
  // caller's real `force` through so the auto path is re-validated inside
  // run() (behind its ongoing-set), closing the window where the session
  // changes between the two checks and gets compacted twice.
  const result = mapResult(
    await compactionService.run(sessionId, {
      force: options.force === true,
      prompt: options.prompt,
      pendingMessage: options.pendingMessage,
      abortSignal: options.abortSignal,
      target: options.target,
      onStreamUpdate: (text) => setCompactionUIState(sessionId, { streamingText: text }),
    })
  )

  if (result.alreadyRunning) {
    return result
  }

  if (result.success && result.compacted && result.summaryMessageId) {
    setCompactionUIState(sessionId, {
      status: 'completed',
      error: null,
      streamingText: '',
      summaryMessageId: result.summaryMessageId,
    })
  } else if (result.success) {
    setCompactionUIState(sessionId, {
      status: 'idle',
      error: null,
      streamingText: '',
      summaryMessageId: null,
    })
  } else {
    setCompactionUIState(sessionId, {
      status: 'failed',
      error: result.error?.message ?? 'Compaction failed',
      streamingText: '',
      summaryMessageId: null,
    })
  }
  return result
}

function mapResult(result: CompactionServiceResult): CompactionResult {
  if (!result.failure)
    return {
      success: result.success,
      compacted: result.compacted,
      summaryMessageId: result.summaryMessageId,
      summary: result.summary,
      boundaryMessageId: result.boundaryMessageId,
      alreadyRunning: result.alreadyRunning,
    }
  return {
    success: result.success,
    compacted: result.compacted,
    error: result.failure.cause instanceof Error ? result.failure.cause : new Error(result.failure.message),
    summaryMessageId: result.summaryMessageId,
    summary: result.summary,
    boundaryMessageId: result.boundaryMessageId,
  }
}
