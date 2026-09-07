import type { ChatStreamOptions, ModelInterface, ModelStreamPart } from '@shared/models/types'
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
import { resolveCommandApprovalMode } from '@shared/types/command-execution'
import { getMessageText } from '@shared/utils/message'
import { resolveReasoningProviderOptions } from '@shared/utils/reasoning-control'
import { MAX_TOOL_CALLS_BEFORE_CONFIRMATION, shouldPauseOnToolCallLimit } from '@shared/utils/tool-call-limit-pause'
import type { ModelMessage, ToolSet } from 'ai'
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
import {
  AGENT_MODE_SUGGESTION_PROMPT,
  type AgentModeSuggestionDecision,
  describeUserMessageForAgentModeDecision,
  getLastUserMessage,
  isFirstUserTurn,
  parseAgentModeSuggestionDecision,
} from './agent-mode-suggestion'
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
import type { GenerationRuntimeStore } from './runtime-store'
import { createInitialState, processStreamChunk } from './stream-chunk-processor'

const STREAM_PERSIST_INTERVAL_MS = 2_000

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
      approvalDetails?: AppActionApprovalDetails
      abortSignal?: AbortSignal
    }
  ) => unknown
}

export type GenerationOperationType = 'send_message' | 'regenerate'
export type GenerationAgentModeEntrySource = 'suggestion_accept' | 'locked_session' | 'manual' | 'none'

export interface GenerationOptions {
  operationType?: GenerationOperationType
  appendToMessage?: boolean
  skipAgentModeSuggestion?: boolean
  agentModeEntrySource?: GenerationAgentModeEntrySource
  contextMessages?: Message[]
  externalAbortSignal?: AbortSignal
}

export interface GenerationSessionPort extends Pick<SessionRepositoryPort, 'getSession'> {
  isSessionMissingError?(error: unknown): boolean
  getSessionSettings(sessionId: string): Promise<SessionSettings | null | undefined>
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
  persistStreamingMessage(sessionId: string, message: Message, options?: { refreshCounting?: boolean }): Promise<void>
  /**
   * Insert a new durable message directly after an existing one (fork/thread
   * aware). Rejects rather than appending elsewhere when the anchor is
   * unreachable, and is idempotent for a message id already present, so an
   * ambiguous failure can be resolved by retrying.
   */
  insertMessageAfter(sessionId: string, message: Message, afterMessageId: string): Promise<void>
  updateStreamingCache(sessionId: string, message: Message): void
  findTargetMessageIndex(session: Session, targetMessageId: string): { messages: Message[]; index: number } | null
  getCompactionPointsForTarget(session: Session, targetMessageId: string): CompactionPoint[] | undefined
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

export interface GenerationModelFactoryPort<TContext> extends ModelFactoryPort {
  createContext(settings: SessionSettings): Promise<GenerationModelContext<TContext>>
  createWithContext(settings: SessionSettings, context: TContext): Promise<ModelInterface>
}

export interface GenerationPreparationRequest<TContext> {
  session: Session
  settings: SessionSettings
  globalSettings: Settings
  config: Config
  messages: Message[]
  targetMessageIndex: number
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
  buildToolsForPausedToolCall(session: Session, settings: SessionSettings, targetMessage: Message): Promise<ToolSet>
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
  register(sessionId: string, conversationMessageIds: ReadonlySet<string>): GenerationSteeringConsumer | null
  wake(sessionId: string): void
}

export interface GenerationHostPort {
  getConfig(): Promise<Config>
  getKnowledgeBase(sessionId: string): Pick<KnowledgeBase, 'id' | 'name'> | undefined
  getWebBrowsing(sessionId: string, provider: ModelProvider | undefined): boolean
  getAgentModeEntry(sessionId: string, session: Session): { value: AgentModeValue; locked?: boolean }
  setAgentMode(sessionId: string, value: AgentModeValue): Promise<void> | void
  lockAgentMode(sessionId: string, reason: Exclude<AgentModeLockReason, null>): Promise<void> | void
  createPictureStorageKey(sessionId: string, messageId: string): string
  markFirstSuccessfulChatCompleted(): void
  afterMessageGenerated(sessionId: string, message: Message): void
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
    action: 'approve' | 'deny' | 'continue' | 'stop' | 'disable_session' | 'disable_global'
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

