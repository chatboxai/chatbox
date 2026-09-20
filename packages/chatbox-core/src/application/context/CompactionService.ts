import { flattenToolCallPartsToText } from '@shared/context/tool-flatten'
import { findMessageContext, findMessageSourceThread } from '@shared/session/message-forks'
import type { LoggerPort, SettingsRepositoryPort } from '../../ports'
import type { Message, Session, SessionSettings, Settings } from '../../types'
import { findLastCompactionBoundaryMessage } from './compaction-boundary'
import { buildCompactionCommitPatch } from './compaction-commit'

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
  /** Summary text committed with the compaction point, when compacted. */
  summary?: string
  /** Last eligible message the summary covers, when compacted. */
  boundaryMessageId?: string
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

  async needsCompaction(sessionId: string, pendingMessage?: Message): Promise<boolean> {
    const session = await this.options.sessions.getSession(sessionId)
    if (!session) return false

    const globalSettings = this.options.settings.getSettings()
    if (!isAutoCompactionEnabled(session.settings, globalSettings)) return false

    const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
    if (!modelId) return false

    const sessionSettings = await this.options.sessions.getSessionSettings(sessionId)
    return this.options.policy.shouldCompact({ sessionId, session, sessionSettings, globalSettings, pendingMessage })
  }

  async run(
    sessionId: string,
    options: {
      target?: { targetMessageId: string; boundaryMessageId: string }
      force?: boolean
      prompt?: string
      onStreamUpdate?: (text: string) => void
      pendingMessage?: Message
      abortSignal?: AbortSignal
    } = {}
  ): Promise<CompactionServiceResult> {
    if (this.ongoing.has(sessionId)) {
      return { success: true, compacted: false, alreadyRunning: true }
    }
    if (!options.force && !(await this.needsCompaction(sessionId, options.pendingMessage))) {
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
      // Summarize the full selected context through its latest eligible message.
      // Capture the boundary before generation so messages arriving during
      // streaming remain after the summary and available to the next request.
      const targetPath = options.target ? findMessageContext(session, options.target.targetMessageId) : null
      if (options.target && !targetPath) return { success: true, compacted: false }
      const thread = options.target ? findMessageSourceThread(session, options.target.targetMessageId) : null
      const scopedSession = targetPath
        ? {
            ...session,
            messages: targetPath.list.slice(0, targetPath.index),
            compactionPoints: thread ? thread.compactionPoints : session.compactionPoints,
          }
        : session
      const contextMessages = await this.options.policy.getCompactionContext(
        scopedSession,
        sessionSettings,
        options.pendingMessage
      )
      const boundary = findLastCompactionBoundaryMessage(contextMessages)
      if (!boundary) {
        return this.failure('no_messages', 'No messages to compact')
      }
      if (options.target && boundary.id !== options.target.boundaryMessageId) {
        return { success: true, compacted: false }
      }
      const coveredMessageIds = targetPath?.list.slice(0, targetPath.index).map((message) => message.id)
      const boundaryIndex = contextMessages.findIndex((message) => message.id === boundary.id)
      if (options.abortSignal?.aborted) {
        return { success: true, compacted: false }
      }
      const summaryResult = await this.options.summaries.generate({
        sessionId,
        messages: flattenToolCallPartsToText(contextMessages.slice(0, boundaryIndex + 1)),
        sessionSettings: session.settings,
        language: globalSettings.language,
        prompt: options.prompt?.trim() || globalSettings.compactionPrompt,
        onStreamUpdate: options.onStreamUpdate,
        abortSignal: options.abortSignal,
      })
      if (options.abortSignal?.aborted) {
        return { success: true, compacted: false }
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
        boundaryMessageId: boundary.id,
        createdAt: this.now(),
      }
      try {
        if (options.abortSignal?.aborted) {
          return { success: true, compacted: false }
        }
        let committed = false
        await this.options.sessions.updateSessionWithMessages(sessionId, (current) => {
          if (!current) throw new Error('Session not found during update')
          if (options.abortSignal?.aborted) return current
          if (options.target) {
            const currentPath = findMessageContext(current, options.target.targetMessageId)
            const currentIds = currentPath?.list.slice(0, currentPath.index).map((message) => message.id)
            if (
              !currentIds ||
              !coveredMessageIds ||
              currentIds.length !== coveredMessageIds.length ||
              currentIds.some((id, index) => id !== coveredMessageIds[index])
            )
              return current
          }
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

      return {
        success: true,
        compacted: true,
        summaryMessageId: summaryMessage.id,
        summary: summaryResult.summary,
        boundaryMessageId: boundary.id,
      }
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
