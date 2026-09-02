import { flattenToolCallPartsToText } from '@shared/context/tool-flatten'
import type { LoggerPort, SettingsRepositoryPort } from '../../ports'
import type { Message, Session, SessionSettings, Settings } from '../../types'
import {
  type CompactionBoundaryOptions,
  findCompactionBoundaryMessage,
  findLastCompactionBoundaryMessage,
} from './compaction-boundary'
import { buildCompactionCommitPatch } from './compaction-commit'

/**
 * Upper bound on messages one compaction may cover. The compaction context is
 * unlimited by design (the point cuts everything before the boundary, so the
 * summary must cover it), but a very old, never-compacted session could blow
 * the summarizer's own window. Instead of truncating the summarizer INPUT
 * (which would let the point silently cut content — possibly the previous
 * summary itself — that no summary ever saw), the BOUNDARY is capped: each
 * compaction absorbs at most this many messages, and long histories converge
 * over successive compactions, one chunk per submit.
 */
const MAX_SUMMARY_COVERED_MESSAGES = 200

export interface CompactionSessionPort {
  getSession(sessionId: string): Promise<Session | null>
  getSessionSettings(sessionId: string): Promise<SessionSettings>
  updateSessionWithMessages(
    sessionId: string,
    updater: (session: Session | null | undefined) => Session
  ): Promise<Session>
}

export interface CompactionPolicyPort {
  shouldCompact(input: {
    sessionId: string
    session: Session
    sessionSettings: SessionSettings
    globalSettings: Settings
  }): Promise<boolean>
  /**
   * The current context selection at full fidelity (tool calls and results
   * intact, no cleanup, no message-count limit). The service derives both the
   * compaction boundary and the summarizer input from this list, so anything
   * missing here is unrecoverable by the summary.
   */
  getCompactionContext(session: Session, sessionSettings: SessionSettings): Message[]
  /**
   * Token budget and estimator for the raw tail kept after compaction; without
   * it the tail is rounds-only and a huge recent round could keep the
   * post-compaction context over the window.
   */
  getBoundaryOptions?(
    session: Session,
    sessionSettings: SessionSettings,
    globalSettings: Settings
  ): Pick<CompactionBoundaryOptions, 'maxTailTokens' | 'estimateMessagesTokens'>
}

export interface CompactionSummaryPort {
  generate(input: {
    messages: Message[]
    sessionSettings?: SessionSettings
    language: Settings['language']
    onStreamUpdate?: (text: string) => void
  }): Promise<{ success: boolean; summary?: string; error?: Error }>
}

export type CompactionFailureCode = 'session_not_found' | 'summary_failed' | 'no_messages' | 'update_failed'

export interface CompactionFailure {
  code: CompactionFailureCode
  message: string
  cause?: unknown
}

export interface CompactionServiceResult {
  success: boolean
  compacted: boolean
  failure?: CompactionFailure
  summaryMessageId?: string
  /** Another compaction for this session already owns the streaming run. */
  alreadyRunning?: boolean
}

export interface CompactionServiceOptions {
  sessions: CompactionSessionPort
  settings: Pick<SettingsRepositoryPort, 'getSettings'>
  policy: CompactionPolicyPort
  summaries: CompactionSummaryPort
  logger?: LoggerPort
  createId: () => string
  now?: () => number
}

export function isAutoCompactionEnabled(sessionSettings?: SessionSettings, globalSettings?: Settings): boolean {
  if (sessionSettings?.autoCompaction !== undefined) {
    return sessionSettings.autoCompaction
  }
  return globalSettings?.autoCompaction ?? true
}

export class CompactionService {
  private readonly ongoing = new Set<string>()
  private readonly now: () => number

  constructor(private readonly options: CompactionServiceOptions) {
    this.now = options.now ?? Date.now
  }

  isInProgress(sessionId: string): boolean {
    return this.ongoing.has(sessionId)
  }

  async needsCompaction(sessionId: string): Promise<boolean> {
    const session = await this.options.sessions.getSession(sessionId)
    if (!session) return false

    const globalSettings = this.options.settings.getSettings()
    if (!isAutoCompactionEnabled(session.settings, globalSettings)) return false

    const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
    if (!modelId) return false

    const sessionSettings = await this.options.sessions.getSessionSettings(sessionId)
    return this.options.policy.shouldCompact({ sessionId, session, sessionSettings, globalSettings })
  }