    let session: Session | null | undefined
    let settings: SessionSettings | null | undefined
    const globalSettings = settingsRepository.getSettings()
    let config: Config
    try {
      session = await sessions.getSession(sessionId)
      if (controller.signal.aborted) return finishCanceledSetup(Boolean(session))

      settings = await sessions.getSessionSettings(sessionId)
      if (controller.signal.aborted) return finishCanceledSetup(true)

      config = await host.getConfig()
      if (controller.signal.aborted) return finishCanceledSetup(true)

      if (!session || !settings) {
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

    const contextTargetIndex = options?.contextMessages?.findIndex((message) => message.id === targetMessage.id) ?? -1
    const found =
      options?.contextMessages && contextTargetIndex > 0
        ? { messages: options.contextMessages, index: contextTargetIndex }
        : sessions.findTargetMessageIndex(session, targetMessage.id)
    if (!found) {
      finishRuntime()
      return
    }
    const { messages, index: targetMessageIndex } = found
    const promptTargetMessageIndex = options?.appendToMessage ? targetMessageIndex + 1 : targetMessageIndex
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
        this.dependencies.runtime.finishActive(sessionId, generationMessageId, runtimeState)
        return
      }
    }

    // User-requested queue jumps are persisted in true causal order: the
    // assistant segment completed so far is finalized, the steered user is
    // inserted after it, and the same provider run continues in a fresh
    // continuation message stored below the steered user.
    const steering =
      this.dependencies.steering?.register(sessionId, new Set(messages.map((message) => message.id))) ?? null

    let processorState = createInitialState()
    const infoParts: MessageContentParts = []
    const persistAbortedGenerationIfNeeded = async (): Promise<boolean> => {
      if (!controller.signal.aborted) return false
      targetMessage = finishAbortedGeneration(
        targetMessage,
        [...infoParts, ...processorState.contentParts],
        getAbortStoppedAt(controller.signal, host.now())
      )
      await sessions.persistStreamingMessage(sessionId, targetMessage, { refreshCounting: true })
      return true
    }

    try {
      const modelContext = await this.dependencies.models.createContext(settings)
      const { model } = modelContext
      // Reasoning options are scoped to the provider+model they were configured for;
      // resolving here guarantees a switched model never inherits another model's parameters.
      const reasoningProviderOptions = resolveReasoningProviderOptions(settings, settings.provider, settings.modelId)
      const knowledgeBase = host.getKnowledgeBase(sessionId)
      const webBrowsing = host.getWebBrowsing(sessionId, settings.provider)
      const agentModeSupported =
        this.dependencies.capabilities.supports('agent-mode') && model.isSupportToolUse('agent')
      const agentModeEntry = host.getAgentModeEntry(sessionId, session)
      const agentModeValue = agentModeSupported ? agentModeEntry.value : 'off'
      const lastUserMessage = getLastUserMessage(messages, promptTargetMessageIndex)

      if (
        options?.operationType === 'send_message' &&
        !options.appendToMessage &&
        !options.skipAgentModeSuggestion &&
        agentModeSupported &&
        agentModeValue === 'auto' &&
        lastUserMessage &&
        isFirstUserTurn(messages, promptTargetMessageIndex)
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
        compactionPoints: sessions.getCompactionPointsForTarget(session, targetMessage.id),
        lockAgentMode: (reason) => {
          void host.lockAgentMode(sessionId, reason)
        },
      })
      if (!options?.appendToMessage) {
        infoParts.push(...prepared.infoParts)
      }

