import {
  CompactionService,
  type CompactionServiceResult,
  isAutoCompactionEnabled,
} from '@chatbox/core/application/context'
import { v4 as uuidv4 } from 'uuid'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { getTokenizerType } from '@/packages/token-estimation'
import { settingsService } from '@/settings-runtime'
import { setCompactionUIState } from '@/stores/atoms/compactionAtoms'
import queryClient from '@/stores/queryClient'
import { getSessionSettings } from '@/stores/session/session-settings'
import { sumCachedTokensFromMessages } from '../token'
import { checkOverflow, getCompactionThresholdTokens } from './compaction-detector'
import { getConfiguredContextWindow } from './context-pressure'
import {
  type ContextTokensCacheValue,
  getContextMessagesForTokenEstimation,
  getContextTokensCacheKey,
  getLatestCompactionBoundaryId,
} from './context-tokens'
import { generateSummaryWithStream } from './summary-generator'

const log = getLogger('compaction')

/**
 * Fraction of the compaction threshold the raw tail may occupy after a
 * compaction. Keeps "summary + tail" comfortably below the threshold so a
 * single compaction per submit is always enough.
 */
const RAW_TAIL_BUDGET_RATIO = 0.5

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
    // Full-fidelity context: the service derives the boundary and the
    // summarizer input from this list, so tool calls/results must be intact
    // and the message-count limit must NOT apply — the compaction point cuts
    // everything before the boundary in the persisted list, so the summary has
    // to be able to cover messages outside the current send window (otherwise
    // raising maxContextMessageCount later can never bring them back).
    getCompactionContext: (session, sessionSettings) =>
      getContextMessagesForTokenEstimation(session, {
        settings: { ...sessionSettings, maxContextMessageCount: undefined },
      }),
    getBoundaryOptions(session, _sessionSettings, globalSettings) {
      const providerId = session.settings?.provider ?? globalSettings.defaultChatModel?.provider
      const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
      if (!modelId) return {}
      const thresholdTokens = getCompactionThresholdTokens(
        modelId,
        { compactionThreshold: globalSettings.compactionThreshold },
        getConfiguredContextWindow(globalSettings, providerId, modelId)
      )
      if (thresholdTokens === null) return {}
      const tokenModel = providerId ? { provider: providerId, modelId } : undefined
      return {
        maxTailTokens: Math.floor(thresholdTokens * RAW_TAIL_BUDGET_RATIO),
        // sandboxMode=false on purpose: whether attachments go out as sandbox
        // metadata depends on code-execution availability, which this layer
        // cannot know. Counting full inline weight is the conservative
        // direction for a budget — sandbox sessions merely get a slightly
        // shorter tail, while metadata-weight estimation would let a huge
        // attachment ride in the tail and keep the request over the window.
        estimateMessagesTokens: (messages) => sumCachedTokensFromMessages(messages, tokenModel, false),
      }
    },
  },
  summaries: {
    generate: ({ messages, sessionSettings, language, onStreamUpdate }) =>
      generateSummaryWithStream({ messages, sessionSettings, language, onStreamUpdate }),
  },
  logger: {
    log(level, message, context) {
      log.log(level, message, context)
    },
  },
  createId: uuidv4,
})

export interface CompactionOptions {
  force?: boolean
}

export interface CompactionResult {
  success: boolean
  compacted: boolean
  error?: Error
  summaryMessageId?: string
  /** Another compaction for this session was already streaming. */
  alreadyRunning?: boolean
}

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
  if (!result.failure) return result
  return {
    success: result.success,
    compacted: result.compacted,
    error: result.failure.cause instanceof Error ? result.failure.cause : new Error(result.failure.message),
    summaryMessageId: result.summaryMessageId,
  }
}
