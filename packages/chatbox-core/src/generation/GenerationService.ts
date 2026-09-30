import type { ChatStreamOptions, ModelInterface, ModelStreamPart } from '@shared/models/types'
import { findMessageContext } from '@shared/session/message-forks'
import type {
  AgentModeLockReason,
  AgentModeValue,
  AppActionApprovalDetails,
  CompactionPoint,
  Config,
  KnowledgeBase,
  Message,
  MessageContentParts,
  ModelProvider,
  Session,
  SessionSettings,
  Settings,
} from '@shared/types'
import { createMessage } from '@shared/types'
import type { MemoryToolContext } from '@shared/types/agent-persona'
import { resolveCommandApprovalMode } from '@shared/types/command-execution'
import { getMessageText } from '@shared/utils/message'
import { resolveReasoningProviderOptions } from '@shared/utils/reasoning-control'
import { MAX_TOOL_CALLS_BEFORE_CONFIRMATION, shouldPauseOnToolCallLimit } from '@shared/utils/tool-call-limit-pause'
import type { ModelMessage, ToolSet } from 'ai'
import { isAutoCompactionEnabled } from '../application/context'
import type { CompactionServiceResult, GenerationCompactionRequest } from '../application/context/compaction-types'
import type { GenerationSegmentSplitWriter } from '../application/session/generation-segment-split'
import { contextSourceFromSession } from '../application/session/session-context-source'
import { APPROVAL_RESPONSE_TIMEOUT_MS, type ApprovalDenyReason, type ApprovalPauseReason } from '../message-approval'
import { contextPathFacts } from '../persistence/session-context-read'
import type {
  AnalyticsPort,
  AttachmentContentPort,
  BlobStoragePort,
  LoggerPort,
  ModelFactoryPort,
  PlatformCapabilitiesPort,
  SessionRepositoryPort,
  SettingsRepositoryPort,
} from '../ports'
import type {
  SessionContextBeforeTarget,
  SessionContextRequest,
  SessionContextSource,
} from '../ports/session-context-source'
import type { SessionMessagesSource } from '../ports/session-message-source'
import type { SessionHeader } from '../ports/session-read-model'
import { type SessionMessagesRequest, SessionRowConflictError } from '../ports/session-row-store'
import { sessionTopologyFingerprint } from '../session/session-tree/encode'
import {
  AGENT_MODE_SUGGESTION_PROMPT,
  type AgentModeSuggestionDecision,
  describeUserMessageForAgentModeDecision,
  getLastUserMessage,
  parseAgentModeSuggestionDecision,
} from './agent-mode-suggestion'
import { GenerationSegmentTransitions } from './GenerationSegmentTransitions'
import {
  applyPersistentToolCallPause,
  cancelRunningToolCallBatch,
  createPausedToolCallExecutionContext,
  findLastRetryableToolCallPart,
  findPausedApprovalBatch,
  findPausedToolCallLimitBatch,
  findToolCallPart,
  finishAbortedGeneration,
  finishPausedToolCallContinuation,
  getApprovalTrackingTarget,
  getToolCallPause,
  hasPausedToolCallPart,
  isApprovalPauseReason,
  isRetryableToolCallStep,
  keepContentPartsThroughToolCall,
  markToolCallPaused,
  shouldPersistStreamingChunk,
  updateToolCallPart,
  updateToolCallParts,
  withToolCallLimitPause,
} from './generation-flow'
import { MidRunCompactionController } from './MidRunCompactionController'
import type { GenerationRuntimeStore } from './runtime-store'
import { createInitialState, processStreamChunk } from './stream-chunk-processor'

const STREAM_PERSIST_INTERVAL_MS = 2_000

const APPROVAL_TIMEOUT_DENIAL = `Automatically denied: no user response within ${APPROVAL_RESPONSE_TIMEOUT_MS / 1000} seconds.`

function buildDeniedApprovalResult(type: ApprovalPauseReason['type'], denyReason: ApprovalDenyReason) {
  const timedOut = denyReason === 'timeout'
  switch (type) {
    case 'user_exec_approval':
    case 'command_escalation_approval':
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: timedOut ? `Command not run. ${APPROVAL_TIMEOUT_DENIAL}` : 'Command denied by user.',
      }
    case 'file_mutation_approval':
      return {
        success: false,
        error: timedOut ? `File mutation not applied. ${APPROVAL_TIMEOUT_DENIAL}` : 'File mutation denied by user.',
      }
    case 'app_action_approval':
      return {
        success: false,
        error: timedOut ? `Chatbox action not run. ${APPROVAL_TIMEOUT_DENIAL}` : 'Chatbox action denied by user.',
      }
  }
}

function getAbortStoppedAt(signal: AbortSignal, fallback: number): number {
  return typeof signal.reason === 'number' ? signal.reason : fallback
}

type ExecutableTool = {
  execute?: (
    input: unknown,
    context: {
      toolCallId?: string
      approved?: boolean
      approvalWorkdir?: string
      approvalRetryOf?: string
      approvalFileVersion?: string
      approvalDetails?: AppActionApprovalDetails
      abortSignal?: AbortSignal
    }
  ) => unknown
}

export type GenerationOperationType = 'send_message' | 'regenerate'
export type GenerationAgentModeEntrySource = 'suggestion_accept' | 'locked_session' | 'manual' | 'none'

export interface GenerationOptions {
  /** User send action time, before preflight, persistence and the session lock. */
  submittedAt?: number
  operationType?: GenerationOperationType
  appendToMessage?: boolean
  skipAgentModeSuggestion?: boolean
  agentModeEntrySource?: GenerationAgentModeEntrySource
  contextMessages?: Message[]
  externalAbortSignal?: AbortSignal
}

export interface GenerationSessionPort extends Pick<SessionRepositoryPort, 'getSession' | 'getCompleteSessionSource'> {
  isSessionMissingError?(error: unknown): boolean
  getSessionContextSource?(request: SessionContextRequest): Promise<SessionContextSource | null>
  readSessionMessages?(request: SessionMessagesRequest): Promise<SessionMessagesSource | null>
  getSessionSettings(sessionId: string, header?: SessionHeader): Promise<SessionSettings | null | undefined>
  updateSessionSettings(
    sessionId: string,
    update: (current: SessionSettings | undefined) => SessionSettings
  ): Promise<void>
  initializeTargetMessage(
    targetMessage: Message,
    settings: SessionSettings,
    globalSettings: Settings,
    sessionType: Session['type']
  ): Promise<Message>
  persistStreamingMessage(
    sessionId: string,
    message: Message,
    options?: { checkpoint?: boolean; refreshCounting?: boolean; onlyIfGenerating?: boolean }
  ): Promise<void>
  /**
   * Insert a new durable message directly after an existing one (fork/thread
   * aware). Rejects rather than appending elsewhere when the anchor is
   * unreachable, and is idempotent for a message id already present, so an
   * ambiguous failure can be resolved by retrying.
   */
  insertMessageAfter(sessionId: string, message: Message, afterMessageId: string): Promise<void>
  /** Atomic structural write; absent hosts decline splitting rather than partially committing. */
  splitStreamingMessage?: GenerationSegmentSplitWriter
  updateStreamingCache(sessionId: string, message: Message): void
  findMessage(session: Session, messageId: string): Message | undefined
  modifyMessage(
    sessionId: string,
    message: Message,
    refreshCounting?: boolean,
    updateOnlyCache?: boolean
  ): Promise<void>
  handleGenerationError(
    error: unknown,
    targetMessage: Message,
    settings: SessionSettings,
    context: { operationType?: GenerationOperationType; agentMode?: AgentModeValue }
  ): Message
}

export interface GenerationModelContext<TContext> {
  model: ModelInterface
  context: TContext
}

