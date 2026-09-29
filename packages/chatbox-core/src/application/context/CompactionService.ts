import { flattenToolCallPartsToText } from '@shared/context/tool-flatten'
import type { LoggerPort, SettingsRepositoryPort } from '../../ports'
import type { Message, Session, SessionSettings, Settings } from '../../types'
import { buildCompactionCommitPatch } from './compaction-commit'
import { createCompactionPlan, isCompactionPlanCurrent } from './compaction-plan'
import type {
  CompactionFailureCode,
  CompactionRequest,
  CompactionRunOptions,
  CompactionServiceResult,
} from './compaction-types'

export interface CompactionSessionPort {
  getSession(sessionId: string): Promise<Session | null>
  /** `session` is the complete session the caller already read; implementations may resolve settings from it. */
  getSessionSettings(sessionId: string, session?: Session): Promise<SessionSettings>
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
    pendingMessage?: Message
  }): Promise<boolean>
  /**
   * The host's send-context selection, including its message-count limit.
   * The summary covers this window through its latest eligible message;
   * persisted history remains available in the conversation.
   */
  getCompactionContext(
    session: Session,
    sessionSettings: SessionSettings,
    pendingMessage?: Message
  ): Message[] | Promise<Message[]>
}

export interface CompactionSummaryPort {
  generate(input: {
    sessionId: string
    messages: Message[]
    sessionSettings?: SessionSettings
    language: Settings['language']
    prompt?: string
    onStreamUpdate?: (text: string) => void
    abortSignal?: AbortSignal
  }): Promise<{ success: boolean; summary?: string; error?: Error }>
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

  async needsCompaction(sessionId: string, pendingMessage?: Message): Promise<boolean> {
    const session = await this.options.sessions.getSession(sessionId)
    if (!session) return false

    const globalSettings = this.options.settings.getSettings()
    if (!isAutoCompactionEnabled(session.settings, globalSettings)) return false

    const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
    if (!modelId) return false

    const sessionSettings = await this.options.sessions.getSessionSettings(sessionId, session)
    return this.options.policy.shouldCompact({ sessionId, session, sessionSettings, globalSettings, pendingMessage })
  }

  async run(
    sessionId: string,
    request: CompactionRequest,
    options: CompactionRunOptions = {}
  ): Promise<CompactionServiceResult> {
    if (this.ongoing.has(sessionId)) {
      return { status: 'skipped', reason: 'busy' }
    }
    if (options.abortSignal?.aborted) return { status: 'cancelled' }
    if (request.kind === 'automatic' && !(await this.needsCompaction(sessionId, request.pendingMessage))) {
      return { status: 'skipped', reason: 'not_needed' }
    }
    if (this.ongoing.has(sessionId)) {
      return { status: 'skipped', reason: 'busy' }
    }

    this.ongoing.add(sessionId)
    try {
      const session = await this.options.sessions.getSession(sessionId)
      if (!session) {
        return this.failure('session_not_found', 'Session not found')
      }

      const globalSettings = this.options.settings.getSettings()
      const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
      if (!modelId) return { status: 'skipped', reason: 'no_model' }
      const sessionSettings = await this.options.sessions.getSessionSettings(sessionId, session)
      const planned = await createCompactionPlan(session, request, (scopedSession, pendingMessage) =>
        this.options.policy.getCompactionContext(scopedSession, sessionSettings, pendingMessage)
      )
      if (planned.status !== 'ready') return planned
      const { plan } = planned
      if (options.abortSignal?.aborted) return { status: 'cancelled' }
      const summaryResult = await this.options.summaries.generate({
        sessionId,
        messages: flattenToolCallPartsToText(plan.messages),
        sessionSettings: session.settings,
        language: globalSettings.language,
        prompt: options.prompt?.trim() || globalSettings.compactionPrompt,
        onStreamUpdate: options.onStreamUpdate,
        abortSignal: options.abortSignal,
      })
      if (options.abortSignal?.aborted) {
        return { status: 'cancelled' }
      }
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
        boundaryMessageId: plan.coverage.boundaryMessageId,
        createdAt: this.now(),
      }
      try {
        if (options.abortSignal?.aborted) {
          return { status: 'cancelled' }
        }
        let committed = false
        await this.options.sessions.updateSessionWithMessages(sessionId, (current) => {
          if (!current) throw new Error('Session not found during update')
          if (options.abortSignal?.aborted) return current
          if (!isCompactionPlanCurrent(current, plan)) return current
          const updated = buildCompactionCommitPatch(current, summaryMessage, point)
          if (!updated) return current
          committed = true
          return updated
        })
        if (!committed) {
          await this.logAbandonedCompaction(sessionId, plan.coverage.boundaryMessageId)
          return options.abortSignal?.aborted ? { status: 'cancelled' } : { status: 'skipped', reason: 'stale_path' }
        }
      } catch (error) {
        return this.failure('update_failed', error instanceof Error ? error.message : String(error), error)
      }

      return {
        status: 'compacted',
        summaryMessageId: summaryMessage.id,
        summary: summaryResult.summary,
        coverage: plan.coverage,
      }
    } catch (error) {
      return this.failure('update_failed', error instanceof Error ? error.message : String(error), error)
    } finally {
      this.ongoing.delete(sessionId)
    }
  }

  private failure(code: CompactionFailureCode, message: string, cause?: unknown): CompactionServiceResult {
    return { status: 'failed', failure: { code, message, cause } }
  }

  private async logAbandonedCompaction(sessionId: string, boundaryMessageId: string): Promise<void> {
    try {
      await this.options.logger?.log('warn', 'Compaction path changed during summary streaming; compaction abandoned', {
        sessionId,
        boundaryMessageId,
      })
    } catch {
      // Diagnostics must never change the successful, non-compacted outcome.
    }
  }
}
