import { flattenToolCallPartsToText } from '@shared/context/tool-flatten'
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
   * The host's send-context selection, including its message-count limit and
   * tool-result cleanup. The summary covers this window through its latest
   * eligible message; persisted history remains available in the conversation.
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
      force?: boolean
      prompt?: string
      onStreamUpdate?: (text: string) => void
      pendingMessage?: Message
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
      const contextMessages = await this.options.policy.getCompactionContext(
        session,
        sessionSettings,
        options.pendingMessage
      )
      const boundary = findLastCompactionBoundaryMessage(contextMessages)
      if (!boundary) {
        return this.failure('no_messages', 'No messages to compact')
      }
      const boundaryIndex = contextMessages.findIndex((message) => message.id === boundary.id)
      const summaryResult = await this.options.summaries.generate({
        sessionId,
        messages: flattenToolCallPartsToText(contextMessages.slice(0, boundaryIndex + 1)),
        sessionSettings: session.settings,
        language: globalSettings.language,
        prompt: options.prompt?.trim() || globalSettings.compactionPrompt,
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