export interface GenerationRequestTiming {
  sessionId: string
  messageId: string
  submittedAt?: number
  generationStartedAt: number
}

export interface GenerationModelFactoryPort<TContext> extends ModelFactoryPort {
  createContext(settings: SessionSettings, timing?: GenerationRequestTiming): Promise<GenerationModelContext<TContext>>
  createWithContext(settings: SessionSettings, context: TContext): Promise<ModelInterface>
}

export interface GenerationPreparationRequest<TContext> {
  session: SessionHeader
  settings: SessionSettings
  globalSettings: Settings
  config: Config
  messages: Message[]
  targetMessageIndex: number
  history?: SessionContextBeforeTarget
  model: ModelInterface
  modelContext: TContext
  attachments: AttachmentContentPort
  knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
  webBrowsing: boolean
  agentModeValue: AgentModeValue
  agentModeLocked: boolean
  agentModeSupported: boolean
  signal: AbortSignal
  providerOptions?: SessionSettings['providerOptions']
  preserveLastPromptMessageToolCalls: boolean
  compactionPoints?: CompactionPoint[]
  lockAgentMode: (reason: Exclude<AgentModeLockReason, null>) => void
}

export interface PreparedGeneration {
  memoryToolContext?: MemoryToolContext
  promptMessages: Message[]
  coreMessages: ModelMessage[]
  tools: ToolSet
  chatOptions: ChatStreamOptions
  infoParts: MessageContentParts
  fallbackToolCallPart: MessageContentParts[number] | undefined
  systemPrompt?: string
}

export interface GenerationPreparationPort<TContext> {
  prepare(request: GenerationPreparationRequest<TContext>): Promise<PreparedGeneration>
}

export interface GenerationToolExecutionPort {
  buildToolsForPausedToolCall(
    source: SessionContextSource,
    settings: SessionSettings,
    targetMessage: Message,
    signal: AbortSignal
  ): Promise<ToolSet>
}

export interface GenerationCoordinationPort {
  runExclusive<T>(sessionId: string, operation: () => Promise<T>): Promise<T>
  wakeBackgroundTaskFollowUps(sessionId: string): Promise<void> | void
}

export interface GenerationSteeringInjectResult {
  /** Messages to use for this step, or undefined to leave them unchanged. */
  messages: ModelMessage[] | undefined
  /** Steered user messages persisted at this boundary, in consumption order. */
  consumed: Message[]
}

export interface GenerationSteeringConsumer {
  inject(messages: ModelMessage[], anchorMessageId: string): Promise<GenerationSteeringInjectResult>
  /** Allow queue items anchored at a message created mid-run to steer this run. */
  admitAnchor(messageId: string): void
  getInjectedMessageIds(): readonly string[]
  release(): void
}

export interface GenerationSteeringPort {
  register(
    sessionId: string,
    conversationScope: ReadonlySet<string> | (() => Promise<ReadonlySet<string> | null>)
  ): GenerationSteeringConsumer | null
  wake(sessionId: string): void
}

export interface GenerationCompactionPort {
  getThresholdTokens(sessionSettings: SessionSettings, globalSettings: Settings): number | null
  compact(
    sessionId: string,
    request: GenerationCompactionRequest,
    abortSignal: AbortSignal
  ): Promise<CompactionServiceResult>
}

export interface GenerationHostPort {
  getConfig(): Promise<Config>
  getKnowledgeBase(sessionId: string): Pick<KnowledgeBase, 'id' | 'name'> | undefined
  getWebBrowsing(sessionId: string, provider: ModelProvider | undefined, settings?: SessionSettings): boolean
  getAgentModeEntry(sessionId: string, session: SessionHeader): { value: AgentModeValue; locked?: boolean }
  setAgentMode(sessionId: string, value: AgentModeValue): Promise<void> | void
  lockAgentMode(sessionId: string, reason: Exclude<AgentModeLockReason, null>): Promise<void> | void
  createPictureStorageKey(sessionId: string, messageId: string): string
  markFirstSuccessfulChatCompleted(): void
  afterMessageGenerated(sessionId: string, message: Message): void
  afterMessageFailed(sessionId: string, message: Message): void
  now(): number
}

export interface GenerationAnalyticsPort extends AnalyticsPort {
  trackGenerate(
    sessionId: string,
    settings: SessionSettings,
    globalSettings: Settings,
    sessionType: Session['type'],
    options?: GenerationOptions
  ): void
  trackSuggestionDecision(
    context: { sessionId: string; provider?: ModelProvider; model?: string },
    suggested: boolean,
    fileCount: number
  ): void
  trackAgentModeSuggested(context: { hasFiles: boolean; fileCount: number }): void
  trackPauseAction(options: {
    type: 'approval' | 'tool_limit'
    action: 'approve' | 'deny' | 'timeout' | 'continue' | 'stop' | 'disable_session' | 'disable_global'
    context?: {
      sessionId: string
      mode: 'work_mode'
      provider?: ModelProvider
      model?: string
    }
    approvalTarget?: 'user_exec' | 'file_write' | 'file_edit'
  }): void
  captureException(
    error: unknown,
    context: {
      operation: 'suggestion' | 'suggestion_model' | 'tool_pause_continue' | 'tool_retry'
      provider?: string
      model?: string
      agentMode?: string
      fullAccess?: boolean
      toolName?: string
      pauseType?: string
    }
  ): void
}

export interface GenerationServiceDependencies<TContext> {
  sessions: GenerationSessionPort
  settings: Pick<SettingsRepositoryPort, 'getSettings' | 'updateSettings'>
  models: GenerationModelFactoryPort<TContext>
  preparation: GenerationPreparationPort<TContext>
  tools: GenerationToolExecutionPort
  coordination: GenerationCoordinationPort
  steering?: GenerationSteeringPort
  compaction?: GenerationCompactionPort
  runtime: GenerationRuntimeStore
  blobs: Pick<BlobStoragePort, 'get' | 'set'>
  attachments: AttachmentContentPort
  capabilities: PlatformCapabilitiesPort
  host: GenerationHostPort
  analytics: GenerationAnalyticsPort
  logger: LoggerPort
}

export class GenerationService<TContext> {
  constructor(private readonly dependencies: GenerationServiceDependencies<TContext>) {}

  private async readContext(request: SessionContextRequest): Promise<SessionContextSource | null> {
    const { sessions } = this.dependencies
    if (sessions.getSessionContextSource) return sessions.getSessionContextSource(request)
    if (request.expectedRevision !== undefined)
      throw new SessionRowConflictError(request.sessionId, request.expectedRevision, null)
    const session = await sessions.getSession(request.sessionId)
    return session ? contextSourceFromSession(session, request) : null
  }

  private async readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSource | null> {
    const { sessions } = this.dependencies
    if (sessions.readSessionMessages) return sessions.readSessionMessages(request)
    if (request.expectedRevision !== undefined)
      throw new SessionRowConflictError(request.sessionId, request.expectedRevision, null)
    const session = await sessions.getSession(request.sessionId)
    return session
      ? {
          header: session,
          revision: null,
          messages: request.messageIds.flatMap((id) => {
            const message = sessions.findMessage(session, id)
            return message ? [message] : []
          }),
        }
      : null
  }

  private async readTargetContext(sessionId: string, messageId: string): Promise<SessionContextSource | null> {
    try {
      return await this.readContext({ sessionId, targetMessageId: messageId })
    } catch (error) {
      // A stale action for a removed target is a no-op; an existing target keeps
      // the original context-read failure visible.
      let selected: SessionMessagesSource | null
      try {
        selected = await this.readMessages({ sessionId, messageIds: [messageId] })
      } catch {
        throw error
      }
      if (!selected?.messages.length) return null
      throw error
    }
  }

