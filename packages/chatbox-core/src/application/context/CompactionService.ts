import { collectCompactedAttachments } from '@shared/context/attachments'
import { projectContextMessagesForModel } from '@shared/context/model-projection'
import { flattenToolCallPartsToText } from '@shared/context/tool-flatten'
import type { LoggerPort, SettingsRepositoryPort } from '../../ports'
import type { Message, SessionHeader, SessionSettings, Settings } from '../../types'
import type { SessionHeaderRead } from '../../ports/session-row-repository'
import type { SessionContextRepositoryPort, SessionContextSource } from '../../ports/session-context-source'
import type { SessionCompactionOperation } from '../../ports/session-structure-command'
import { getTokenizerType } from '@shared/token-estimation/tokenizer'
import { type CompactionBudget, estimateTokensBySampling, shouldCompactAtTokens } from '../token-estimation/math'
import type { TokenEstimationModel } from '../token-estimation/TokenEstimationService'
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

/** What the last request sent outside the conversation history. */
export interface RequestOverheadTokens {
  /** Tool definitions, which no message carries. */
  toolTokens: number
  /**
   * System instructions beyond the session's own system messages: agent
   * instructions, memory, knowledge base.
   */
  extraSystemTokens: number
}

/**
 * Overhead a pre-send estimate adds to its history count. An estimate that
 * already counted some host instructions passes them so they are not counted twice.
 */
export function getRequestOverheadBeyond(
  overhead: RequestOverheadTokens,
  countedInstructions = '',
  model?: TokenEstimationModel
): number {
  const counted = countedInstructions ? estimateTokensBySampling(countedInstructions, getTokenizerType(model)) : 0
  return overhead.toolTokens + Math.max(0, overhead.extraSystemTokens - counted)
}

export interface CompactionPressure {
  /** Estimated request size: context, pending input and request overhead. */
  tokens: number
  budget: CompactionBudget
}

export interface CompactionPolicyPort {
  /** Null when the session has no measurable request or model window. */
  measure(input: {
    sessionId: string
    header: SessionHeader
    sessionSettings: SessionSettings
    globalSettings: Settings
    pendingMessage?: Message
    /** Request tokens outside the conversation (tool definitions, extra instructions) seen on the last request. */
    requestOverhead: RequestOverheadTokens
  }): Promise<CompactionPressure | null>
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

/** Per-session request facts are kept for recently active sessions only. */
const SESSION_FACT_LIMIT = 256

const NO_REQUEST_OVERHEAD: RequestOverheadTokens = { toolTokens: 0, extraSystemTokens: 0 }

/** The context a compaction left: valid only while the active path still ends past that summary. */
interface CompactedSize {
  tokens: number
  threadId: string
  summaryMessageId: string | undefined
  usableTokens: number
}

function remember<T>(map: Map<string, T>, sessionId: string, value: T): void {
  map.delete(sessionId)
  map.set(sessionId, value)
  while (map.size > SESSION_FACT_LIMIT) map.delete(map.keys().next().value!)
}

export class CompactionService {
  private readonly ongoing = new Set<string>()
  private readonly now: () => number
  private readonly requestOverhead = new Map<string, RequestOverheadTokens>()
  /** Request size a conversation compaction left; the next automatic one waits for growth past it. */
  private readonly compactedSizes = new Map<string, CompactedSize>()

  constructor(private readonly options: CompactionServiceOptions) {
    this.now = options.now ?? Date.now
  }

  isInProgress(sessionId: string): boolean {
    return this.ongoing.has(sessionId)
  }

  /**
   * Record what the last request sent outside the conversation history, so the
   * next pre-send check measures the request the model will actually receive.
   */
  recordRequestOverhead(sessionId: string, overhead: RequestOverheadTokens): void {
    const valid = (tokens: number) => Number.isFinite(tokens) && tokens >= 0
    if (!valid(overhead.toolTokens) || !valid(overhead.extraSystemTokens)) return
    remember(this.requestOverhead, sessionId, {
      toolTokens: Math.ceil(overhead.toolTokens),
      extraSystemTokens: Math.ceil(overhead.extraSystemTokens),
    })
  }

  async needsCompaction(sessionId: string, pendingMessage?: Message): Promise<boolean> {
    const read = await this.options.sessions.getSessionHeader(sessionId)
    const session = read?.header
    if (!session) return false

    const globalSettings = this.options.settings.getSettings()
    if (!isAutoCompactionEnabled(session.settings, globalSettings)) return false

    const pressure = await this.measure(sessionId, session, globalSettings, pendingMessage)
    if (!pressure) return false
    // Another thread or fork, or a different model window, starts without the earlier baseline.
    const compacted = this.compactedSizes.get(sessionId)
    const baseline =
      compacted &&
      compacted.threadId === read.activeThreadId &&
      compacted.summaryMessageId === read.summary.lastSummaryMessageId &&
      compacted.usableTokens === pressure.budget.usableTokens
        ? compacted.tokens
        : undefined
    return shouldCompactAtTokens(pressure.budget, pressure.tokens, baseline)
  }

  private async measure(
    sessionId: string,
    session: SessionHeader,
    globalSettings: Settings,
    pendingMessage?: Message
  ): Promise<CompactionPressure | null> {
    const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
    if (!modelId) return null

    const sessionSettings = await this.options.sessions.getSessionSettings(sessionId, session)
    return this.options.policy.measure({
      sessionId,
      header: session,
      sessionSettings,
      globalSettings,
      pendingMessage,
      requestOverhead: this.requestOverhead.get(sessionId) ?? NO_REQUEST_OVERHEAD,
    })
  }

  /** Remember the size a conversation compaction left, for the next automatic decision. */
  private async recordCompactedSize(sessionId: string, request: CompactionRequest): Promise<void> {
    this.compactedSizes.delete(sessionId)
    // A generation compaction measures the live request itself; the next turn starts fresh.
    if (request.kind === 'generation') return
    try {
      const read = await this.options.sessions.getSessionHeader(sessionId)
      if (!read) return
      const pressure = await this.measure(sessionId, read.header, this.options.settings.getSettings())
      if (pressure) {
        remember(this.compactedSizes, sessionId, {
          tokens: pressure.tokens,
          threadId: read.activeThreadId,
          summaryMessageId: read.summary.lastSummaryMessageId,
          usableTokens: pressure.budget.usableTokens,
        })
      }
    } catch (error) {
      try {
        await this.options.logger?.log('warn', 'Failed to measure the compacted conversation', { sessionId, error })
      } catch {
        // Diagnostics must never change the successful compaction outcome.
      }
    }
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
        messages: flattenToolCallPartsToText(
          projectContextMessagesForModel(plan.messages, { language: globalSettings.language, purpose: 'summarize' })
        ),
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

      const attachments = collectCompactedAttachments(plan.messages)
      const summaryMessage: Message = {
        id: this.options.createId(),
        role: 'assistant',
        contentParts: [{ type: 'text', text: summaryResult.summary }],
        timestamp: this.now(),
        isSummary: true,
        ...attachments,
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

      await this.recordCompactedSize(sessionId, request)

      return {
        status: 'compacted',
        summaryMessageId: summaryMessage.id,
        summary: summaryResult.summary,
        attachments,
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
