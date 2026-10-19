import { flattenToolCallPartsToText } from '@shared/context/tool-flatten'
import type { LoggerPort, SettingsRepositoryPort } from '../../ports'
import type { Message, SessionHeader, SessionSettings, Settings } from '../../types'
import type { SessionHeaderRead } from '../../ports/session-row-repository'
import type { SessionContextRepositoryPort, SessionContextSource } from '../../ports/session-context-source'
import type { SessionCompactionOperation } from '../../ports/session-structure-command'
import { createCompactionPlan } from './compaction-plan'
import type {
  CompactionFailureCode,
  CompactionRequest,
  CompactionRunOptions,
  CompactionServiceResult,
} from './compaction-types'

export interface CompactionSessionPort extends SessionContextRepositoryPort {
  getSessionHeader(sessionId: string): Promise<SessionHeaderRead | null>
  getSessionSettings(sessionId: string, header: SessionHeader): Promise<SessionSettings>
  commitSessionCompaction(
    sessionId: string,
    operation: SessionCompactionOperation
  ): Promise<{ applied: boolean; revision: number }>
}

export interface CompactionPolicyPort {
  shouldCompact(input: {
    sessionId: string
    header: SessionHeader
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
    source: SessionContextSource,
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
    const read = await this.options.sessions.getSessionHeader(sessionId)
    const session = read?.header
    if (!session) return false

    const globalSettings = this.options.settings.getSettings()
    if (!isAutoCompactionEnabled(session.settings, globalSettings)) return false

    const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
    if (!modelId) return false

    const sessionSettings = await this.options.sessions.getSessionSettings(sessionId, session)
    return this.options.policy.shouldCompact({
      sessionId,
      header: session,
      sessionSettings,
      globalSettings,
      pendingMessage,
    })
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

    if (options.abortSignal?.aborted) return { status: 'cancelled' }
    this.ongoing.add(sessionId)
    try {
      options.onStart?.()
      const read = await this.options.sessions.getSessionHeader(sessionId)
      if (!read) return this.failure('session_not_found', 'Session not found')
      const session = read.header
      const globalSettings = this.options.settings.getSettings()
      const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
      if (!modelId) return { status: 'skipped', reason: 'no_model' }
      const sessionSettings = await this.options.sessions.getSessionSettings(sessionId, session)
      const source = await this.options.sessions.getSessionContextSource({
        sessionId,
        expectedRevision: read.revision,
        maxContextMessageCount: sessionSettings.maxContextMessageCount,
        reserveCurrentInput: true,
        ...(request.kind === 'generation' ? { targetMessageId: request.targetMessageId } : {}),
      })
      if (!source) return this.failure('session_not_found', 'Session not found')

      const planned = await createCompactionPlan(source, request, (context, pendingMessage) =>
        this.options.policy.getCompactionContext(context, sessionSettings, pendingMessage)
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

      let committedRevision: number
      try {
        if (options.abortSignal?.aborted) {
          return { status: 'cancelled' }
        }
        const commit = await this.options.sessions.commitSessionCompaction(sessionId, {
          action: 'compaction-commit',
          threadId: plan.threadId,
          summary: summaryMessage,
          coverage: plan.coverage,
          pathMessageIds: plan.pathMessageIds,
          createdAt: this.now(),
          abortSignal: options.abortSignal,
        })
        committedRevision = commit.revision
        if (!commit.applied) {
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
        revision: committedRevision,
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