  private async isCurrentToolTarget(sessionId: string, expected: Message): Promise<boolean> {
    const selected = await this.readMessages({ sessionId, messageIds: [expected.id] })
    const current = selected?.messages[0]
    if (!current) return false
    const state = (message: Message) => [
      message.role,
      message.contentParts,
      message.generating,
      message.status,
      message.finishReason,
      message.error,
      message.errorCode,
      message.errorExtra,
      message.usage,
      message.tokenCount,
      message.tokensUsed,
    ]
    // Estimated token caches may advance independently of the reviewed call.
    // Content, approval bindings, and generation state must still match.
    return JSON.stringify(state(current)) === JSON.stringify(state(expected))
  }

  async orchestrate(sessionId: string, initialTargetMessage: Message, options?: GenerationOptions): Promise<void> {
    try {
      await this.orchestrateExistingSession(sessionId, initialTargetMessage, options)
    } catch (error) {
      if (this.dependencies.sessions.isSessionMissingError?.(error)) return
      throw error
    }
  }

  private async orchestrateExistingSession(
    sessionId: string,
    initialTargetMessage: Message,
    options?: GenerationOptions
  ): Promise<void> {
    const { sessions, settings: settingsRepository, host, analytics } = this.dependencies
    const generationStartedAt = host.now()
    let generationMessageId = initialTargetMessage.id
    const runtimeState = this.dependencies.runtime.start(sessionId, generationMessageId)
    const controller = runtimeState.abortController
    const externalSignal = options?.externalAbortSignal
    if (externalSignal?.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      externalSignal?.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true })
    }

    let targetMessage = initialTargetMessage
    const finishRuntime = () => {
      this.dependencies.runtime.finishActive(sessionId, generationMessageId, runtimeState)
      const settledAt = host.now()
      try {
        void Promise.resolve(
          this.dependencies.logger.log('info', 'Generation timing', {
            event: 'generation_settled',
            sessionId,
            messageId: initialTargetMessage.id,
            submittedAt: options?.submittedAt,
            generationStartedAt,
            settledAt,
            sendToSettledMs: options?.submittedAt === undefined ? undefined : settledAt - options.submittedAt,
            generationDurationMs: settledAt - generationStartedAt,
            aborted: controller.signal.aborted,
          })
        ).catch(() => {})
      } catch {}
    }
    const finishCanceledSetup = async (persist: boolean): Promise<void> => {
      targetMessage = {
        ...targetMessage,
        generating: false,
        status: [],
        finishReason: 'canceled',
      }
      if (persist) {
        await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
      }
      finishRuntime()
    }

    let source: SessionContextSource | null
    let session: SessionHeader
    let settings: SessionSettings | null | undefined
    let conversationScope: ReadonlySet<string> | (() => Promise<ReadonlySet<string> | null>) = new Set()
    let messages: Message[]
    let targetMessageIndex: number
    let promptTargetMessageIndex: number
    let history: SessionContextBeforeTarget
    let lastUserMessage: Message | undefined
    const globalSettings = settingsRepository.getSettings()
    let config: Config
    try {
      const overrideIndex =
        options?.contextMessages?.findIndex((message) => message.id === initialTargetMessage.id) ?? -1
      const override = options?.contextMessages && overrideIndex > 0 ? options.contextMessages : undefined
      const request: SessionContextRequest = {
        sessionId,
        targetMessageId: initialTargetMessage.id,
        includeTarget: Boolean(options?.appendToMessage),
      }
      if (override) {
        const selected = await this.readMessages({ sessionId, messageIds: [initialTargetMessage.id] })
        if (!selected) {
          finishRuntime()
          return
        }
        request.expectedRevision = selected.revision ?? undefined
        if (selected.messages.length === 0) {
          request.targetMessageId = undefined
          request.includeTarget = undefined
        }
      }
      source = await this.readContext(request)
      if (controller.signal.aborted) return finishCanceledSetup(Boolean(source))
      if (!source) {
        finishRuntime()
        return
      }
      if (this.dependencies.steering && !override) {
        if (source.topologyFingerprint) {
          const fingerprint = source.topologyFingerprint
          conversationScope = async () => {
            const snapshot = sessions.getCompleteSessionSource
              ? await sessions.getCompleteSessionSource(sessionId)
              : null
            const complete = snapshot?.session ?? (await sessions.getSession(sessionId))
            const currentFingerprint = fingerprint.startsWith('v2:')
              ? snapshot?.topologyFingerprint
              : complete
                ? sessionTopologyFingerprint(complete, fingerprint)
                : undefined
            if (!complete || currentFingerprint !== fingerprint) return null
            const path = findMessageContext(complete, initialTargetMessage.id)
            return path ? new Set(path.list.map((message) => message.id)) : null
          }
        } else {
          const complete = await sessions.getSession(sessionId)
          if (!complete) {
            finishRuntime()
            return
          }
          source = contextSourceFromSession(complete, request)
          conversationScope = new Set(
            findMessageContext(complete, initialTargetMessage.id)?.list.map((message) => message.id)
          )
        }
      }
      session = source.header
      messages =
        override ??
        (options?.appendToMessage
          ? source.candidateMessages
          : [...source.candidateMessages, ...(source.targetMessage ? [source.targetMessage] : [])])
      targetMessageIndex = override
        ? overrideIndex
        : messages.findIndex((message) => message.id === initialTargetMessage.id)
      promptTargetMessageIndex = options?.appendToMessage ? targetMessageIndex + 1 : targetMessageIndex
      history = override
        ? contextPathFacts(messages.slice(0, promptTargetMessageIndex))
        : options?.appendToMessage && source.targetMessage
          ? contextPathFacts([source.targetMessage], source.beforeTarget)
          : source.beforeTarget
      if (override) conversationScope = new Set(override.map((message) => message.id))
      lastUserMessage = getLastUserMessage(messages, promptTargetMessageIndex)
      if (!lastUserMessage && history.userMessageCount === 1 && history.lastUserMessageId) {
        lastUserMessage = (
          await this.readMessages({
            sessionId,
            messageIds: [history.lastUserMessageId],
            expectedRevision: source.revision ?? undefined,
          })
        )?.messages[0]
      }
      settings = await sessions.getSessionSettings(sessionId, session)
      if (controller.signal.aborted) return finishCanceledSetup(true)

      config = await host.getConfig()
      if (controller.signal.aborted) return finishCanceledSetup(true)

      if (!settings) {
        finishRuntime()
        return
      }

      targetMessage = await sessions.initializeTargetMessage(
        initialTargetMessage,
        settings,
        globalSettings,
        session.type
      )
      if (controller.signal.aborted) return finishCanceledSetup(true)

      await sessions.persistStreamingMessage(sessionId, targetMessage)
      if (controller.signal.aborted) return finishCanceledSetup(true)
    } catch (error) {
      finishRuntime()
      throw error
    }

    analytics.trackGenerate(sessionId, settings, globalSettings, session.type, options)

    const startedAt = host.now()
    let firstTokenLatency: number | undefined
    let lastPersistTimestamp = host.now()

    if (targetMessageIndex <= 0) {
      finishRuntime()
      return
    }
    // A previous Stop can leave a tool that ignores abortSignal still running.
    // Re-check after every wait because an alternative reply may register a new
    // drain while this generation is already behind the barrier.
    let abortedDuringDrainWait: Promise<void> | undefined
    while (true) {
      const unsettledDrains = this.dependencies.runtime.waitForUnsettledStreamDrains(sessionId)
      if (!unsettledDrains) break
      abortedDuringDrainWait ??= new Promise<void>((resolve) => {
        if (controller.signal.aborted) resolve()
        else controller.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      await Promise.race([unsettledDrains, abortedDuringDrainWait])
      if (controller.signal.aborted) {
        targetMessage = finishAbortedGeneration(
          targetMessage,
          targetMessage.contentParts,
          getAbortStoppedAt(controller.signal, host.now())
        )
        await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
        finishRuntime()
        return
      }
    }

    // User-requested queue jumps are persisted in true causal order: the
    // assistant segment completed so far is finalized, the steered user is
    // inserted after it, and the same provider run continues in a fresh
    // continuation message stored below the steered user.
    const steering = this.dependencies.steering?.register(sessionId, conversationScope) ?? null

    const segmentTransitions = new GenerationSegmentTransitions(controller.signal)
    let processorState = createInitialState()
    const infoParts: MessageContentParts = []
    const persistAbortedGenerationIfNeeded = async (): Promise<boolean> => {
      if (!controller.signal.aborted) return false
      await segmentTransitions.settle()
      targetMessage = finishAbortedGeneration(
        targetMessage,
        [...infoParts, ...processorState.contentParts],
        getAbortStoppedAt(controller.signal, host.now())
      )
      await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
      return true
    }

    try {
      const modelContext = await this.dependencies.models.createContext(settings, {
        sessionId,
        messageId: initialTargetMessage.id,
        submittedAt: options?.submittedAt,
        generationStartedAt,
      })
      const { model } = modelContext
      // Reasoning options are scoped to the provider+model they were configured for;
      // resolving here guarantees a switched model never inherits another model's parameters.
      const reasoningProviderOptions = resolveReasoningProviderOptions(settings, settings.provider, settings.modelId)
      const knowledgeBase = host.getKnowledgeBase(sessionId)
      const webBrowsing = host.getWebBrowsing(sessionId, settings.provider, settings)
      const agentModeSupported =
        this.dependencies.capabilities.supports('agent-mode') && model.isSupportToolUse('agent')
      const agentModeEntry = host.getAgentModeEntry(sessionId, session)
      const agentModeValue = agentModeSupported ? agentModeEntry.value : 'off'

      if (
        options?.operationType === 'send_message' &&
        !options.appendToMessage &&
        !options.skipAgentModeSuggestion &&
        agentModeSupported &&
        agentModeValue === 'auto' &&
        lastUserMessage &&
        history.userMessageCount === 1
      ) {
        const namingModel = globalSettings.threadNamingModel
        const suggestionModel = await this.createSuggestionModel(settings, namingModel, modelContext.context, model)
        const decision = await this.shouldSuggestAgentMode({
          sessionId,
          model: suggestionModel,
          userMessage: lastUserMessage,
          signal: controller.signal,
          // A separate naming model uses its own defaults. The session's options
          // only apply when classification falls back to the conversation model.
          providerOptions: suggestionModel === model ? reasoningProviderOptions : undefined,
        })

        if (controller.signal.aborted) {
          targetMessage = {
            ...targetMessage,
            generating: false,
            status: [],
            finishReason: 'canceled',
          }
          await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
          return
        }

        analytics.trackSuggestionDecision(
          {
            sessionId,
            provider: settings.provider,
            model: settings.modelId,
          },
          decision.suggest,
          lastUserMessage.files?.length ?? 0
        )

        if (decision.suggest) {
          analytics.trackAgentModeSuggested({
            hasFiles: Boolean(lastUserMessage.files?.length),
            fileCount: lastUserMessage.files?.length ?? 0,
          })
          targetMessage = {
            ...targetMessage,
            generating: false,
            contentParts: [{ type: 'agent-mode-suggestion', reason: decision.reason }],
            status: [],
            finishReason: 'agent-mode-suggested',
          }
          await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
          return
        }

        await host.setAgentMode(sessionId, 'off')
      }

      const prepared = await this.dependencies.preparation.prepare({
        session,
        settings,
        globalSettings,
        config,
        messages,
        targetMessageIndex: promptTargetMessageIndex,
        history,
        model,
        modelContext: modelContext.context,
        attachments: this.dependencies.attachments,
        knowledgeBase,
        webBrowsing,
        agentModeValue,
        agentModeLocked: Boolean(agentModeEntry.locked),
        agentModeSupported,
        signal: controller.signal,
        providerOptions: reasoningProviderOptions,
        preserveLastPromptMessageToolCalls: Boolean(options?.appendToMessage),
        compactionPoints: source.compactionPoints,
        lockAgentMode: (reason) => {
          void host.lockAgentMode(sessionId, reason)
        },
      })
      if (!options?.appendToMessage) {
        infoParts.push(...prepared.infoParts)
      }

      const chatOptions = { ...prepared.chatOptions }
      let segmentStartedAt = startedAt
      // When the current segment has produced no output yet, the steered user
      // belongs before it — anchored at the target's predecessor.
      let preSteerAnchorMessageId = messages[targetMessageIndex - 1]?.id
      // Set when a split was abandoned: later steers must still land after the
      // ones already stored, not back at the assistant they all interrupted.
      let lastUnsplitSteerMessageId: string | undefined

      const splitGeneratingSegment = async (
        anchorMessageId: string,
        finishReason: string,
        prefixParts: MessageContentParts,
        tailParts: MessageContentParts
      ): Promise<boolean> => {
        const previousMessageId = generationMessageId
        const splitWriter = sessions.splitStreamingMessage
        if (
          !splitWriter ||
          controller.signal.aborted ||
          this.dependencies.runtime.get(sessionId, previousMessageId)?.phase === 'stopping'
        )
          return false

        const continuation: Message = {
          ...createMessage('assistant'),
          generating: true,
          contentParts: tailParts,
          status: [],
          aiProvider: targetMessage.aiProvider,
          model: targetMessage.model,
          modelId: targetMessage.modelId,
          name: targetMessage.name,
          style: targetMessage.style,
          isStreamingMode: targetMessage.isStreamingMode,
        }
        const completedParts = prefixParts.map((part) => ({ ...part }))
        this.finalizePartDurations(completedParts)
        const finalizedSegment: Message = {
          ...targetMessage,
          generating: false,
          contentParts: completedParts,
          status: [],
          finishReason,
          usage: processorState.usage ?? targetMessage.usage,
          generationDuration: host.now() - segmentStartedAt,
        }
        return segmentTransitions.run(
          async () => {
            try {
              return await splitWriter(
                sessionId,
                {
                  prefix: finalizedSegment,
                  continuation,
                  afterMessageId: anchorMessageId,
                },
                controller.signal
              )
            } catch (error) {
              this.dependencies.logger.log('error', 'Atomic segment split failed; continuing in place', { error })
              return false
            }
          },
          () => {
            targetMessage = continuation
            processorState = createInitialState(tailParts)
            infoParts.length = 0
            segmentStartedAt = host.now()
            firstTokenLatency = undefined
            generationMessageId = continuation.id
            lastUnsplitSteerMessageId = undefined
            preSteerAnchorMessageId = anchorMessageId
            this.dependencies.runtime.retarget(sessionId, previousMessageId, continuation.id, runtimeState)
            steering?.admitAnchor(continuation.id)
          }
        )
      }

      const compaction = this.dependencies.compaction
      const midRunCompaction = compaction
        ? new MidRunCompactionController({
            thresholdTokens:
              Object.keys(prepared.tools).length > 0 && isAutoCompactionEnabled(settings, globalSettings)
                ? compaction.getThresholdTokens(settings, globalSettings)
                : null,
            signal: controller.signal,
            getContentParts: () => [...infoParts, ...processorState.contentParts],
            splitPrefix: (prefix, tail) => splitGeneratingSegment(targetMessage.id, 'compacted', prefix, tail),
            getTargetMessageId: () => targetMessage.id,
            compact: async (request) => {
              // Planning reads persisted ancestry, so publish the retained round before resolving it.
              await sessions.persistStreamingMessage(sessionId, targetMessage, {
                checkpoint: true,
                onlyIfGenerating: true,
              })
              if (controller.signal.aborted) return { status: 'cancelled' }
              return compaction.compact(sessionId, request, controller.signal)
            },
            onFailure: (error) => {
              this.dependencies.logger.log('error', 'Mid-run compaction failed; keeping the last valid context', {
                error,
              })
            },
          })
        : undefined

      if (steering || this.dependencies.compaction) {
        const basePrepareStep = chatOptions.prepareStep
        chatOptions.prepareStep = async (prepareStepOptions) => {
          const base = await basePrepareStep?.(prepareStepOptions)
          let stepMessages = base?.messages ?? prepareStepOptions.messages

          if (steering) {
            // AI SDK calls prepareStep only after the previous provider response
            // and its complete tool-call batch have settled. The steered user
            // enters the durable transcript and the next LLM request at that
            // boundary, in true causal order.
            const hasSegmentOutput = processorState.contentParts.length > 0
            const anchorMessageId =
              lastUnsplitSteerMessageId ?? (hasSegmentOutput ? targetMessage.id : preSteerAnchorMessageId)
            if (anchorMessageId) {
              const injection = await steering.inject(stepMessages, anchorMessageId).catch((error) => {
                this.dependencies.logger.log('error', 'Steering injection failed', { error })
                return undefined
              })
              if (injection?.consumed.length && hasSegmentOutput) {
                const split = await splitGeneratingSegment(
                  injection.consumed[injection.consumed.length - 1].id,
                  'steered',
                  [...infoParts, ...processorState.contentParts],
                  []
                )
                if (!split) {
                  lastUnsplitSteerMessageId = injection.consumed[injection.consumed.length - 1].id
                }
              }
              if (injection?.messages) {
                stepMessages = injection.messages
              }
            }
          }

          if (midRunCompaction) {
            stepMessages = await midRunCompaction.prepareStep(stepMessages, prepareStepOptions.stepNumber ?? 0)
          }

          return { ...(base ?? {}), messages: stepMessages }
        }
      }
      if (Object.keys(prepared.tools).length > 0) {
        chatOptions.tools = shouldPauseOnToolCallLimit(settings, globalSettings)
          ? withToolCallLimitPause(prepared.tools, MAX_TOOL_CALLS_BEFORE_CONFIRMATION)
          : prepared.tools
      }

      const stream = model.chatStream(prepared.coreMessages, chatOptions) as AsyncGenerator<ModelStreamPart<ToolSet>>
      this.dependencies.runtime.setPhase(sessionId, generationMessageId, 'streaming', runtimeState)

      processorState = createInitialState(
        options?.appendToMessage
          ? targetMessage.contentParts
          : prepared.fallbackToolCallPart
            ? [prepared.fallbackToolCallPart]
            : undefined
      )

      const streamCallbacks = {
        memoryToolContext: prepared.memoryToolContext,
        onFileReceived: async (mediaType: string, base64: string) => {
          const storageKey = host.createPictureStorageKey(session.id, targetMessage.id)
          await this.dependencies.blobs.set(storageKey, `data:${mediaType};base64,${base64}`)
          return storageKey
        },
        onLargeToolResult: async (toolCallId: string, serialized: string) => {
          const storageKey = `tool-result:${session.id}:${toolCallId}`
          await this.dependencies.blobs.set(storageKey, serialized)
          return storageKey
        },
      }

      // Race each read with Stop so a tool that ignores abortSignal cannot keep
      // the UI message and its timers running until the provider stream settles.
      const streamIterator = stream[Symbol.asyncIterator]()
      const abortWait = new Promise<{ type: 'aborted' }>((resolve) => {
        if (controller.signal.aborted) resolve({ type: 'aborted' })
        else controller.signal.addEventListener('abort', () => resolve({ type: 'aborted' }), { once: true })
      })
      let abortedMidStream = false
      try {
        while (true) {
          const nextChunk = streamIterator.next()
          const raced = await Promise.race([
            nextChunk.then((iteration) => ({ type: 'chunk' as const, iteration })),
            abortWait,
          ])
          if (raced.type === 'aborted') {
            nextChunk.then(
              () => {},
              () => {}
            )
            abortedMidStream = true
            break
          }
          if (raced.iteration.done) break
          const chunk = raced.iteration.value

          const stateBeforeChunk = processorState
          const result = await processStreamChunk(chunk, processorState, streamCallbacks)
          // Do not publish an old checkpoint across a committed target handoff.
          await segmentTransitions.settle()
          // Chunk processing can await blob storage or other host work. Stop may
          // land during that await, so do not publish a stale generating
          // checkpoint after the runtime has entered its terminal path.
          if (controller.signal.aborted) {
            if (processorState === stateBeforeChunk) processorState = result.state
            break
          }
          // A steering split can finalize the segment and hand the run a fresh
          // state while this chunk is still being processed. Its result belongs
          // to the segment that has already been persisted, so writing it back
          // would both resurrect the old parts and let later deltas mutate a
          // message the transcript considers finished.
          if (processorState !== stateBeforeChunk) continue
          processorState = result.state
          if (result.persistentToolCallPause) {
            processorState = applyPersistentToolCallPause(processorState, result.persistentToolCallPause)
          }

          if (result.skipUpdate) {
            if (result.statusChunk?.type === 'status') {
              targetMessage = {
                ...targetMessage,
                status: result.statusChunk.status ? [result.statusChunk.status] : [],
              }
              sessions.updateStreamingCache(sessionId, targetMessage)
            }
            continue
          }

          const nextMessage: Message = {
            ...targetMessage,
            contentParts: [...infoParts, ...processorState.contentParts],
          }
          const textLength = getMessageText(nextMessage, true, true).length
          if (!firstTokenLatency && textLength > 0) {
            firstTokenLatency = host.now() - segmentStartedAt
          }
          targetMessage = {
            ...nextMessage,
            status: textLength > 0 || result.clearStatus ? [] : nextMessage.status,
            firstTokenLatency,
          }

          const shouldPersist = shouldPersistStreamingChunk(
            chunk.type,
            host.now() - lastPersistTimestamp,
            STREAM_PERSIST_INTERVAL_MS
          )
          if (shouldPersist) {
            void sessions
              .persistStreamingMessage(sessionId, targetMessage, { checkpoint: true })
              .catch((error: unknown) => {
                if (sessions.isSessionMissingError?.(error)) return
                try {
                  const logged = this.dependencies.logger.log('error', 'Failed to persist generation checkpoint', {
                    errorType: error instanceof Error ? error.name : typeof error,
                  })
                  void Promise.resolve(logged).catch(() => {})
                } catch {
                  // Logging must not turn a handled checkpoint failure into an unhandled rejection.
                }
              })
            lastPersistTimestamp = host.now()
          } else {
            sessions.updateStreamingCache(sessionId, targetMessage)
          }
        }
      } finally {
        if (!abortedMidStream) {
          await streamIterator.return?.(undefined)?.catch(() => {})
        }
      }

      if (controller.signal.aborted) {
        let drain: Promise<void> | undefined
        if (abortedMidStream) {
          drain = (async () => {
            try {
              await streamIterator.return?.(undefined)
            } catch {
              // The message is already terminal; the settled stream may surface
              // its abort as a rejection and has nothing left to report.
            }
          })()
          this.dependencies.runtime.registerUnsettledStreamDrain(sessionId, drain)
        }
        try {
          await persistAbortedGenerationIfNeeded()
        } finally {
          if (drain) await drain
        }
        return
      }

      if (processorState.contentParts.some((part) => part.type === 'tool-call' && part.state === 'paused')) {
        targetMessage = {
          ...targetMessage,
          generating: false,
          contentParts: [...infoParts, ...processorState.contentParts],
          status: [],
          finishReason: 'tool-call-paused',
          usage: processorState.usage,
        }
        await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
        this.dependencies.runtime.setPhase(sessionId, generationMessageId, 'paused', runtimeState)
        return
      }

      this.finalizePartDurations(processorState.contentParts)
      processorState = {
        ...processorState,
        contentParts: model.normalizeCompletedResponse(processorState.contentParts, processorState.finishReason),
      }
      targetMessage = {
        ...targetMessage,
        generating: false,
        contentParts: [...infoParts, ...processorState.contentParts],
        status: [],
        finishReason: processorState.finishReason,
        usage: processorState.usage,
        generationDuration: host.now() - segmentStartedAt,
      }
      await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
      if (options?.operationType === 'send_message') {
        host.markFirstSuccessfulChatCompleted()
      }
      host.afterMessageGenerated(sessionId, targetMessage)
    } catch (error: unknown) {
      if (sessions.isSessionMissingError?.(error)) return
      const pause = getToolCallPause(error)
      if (pause) {
        targetMessage = {
          ...targetMessage,
          generating: false,
          contentParts: [
            ...infoParts,
            ...markToolCallPaused(processorState.contentParts, pause.toolCallId, pause.pauseReason),
          ],
          status: [],
          finishReason: 'tool-call-paused',
          usage: processorState.usage,
        }
        await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
        this.dependencies.runtime.setPhase(sessionId, generationMessageId, 'paused', runtimeState)
        return
      }

      if (await persistAbortedGenerationIfNeeded()) return

      targetMessage = sessions.handleGenerationError(error, targetMessage, settings, {
        agentMode: host.getAgentModeEntry(sessionId, session).value,
        operationType: options?.operationType,
      })
      await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
      host.afterMessageFailed(sessionId, targetMessage)
    } finally {
      finishRuntime()
      steering?.release()
      this.dependencies.steering?.wake(sessionId)
    }
  }

  stopPausedToolCall(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    options?: { denyReason?: ApprovalDenyReason }
  ): Promise<void> {
    return this.dependencies.coordination
      .runExclusive(sessionId, () =>
        this.stopPausedToolCallUnlocked(sessionId, messageId, toolCallId, options?.denyReason ?? 'user')
      )
      .finally(() => {
        this.dependencies.coordination.wakeBackgroundTaskFollowUps(sessionId)
        this.dependencies.steering?.wake(sessionId)
      })
  }

  continuePausedToolCall(sessionId: string, messageId: string, toolCallId: string): Promise<void> {
    return this.dependencies.coordination
      .runExclusive(sessionId, () => this.continuePausedToolCallUnlocked(sessionId, messageId, toolCallId))
      .finally(() => {
        this.dependencies.coordination.wakeBackgroundTaskFollowUps(sessionId)
        this.dependencies.steering?.wake(sessionId)
      })
  }

  /** Persist a tool-limit opt-out, then resume the paused batch in the background. */
  async disableToolCallLimitPauseAndContinue(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    scope: 'session' | 'global'
  ): Promise<void> {
    const { analytics, coordination, logger, sessions, settings } = this.dependencies
    analytics.trackPauseAction({
      type: 'tool_limit',
      action: scope === 'global' ? 'disable_global' : 'disable_session',
    })

    try {
      if (scope === 'global') {
        settings.updateSettings({ pauseOnToolCallLimit: false })
        await sessions.updateSessionSettings(sessionId, (current) => {
          const { pauseOnToolCallLimit: _removed, ...next } = current ?? {}
          return next
        })
      } else {
        await sessions.updateSessionSettings(sessionId, (current) => ({
          ...current,
          pauseOnToolCallLimit: false,
        }))
      }
    } finally {
      void coordination
        .runExclusive(sessionId, () =>
          this.continuePausedToolCallUnlocked(sessionId, messageId, toolCallId, {
            skipPauseActionTracking: true,
          })
        )
        .finally(() => {
          coordination.wakeBackgroundTaskFollowUps(sessionId)
          this.dependencies.steering?.wake(sessionId)
        })
        .catch((error) => logger.log('error', 'Failed to continue the paused tool call', { error }))
    }
  }

  retryFromLastToolCallAfterApiError(sessionId: string, messageId: string, toolCallId: string): Promise<void> {
    return this.dependencies.coordination.runExclusive(sessionId, () =>
      this.retryFromLastToolCallAfterApiErrorUnlocked(sessionId, messageId, toolCallId)
    )
  }

  private async stopPausedToolCallUnlocked(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    denyReason: ApprovalDenyReason
  ): Promise<void> {
    const { sessions, analytics } = this.dependencies
    const selected = await this.readMessages({ sessionId, messageIds: [messageId] })
    if (!selected) return
    const settings = await sessions.getSessionSettings(sessionId, selected.header)
    const message = selected.messages[0]
    if (!message) return
    const part = findToolCallPart(message, toolCallId)
    if (!part || part.state !== 'paused') return

    const isApproval = isApprovalPauseReason(part.pauseReason)
    const approvalTarget = getApprovalTrackingTarget(part)
    analytics.trackPauseAction({
      type: isApproval ? 'approval' : 'tool_limit',
      action: isApproval ? (denyReason === 'timeout' ? 'timeout' : 'deny') : 'stop',
      context:
        isApproval && approvalTarget
          ? {
              sessionId,
              mode: 'work_mode',
              provider: settings?.provider,
              model: settings?.modelId,
            }
          : undefined,
      approvalTarget,
    })

    const pauseReason = part.pauseReason
    if (
      pauseReason?.type === 'user_exec_approval' ||
      pauseReason?.type === 'command_escalation_approval' ||
      pauseReason?.type === 'file_mutation_approval' ||
      pauseReason?.type === 'app_action_approval'
    ) {
      const deniedResult = buildDeniedApprovalResult(pauseReason.type, denyReason)
      // Denial is batch-scoped so the model sees one consistent refusal. Approval
      // remains per-call because every authorized action must be reviewed individually.
      const approvalBatchIds = new Set(
        findPausedApprovalBatch(message, toolCallId).map((batchPart) => batchPart.toolCallId)
      )
      const nextMessage = updateToolCallParts(
        message,
        (batchPart) => approvalBatchIds.has(batchPart.toolCallId),
        (batchPart) => ({
          ...batchPart,
          state: 'error',
          pauseReason: undefined,
          result:
            batchPart.toolCallId === toolCallId
              ? deniedResult
              : { error: denyReason === 'timeout' ? APPROVAL_TIMEOUT_DENIAL : 'Approval denied by user.' },
          startTime: undefined,
          duration: undefined,
        })
      )
      await sessions.modifyMessage(sessionId, nextMessage, true)
      if (!hasPausedToolCallPart(nextMessage)) {
        this.dependencies.runtime.clear(sessionId, messageId)
        await this.orchestrate(
          sessionId,
          { ...nextMessage, generating: true },
          { operationType: 'regenerate', appendToMessage: true }
        )
      }
      return
    }

    // Tool-call-limit pauses freeze the whole in-flight batch, so Stop must clear
    // the same batch instead of resurfacing one paused call at a time.
    const stopBatchIds = new Set(
      findPausedToolCallLimitBatch(message, toolCallId).map((batchPart) => batchPart.toolCallId)
    )
    if (stopBatchIds.size === 0) {
      stopBatchIds.add(toolCallId)
    }
    const stoppedMessage = updateToolCallParts(
      message,
      (batchPart) => stopBatchIds.has(batchPart.toolCallId),
      (batchPart) => ({
        ...batchPart,
        state: 'error',
        pauseReason: undefined,
        result: { error: 'Tool execution stopped by user.' },
      })
    )
    await sessions.modifyMessage(sessionId, stoppedMessage, true)
    if (!hasPausedToolCallPart(stoppedMessage)) {
      this.dependencies.runtime.clear(sessionId, messageId)
    }
  }

  private async continuePausedToolCallUnlocked(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    options?: { skipPauseActionTracking?: boolean }
  ): Promise<void> {
    const { sessions, analytics, host } = this.dependencies
    const source = await this.readTargetContext(sessionId, messageId)
    if (!source) return
    const settings = await sessions.getSessionSettings(sessionId, source.header)
    if (!settings) return
    let message = source.targetMessage
    if (!message) return
    const part = findToolCallPart(message, toolCallId)
    if (!part || part.state !== 'paused') return
    if (!(await this.isCurrentToolTarget(sessionId, message))) return

    const isApproval = isApprovalPauseReason(part.pauseReason)
    const approvalTarget = getApprovalTrackingTarget(part)
    if (!options?.skipPauseActionTracking) {
      analytics.trackPauseAction({
        type: isApproval ? 'approval' : 'tool_limit',
        action: isApproval ? 'approve' : 'continue',
        context:
          isApproval && approvalTarget
            ? {
                sessionId,
                mode: 'work_mode',
                provider: settings.provider,
                model: settings.modelId,
              }
            : undefined,
        approvalTarget,
      })
    }

    // Limit continuations resume the frozen batch; approval continuations execute
    // only the reviewed call and keep the authorization binding call-scoped.
    const toolCallLimitBatch = findPausedToolCallLimitBatch(message, toolCallId)
    const isLimitContinue = toolCallLimitBatch.length > 0
    const batch = isLimitContinue ? toolCallLimitBatch : [part]
    const approvedToolCallId = isApproval ? toolCallId : undefined
    const batchIds = new Set(batch.map((batchPart) => batchPart.toolCallId))
    const runtimeState = this.dependencies.runtime.start(sessionId, messageId)
    const controller = runtimeState.abortController

    message = {
      ...updateToolCallParts(
        message,
        (batchPart) => batchIds.has(batchPart.toolCallId),
        (batchPart) => ({
          ...batchPart,
          state: 'call',
          // Preserve approval bindings for an interrupted retry of this exact request.
          pauseReason:
            batchPart.pauseReason?.type === 'app_action_approval' ||
            batchPart.pauseReason?.type === 'file_mutation_approval'
              ? batchPart.pauseReason
              : undefined,
          result: undefined,
          resultStorageKey: undefined,
          resultImageStorageKey: undefined,
          resultImageMediaType: undefined,
          startTime: host.now(),
          duration: undefined,
        })
      ),
      generating: true,
    }
    await sessions.modifyMessage(sessionId, message, false)

    try {
      const tools = await this.dependencies.tools.buildToolsForPausedToolCall(
        source,
        settings,
        message,
        controller.signal
      )
      for (const batchPart of batch) {
        if (controller.signal.aborted) break

        const toolValue = (tools as Record<string, unknown>)[batchPart.toolName]
        const executableTool = toolValue && typeof toolValue === 'object' ? (toolValue as ExecutableTool) : undefined
        if (typeof executableTool?.execute !== 'function') {
          throw new Error(`Tool "${batchPart.toolName}" is not available`)
        }

        try {
          const result = await executableTool.execute(
            batchPart.args,
            createPausedToolCallExecutionContext(batchPart, approvedToolCallId, controller.signal)
          )
          message = updateToolCallPart(message, batchPart.toolCallId, (toolPart) => ({
            ...toolPart,
            state: 'result',
            pauseReason: undefined,
            result,
            duration: toolPart.startTime ? host.now() - toolPart.startTime : undefined,
          }))
        } catch (error) {
          if (controller.signal.aborted) break

          const pause = getToolCallPause(error)
          message = updateToolCallPart(message, batchPart.toolCallId, (toolPart) =>
            pause
              ? {
                  ...toolPart,
                  state: 'paused',
                  pauseReason: pause.pauseReason,
                  result: undefined,
                  startTime: undefined,
                  duration: undefined,
                }
              : {
                  ...toolPart,
                  state: 'error',
                  pauseReason: undefined,
                  result: { error: error instanceof Error ? error.message : String(error) },
                  duration: toolPart.startTime ? host.now() - toolPart.startTime : undefined,
                }
          )
        }
        // Progress updates stay cache-only; the batch is persisted once after the loop.
        await sessions.modifyMessage(sessionId, message, false, true)
      }

      if (controller.signal.aborted) {
        message = cancelRunningToolCallBatch(message, batchIds, getAbortStoppedAt(controller.signal, host.now()))
        await sessions.modifyMessage(sessionId, finishPausedToolCallContinuation(message, 'canceled'), true)
        this.dependencies.runtime.clear(sessionId, messageId, runtimeState)
        return
      }

      if (hasPausedToolCallPart(message)) {
        await sessions.modifyMessage(sessionId, finishPausedToolCallContinuation(message, 'tool-call-paused'), true)
        this.dependencies.runtime.setPhase(sessionId, messageId, 'paused', runtimeState)
        return
      }

      await sessions.modifyMessage(sessionId, message, true)
      if (controller.signal.aborted) {
        message = cancelRunningToolCallBatch(message, batchIds, getAbortStoppedAt(controller.signal, host.now()))
        await sessions.modifyMessage(sessionId, finishPausedToolCallContinuation(message, 'canceled'), true)
        this.dependencies.runtime.clear(sessionId, messageId, runtimeState)
        return
      }

      this.dependencies.runtime.clear(sessionId, messageId, runtimeState)
      await this.orchestrate(
        sessionId,
        { ...message, generating: true },
        { operationType: 'regenerate', appendToMessage: true, externalAbortSignal: controller.signal }
      )
    } catch (error) {
      analytics.captureException(error, {
        operation: 'tool_pause_continue',
        provider: settings.provider,
        model: settings.modelId,
        agentMode: host.getAgentModeEntry(sessionId, source.header).value,
        fullAccess: resolveCommandApprovalMode(settings) === 'full_access',
        toolName: part.toolName,
        pauseType: part.pauseReason?.type,
      })
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failedMessage = controller.signal.aborted
        ? cancelRunningToolCallBatch(message, batchIds, getAbortStoppedAt(controller.signal, host.now()))
        : updateToolCallParts(
            message,
            (batchPart) => batchIds.has(batchPart.toolCallId) && batchPart.state === 'call',
            (batchPart) => ({
              ...batchPart,
              state: 'error',
              pauseReason: undefined,
              result: { error: errorMessage },
              duration: batchPart.startTime ? host.now() - batchPart.startTime : undefined,
            })
          )
      // The batch is now terminal. Keep an explicit failure reason so reply-success
      // detection cannot count this failed continuation as a successful assistant reply.
      const terminalMessage = finishPausedToolCallContinuation(
        failedMessage,
        controller.signal.aborted ? 'canceled' : 'error'
      )
      await sessions.modifyMessage(sessionId, terminalMessage, true)
      if (!hasPausedToolCallPart(failedMessage)) {
        this.dependencies.runtime.clear(sessionId, messageId, runtimeState)
      }
    }
  }

  private async retryFromLastToolCallAfterApiErrorUnlocked(
    sessionId: string,
    messageId: string,
    toolCallId: string
  ): Promise<void> {
    const { sessions, analytics, host } = this.dependencies
    const source = await this.readTargetContext(sessionId, messageId)
    if (!source) return
    const message = source.targetMessage
    if (!message) return
    const part = findToolCallPart(message, toolCallId)
    const lastRetryableToolCall = findLastRetryableToolCallPart(message)
    if (!part || !isRetryableToolCallStep(part) || lastRetryableToolCall?.toolCallId !== toolCallId) {
      return
    }

    const retrySourceMessage: Message = {
      ...message,
      generating: false,
      error: undefined,
      errorCode: undefined,
      errorExtra: undefined,
      contentParts: keepContentPartsThroughToolCall(message, toolCallId),
    }

    if (part.state === 'call') {
      const settings = await sessions.getSessionSettings(sessionId, source.header)
      if (!settings) return
      if (!(await this.isCurrentToolTarget(sessionId, message))) return

      let retryMessage = updateToolCallPart(retrySourceMessage, toolCallId, (toolPart) => ({
        ...toolPart,
        state: 'call',
        result: undefined,
        resultStorageKey: undefined,
        resultImageStorageKey: undefined,
        resultImageMediaType: undefined,
        resultProviderMetadata: undefined,
        startTime: host.now(),
        duration: undefined,
      }))
      await sessions.modifyMessage(sessionId, retryMessage, false)

      const retryRuntime = this.dependencies.runtime.start(sessionId, messageId)
      try {
        const tools = await this.dependencies.tools.buildToolsForPausedToolCall(
          source,
          settings,
          retryMessage,
          retryRuntime.abortController.signal
        )
        const toolValue = (tools as Record<string, unknown>)[part.toolName]
        const executableTool = toolValue && typeof toolValue === 'object' ? (toolValue as ExecutableTool) : undefined
        if (typeof executableTool?.execute !== 'function') {
          throw new Error(`Tool "${part.toolName}" is not available`)
        }

        retryRuntime.abortController.signal.throwIfAborted()
        const result = await executableTool.execute(part.args, {
          abortSignal: retryRuntime.abortController.signal,
          toolCallId,
          approved: true,
          ...(part.pauseReason?.type === 'file_mutation_approval' && part.pauseReason.editPreview
            ? { approvalFileVersion: part.pauseReason.editPreview.version }
            : {}),
          ...(part.pauseReason?.type === 'user_exec_approval' ||
          part.pauseReason?.type === 'command_escalation_approval'
            ? { approvalWorkdir: part.pauseReason.workdir }
            : {}),
          ...(part.pauseReason?.type === 'command_escalation_approval'
            ? { approvalRetryOf: part.pauseReason.retryOf }
            : {}),
          approvalDetails: part.pauseReason?.type === 'app_action_approval' ? part.pauseReason.details : undefined,
        })
        retryRuntime.abortController.signal.throwIfAborted()
        retryMessage = updateToolCallPart(retryMessage, toolCallId, (toolPart) => ({
          ...toolPart,
          state: 'result',
          pauseReason: undefined,
          result,
          duration: toolPart.startTime ? host.now() - toolPart.startTime : undefined,
        }))
        await sessions.modifyMessage(sessionId, retryMessage, true)
        retryRuntime.abortController.signal.throwIfAborted()

        this.dependencies.runtime.clear(sessionId, messageId, retryRuntime)
        await this.orchestrate(
          sessionId,
          { ...retryMessage, generating: true },
          {
            operationType: 'regenerate',
            appendToMessage: true,
            externalAbortSignal: retryRuntime.abortController.signal,
          }
        )
      } catch (error) {
        if (retryRuntime.abortController.signal.aborted) {
          await sessions.modifyMessage(
            sessionId,
            finishPausedToolCallContinuation(
              cancelRunningToolCallBatch(
                retryMessage,
                new Set([toolCallId]),
                getAbortStoppedAt(retryRuntime.abortController.signal, host.now())
              ),
              'canceled'
            ),
            true
          )
          return
        }
        const pause = getToolCallPause(error)
        if (pause) {
          await sessions.modifyMessage(
            sessionId,
            finishPausedToolCallContinuation(
              updateToolCallPart(retryMessage, toolCallId, (toolPart) => ({
                ...toolPart,
                state: 'paused',
                pauseReason: pause.pauseReason,
                result: undefined,
                startTime: undefined,
                duration: undefined,
              })),
              'tool-call-paused'
            ),
            true
          )
          return
        }

        analytics.captureException(error, {
          operation: 'tool_retry',
          provider: settings.provider,
          model: settings.modelId,
          agentMode: host.getAgentModeEntry(sessionId, source.header).value,
          fullAccess: resolveCommandApprovalMode(settings) === 'full_access',
          toolName: part.toolName,
        })
        const errorMessage = error instanceof Error ? error.message : String(error)
        await sessions.modifyMessage(
          sessionId,
          updateToolCallPart(retryMessage, toolCallId, (toolPart) => ({
            ...toolPart,
            state: 'error',
            pauseReason: undefined,
            result: { error: errorMessage },
            duration: toolPart.startTime ? host.now() - toolPart.startTime : undefined,
          })),
          true
        )
      } finally {
        this.dependencies.runtime.clear(sessionId, messageId, retryRuntime)
      }
      return
    }

    await sessions.modifyMessage(sessionId, retrySourceMessage, true)
    await this.orchestrate(
      sessionId,
      { ...retrySourceMessage, generating: true },
      { operationType: 'regenerate', appendToMessage: true }
    )
  }

  private async shouldSuggestAgentMode(options: {
    sessionId: string
    model: ModelInterface
    userMessage: Message
    signal: AbortSignal
    providerOptions?: SessionSettings['providerOptions']
  }): Promise<AgentModeSuggestionDecision> {
    const userPrompt = describeUserMessageForAgentModeDecision(options.userMessage)
    const promptMessages: ModelMessage[] = options.model.isSupportSystemMessage()
      ? [
          { role: 'system', content: AGENT_MODE_SUGGESTION_PROMPT },
          { role: 'user', content: userPrompt },
        ]
      : [{ role: 'user', content: `${AGENT_MODE_SUGGESTION_PROMPT}\n\n${userPrompt}` }]

    try {
      const result = await options.model.chat(promptMessages, {
        sessionId: options.sessionId,
        signal: options.signal,
        providerOptions: options.providerOptions,
      })
      const text = getMessageText({
        id: 'agent-mode-decision',
        role: 'assistant',
        contentParts: result.contentParts,
      })
      return parseAgentModeSuggestionDecision(text) ?? { suggest: false }
    } catch (error) {
      if (options.signal.aborted) return { suggest: false }
      this.dependencies.logger.log('warn', 'Agent mode suggestion decision failed', { error })
      this.dependencies.analytics.captureException(error, {
        operation: 'suggestion',
        model: options.model.modelId,
      })
      return { suggest: false }
    }
  }

  private async createSuggestionModel(
    settings: SessionSettings,
    namingModel: { provider: string; model: string } | undefined | null,
    context: TContext,
    fallbackModel: ModelInterface
  ): Promise<ModelInterface> {
    if (!namingModel) return fallbackModel
    try {
      return await this.dependencies.models.createWithContext(
        {
          ...settings,
          provider: namingModel.provider as ModelProvider,
          modelId: namingModel.model,
        },
        context
      )
    } catch (error) {
      this.dependencies.logger.log('warn', 'Failed to create Agent Mode suggestion model', { error })
      this.dependencies.analytics.captureException(error, {
        operation: 'suggestion_model',
        provider: namingModel.provider,
        model: namingModel.model,
      })
      return fallbackModel
    }
  }

  private finalizePartDurations(parts: MessageContentParts): void {
    const now = this.dependencies.host.now()
    for (const part of parts) {
      if (part.type === 'reasoning' && part.startTime && !part.duration) {
        part.duration = now - part.startTime
      }
      if (
        part.type === 'tool-call' &&
        part.startTime &&
        !part.duration &&
        (part.state === 'result' || part.state === 'error')
      ) {
        part.duration = now - part.startTime
      }
    }
  }
}