      const chatOptions = { ...prepared.chatOptions }
      let segmentStartedAt = startedAt
      if (steering) {
        // When the current segment has produced no output yet, the steered user
        // belongs before it — anchored at the target's predecessor.
        const preSteerAnchorMessageId = messages[targetMessageIndex - 1]?.id
        // Set when a split was abandoned: later steers must still land after the
        // ones already stored, not back at the assistant they all interrupted.
        let lastUnsplitSteerMessageId: string | undefined

        // Finalize the interrupted assistant segment and continue the same
        // provider run in a fresh continuation message stored after the steered
        // user(s). The durable transcript thereby keeps true causal order
        // (assistant steps -> steered user -> later steps) with no read-time
        // reordering or projection.
        //
        // Write order is chosen so that *some* assistant message is flagged
        // `generating` at every instant: the durable `generating` flags are the
        // only thing session locks read, and a gap would briefly expose a normal
        // Send whose submission becomes an ordinary follow-up instead of a steer.
        //
        //   1. insert the continuation (generating) while the segment still is
        //   2. finalize the segment  (now two, momentarily — never zero)
        //   3. swap the in-memory run + runtime, synchronously
        //
        // If step 1 fails the split is abandoned and the run keeps streaming into
        // the original message: the steered user then trails an unfinalized
        // assistant, which is exactly the legacy shape `orderSteeredMessagesForModel`
        // already reorders. That degradation is always safe, so nothing here needs
        // to roll back a partially applied split.
        const splitTargetMessageForSteering = async (consumedMessages: Message[]): Promise<void> => {
          const previousMessageId = generationMessageId
          // Stop has already claimed this run and owns the cleanup of its id;
          // moving the runtime out from under it would strand both. The run is
          // ending anyway, so keep everything on the current message.
          if (this.dependencies.runtime.get(sessionId, previousMessageId)?.phase === 'stopping') {
            lastUnsplitSteerMessageId = consumedMessages[consumedMessages.length - 1].id
            return
          }

          const continuation: Message = {
            ...createMessage('assistant'),
            generating: true,
            status: [],
            aiProvider: targetMessage.aiProvider,
            model: targetMessage.model,
            // The raw model identity travels with the display name so a split
            // continuation keeps the same provenance record as its source.
            modelId: targetMessage.modelId,
            name: targetMessage.name,
            style: targetMessage.style,
            isStreamingMode: targetMessage.isStreamingMode,
          }
          const anchorMessageId = consumedMessages[consumedMessages.length - 1].id
          try {
            await sessions.insertMessageAfter(sessionId, continuation, anchorMessageId)
          } catch (error) {
            // A rejected write does not prove nothing was committed: a session
            // whose messages persisted can still fail its list-metadata update
            // and reject. Ask the session which happened instead of guessing.
            const session = await sessions.getSession(sessionId).catch(() => undefined)
            const committed = session ? sessions.findMessage(session, continuation.id) !== undefined : false
            if (!committed) {
              this.dependencies.logger.log('error', 'Steering continuation insert failed, continuing in place', {
                error,
              })
              lastUnsplitSteerMessageId = anchorMessageId
              return
            }
          }

          this.finalizePartDurations(processorState.contentParts)
          const finalizedSegment: Message = {
            ...targetMessage,
            generating: false,
            contentParts: [...infoParts, ...processorState.contentParts],
            status: [],
            finishReason: 'steered',
            // Provider usage arrives only with the final finish chunk; a resumed
            // target keeps the usage recorded by its earlier completed run.
            usage: processorState.usage ?? targetMessage.usage,
            generationDuration: host.now() - segmentStartedAt,
          }
          await sessions.persistStreamingMessage(sessionId, finalizedSegment, { refreshCounting: true })

          targetMessage = continuation
          processorState = createInitialState()
          infoParts.length = 0
          segmentStartedAt = host.now()
          firstTokenLatency = undefined
          generationMessageId = continuation.id
          lastUnsplitSteerMessageId = undefined
          this.dependencies.runtime.retarget(sessionId, previousMessageId, continuation.id, runtimeState)
          steering.admitAnchor(continuation.id)
        }

        const basePrepareStep = chatOptions.prepareStep
        chatOptions.prepareStep = async (prepareStepOptions) => {
          const base = await basePrepareStep?.(prepareStepOptions)
          const stepMessages = base?.messages ?? prepareStepOptions.messages
          // AI SDK calls prepareStep only after the previous provider response and
          // its complete tool-call batch have settled. This is the same checkpoint
          // used by pi-agent: the steered user enters the durable transcript and
          // the next LLM request at the boundary, in true causal order.
          const hasSegmentOutput = processorState.contentParts.length > 0
          const anchorMessageId =
            lastUnsplitSteerMessageId ?? (hasSegmentOutput ? targetMessage.id : preSteerAnchorMessageId)
          if (!anchorMessageId) return base ?? {}
          const injection = await steering.inject(stepMessages, anchorMessageId).catch((error) => {
            this.dependencies.logger.log('error', 'Steering injection failed', { error })
            return undefined
          })
          if (!injection) return base ?? {}
          if (injection.consumed.length > 0 && hasSegmentOutput) {
            await splitTargetMessageForSteering(injection.consumed)
          }
          return injection.messages ? { ...(base ?? {}), messages: injection.messages } : (base ?? {})
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
            void sessions.persistStreamingMessage(sessionId, targetMessage).catch((error: unknown) => {
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
    } finally {
      this.dependencies.runtime.finishActive(sessionId, generationMessageId, runtimeState)
      steering?.release()
      this.dependencies.steering?.wake(sessionId)
    }
  }

  stopPausedToolCall(sessionId: string, messageId: string, toolCallId: string): Promise<void> {
    return this.dependencies.coordination
      .runExclusive(sessionId, () => this.stopPausedToolCallUnlocked(sessionId, messageId, toolCallId))
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

  private async stopPausedToolCallUnlocked(sessionId: string, messageId: string, toolCallId: string): Promise<void> {
    const { sessions, analytics } = this.dependencies
    const [session, settings] = await Promise.all([
      sessions.getSession(sessionId),
      sessions.getSessionSettings(sessionId),
    ])
    if (!session) return
    const message = sessions.findMessage(session, messageId)
    if (!message) return
    const part = findToolCallPart(message, toolCallId)
    if (!part || part.state !== 'paused') return

    const isApproval = isApprovalPauseReason(part.pauseReason)
    const approvalTarget = getApprovalTrackingTarget(part)
    analytics.trackPauseAction({
      type: isApproval ? 'approval' : 'tool_limit',
      action: isApproval ? 'deny' : 'stop',
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
      const deniedResult =
        pauseReason.type === 'user_exec_approval' || pauseReason.type === 'command_escalation_approval'
          ? { success: false, exitCode: null, stdout: '', stderr: 'Command denied by user.' }
          : pauseReason.type === 'file_mutation_approval'
            ? { success: false, error: 'File mutation denied by user.' }
            : { success: false, error: 'Chatbox action denied by user.' }
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
          result: batchPart.toolCallId === toolCallId ? deniedResult : { error: 'Approval denied by user.' },
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
    const session = await sessions.getSession(sessionId)
    const settings = await sessions.getSessionSettings(sessionId)
    if (!session || !settings) return

    let message = sessions.findMessage(session, messageId)
    if (!message) return
    const part = findToolCallPart(message, toolCallId)
    if (!part || part.state !== 'paused') return

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
          // Keep the reviewed app-action payload for an interrupted retry of this exact request.
          pauseReason: batchPart.pauseReason?.type === 'app_action_approval' ? batchPart.pauseReason : undefined,
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
      const tools = await this.dependencies.tools.buildToolsForPausedToolCall(session, settings, message)
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
        agentMode: host.getAgentModeEntry(sessionId, session).value,
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
    const session = await sessions.getSession(sessionId)
    if (!session) return

    const message = sessions.findMessage(session, messageId)
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
      const settings = await sessions.getSessionSettings(sessionId)
      if (!settings) return

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

      try {
        const tools = await this.dependencies.tools.buildToolsForPausedToolCall(session, settings, retryMessage)
        const toolValue = (tools as Record<string, unknown>)[part.toolName]
        const executableTool = toolValue && typeof toolValue === 'object' ? (toolValue as ExecutableTool) : undefined
        if (typeof executableTool?.execute !== 'function') {
          throw new Error(`Tool "${part.toolName}" is not available`)
        }

        const result = await executableTool.execute(part.args, {
          toolCallId,
          approved: true,
          ...(part.pauseReason?.type === 'user_exec_approval' ||
          part.pauseReason?.type === 'command_escalation_approval'
            ? { approvalWorkdir: part.pauseReason.workdir }
            : {}),
          ...(part.pauseReason?.type === 'command_escalation_approval'
            ? { approvalRetryOf: part.pauseReason.retryOf }
            : {}),
          approvalDetails: part.pauseReason?.type === 'app_action_approval' ? part.pauseReason.details : undefined,
        })
        retryMessage = updateToolCallPart(retryMessage, toolCallId, (toolPart) => ({
          ...toolPart,
          state: 'result',
          pauseReason: undefined,
          result,
          duration: toolPart.startTime ? host.now() - toolPart.startTime : undefined,
        }))
        await sessions.modifyMessage(sessionId, retryMessage, true)

        await this.orchestrate(
          sessionId,
          { ...retryMessage, generating: true },
          { operationType: 'regenerate', appendToMessage: true }
        )
      } catch (error) {
        analytics.captureException(error, {
          operation: 'tool_retry',
          provider: settings.provider,
          model: settings.modelId,
          agentMode: host.getAgentModeEntry(sessionId, session).value,
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