  async run(
    sessionId: string,
    options: { force?: boolean; onStreamUpdate?: (text: string) => void } = {}
  ): Promise<CompactionServiceResult> {
    if (this.ongoing.has(sessionId)) {
      return { success: true, compacted: false, alreadyRunning: true }
    }
    if (!options.force && !(await this.needsCompaction(sessionId))) {
      return { success: true, compacted: false }
    }
    if (this.ongoing.has(sessionId)) {
      return { success: true, compacted: false, alreadyRunning: true }
    }

    this.ongoing.add(sessionId)
    try {
      const session = await this.options.sessions.getSession(sessionId)
      if (!session) {
        return this.failure('session_not_found', 'Session not found')
      }

      const globalSettings = this.options.settings.getSettings()
      const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
      if (!modelId) {
        return { success: true, compacted: false }
      }

      const sessionSettings = await this.options.sessions.getSessionSettings(sessionId)
      // Boundary is chosen before summarizing so the summary covers exactly the
      // messages it will replace: everything up to the boundary, while the last
      // rounds after it stay raw in context. Selecting over the already-applied
      // context list (previous summary + messages after its boundary) makes the
      // new point always advance past the previous one.
      const contextMessages = this.options.policy.getCompactionContext(session, sessionSettings)
      // The tail budget is an optimization: a failure resolving it must degrade
      // to rounds-only tails, never abort the compaction itself.
      let boundaryOptions: CompactionBoundaryOptions | undefined
      try {
        boundaryOptions = this.options.policy.getBoundaryOptions?.(session, sessionSettings, globalSettings)
      } catch {
        boundaryOptions = undefined
      }
      const roundsBoundary = findCompactionBoundaryMessage(contextMessages, boundaryOptions)
      if (!roundsBoundary) {
        return this.failure('no_messages', 'No messages to compact')
      }
      const roundsBoundaryIndex = contextMessages.findIndex((message) => message.id === roundsBoundary.id)
      const cappedBoundary =
        roundsBoundaryIndex + 1 > MAX_SUMMARY_COVERED_MESSAGES
          ? findLastCompactionBoundaryMessage(contextMessages.slice(0, MAX_SUMMARY_COVERED_MESSAGES))
          : undefined
      const boundary = cappedBoundary ?? roundsBoundary
      const boundaryIndex = cappedBoundary
        ? contextMessages.findIndex((message) => message.id === cappedBoundary.id)
        : roundsBoundaryIndex
      const summaryResult = await this.options.summaries.generate({
        messages: flattenToolCallPartsToText(contextMessages.slice(0, boundaryIndex + 1)),
        sessionSettings: session.settings,
        language: globalSettings.language,
        onStreamUpdate: options.onStreamUpdate,
      })
      if (!summaryResult.success || !summaryResult.summary) {
        return this.failure(
          'summary_failed',
          summaryResult.error?.message ?? 'Failed to generate summary',
          summaryResult.error
        )
      }

      const summaryMessage: Message = {
        id: this.options.createId(),
        role: 'assistant',
        contentParts: [{ type: 'text', text: summaryResult.summary }],
        timestamp: this.now(),
        isSummary: true,
      }

      const point = {
        summaryMessageId: summaryMessage.id,
        boundaryMessageId: boundary.id,
        createdAt: this.now(),
      }
      try {
        let committed = false
        await this.options.sessions.updateSessionWithMessages(sessionId, (current) => {
          if (!current) throw new Error('Session not found during update')
          const updated = buildCompactionCommitPatch(current, summaryMessage, point)
          if (!updated) return current
          committed = true
          return updated
        })
        if (!committed) {
          await this.logAbandonedCompaction(sessionId, boundary.id)
          return { success: true, compacted: false }
        }
      } catch (error) {
        return this.failure('update_failed', error instanceof Error ? error.message : String(error), error)
      }

      return { success: true, compacted: true, summaryMessageId: summaryMessage.id }
    } catch (error) {
      return this.failure('update_failed', error instanceof Error ? error.message : String(error), error)
    } finally {
      this.ongoing.delete(sessionId)
    }
  }

  private failure(code: CompactionFailureCode, message: string, cause?: unknown): CompactionServiceResult {
    return { success: false, compacted: false, failure: { code, message, cause } }
  }

  private async logAbandonedCompaction(sessionId: string, boundaryMessageId: string): Promise<void> {
    try {
      await this.options.logger?.log(
        'warn',
        'Compaction boundary message disappeared during summary streaming; compaction abandoned',
        { sessionId, boundaryMessageId }
      )
    } catch {
      // Diagnostics must never change the successful, non-compacted outcome.
    }
  }
}
