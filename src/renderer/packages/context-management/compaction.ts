import {
  CompactionService,
  type CompactionServiceResult,
  isAutoCompactionEnabled,
} from '@chatbox/core/application/context'
import type { Message } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { createModel } from '@/adapters'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { getTokenizerType } from '@/packages/token-estimation'
import platform from '@/platform'
import { createSandboxProvider } from '@/sandbox'
import { resolveContextSandbox } from '@/sandbox/context'
import { settingsService } from '@/settings-runtime'
import { setCompactionUIState } from '@/stores/atoms/compactionAtoms'
import queryClient from '@/stores/queryClient'
import { getSessionAgentModeEntry } from '@/stores/session/agent-mode'
import { getSessionSettings } from '@/stores/session/session-settings'
import { isPro } from '@/stores/settingActions'
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
    async getCompactionContext(session, sessionSettings, pendingMessage) {
      let sandboxMode = false
      if (platform.isDesktopLike && getSessionAgentModeEntry(session.id, session).value === 'on') {
        const model = await createModel(sessionSettings)
        const capabilities = await resolveContextSandbox({
          enabled: model.isSupportToolUse('agent'),
          model,
          settings: sessionSettings,
          createProvider: createSandboxProvider,
          isPro,
        })
        sandboxMode = capabilities.canExecuteCode
      }
      return getCompactionContext(session, sessionSettings, settingsService.getSettings(), pendingMessage, sandboxMode)
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
  pendingMessage?: Message
  force?: boolean
  prompt?: string
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
      prompt: options.prompt,
      pendingMessage: options.pendingMessage,
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
