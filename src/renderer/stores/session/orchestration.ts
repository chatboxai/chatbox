import { buildContext } from '@shared/context'
import { isApprovalPauseReason } from '@shared/message-approval'
import type { ModelInterface, ModelStreamPart } from '@shared/models/types'
import type {
  AppActionApprovalDetails,
  Message,
  MessageContentParts,
  MessageContentToolCallPart,
  MessageToolCallPart,
  ModelProvider,
  Session,
  SessionSettings,
} from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { resolveReasoningProviderOptions } from '@shared/utils/reasoning-control'
import { MAX_TOOL_CALLS_BEFORE_CONFIRMATION, shouldPauseOnToolCallLimit } from '@shared/utils/tool-call-limit-pause'
import type { ModelMessage, ToolSet } from 'ai'
import { createModel, createModelDependencies } from '@/adapters'
import {
  type AgentModeEntrySource,
  captureAgentModeException,
  trackAgentModePauseAction,
  trackAgentModeSuggested,
  trackWorkModeSuggestionDecision,
} from '@/analytics/agent-mode'
import { AppActionApprovalPausedError } from '@/packages/app-action-approval'
import * as appleAppStore from '@/packages/apple_app_store'
import { wakeBackgroundTaskFollowUps } from '@/packages/chatbox-cli/background-follow-up'
import { estimateTokensFromMessages } from '@/packages/token'
import { FileMutationApprovalPausedError, UserExecApprovalPausedError } from '@/packages/user-exec-approval'
import platform from '@/platform'
import { createSandboxProvider } from '@/sandbox'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as chatStore from '../chatStore'
import { markFirstSuccessfulChatCompleted } from '../firstSuccessfulChat'
import { markSessionReplyCompleted } from '../sessionActivityStore'
import * as settingActions from '../settingActions'
import { settingsStore } from '../settingsStore'
import { uiStore } from '../uiStore'
import { prepareAgentGenerationHarness, refreshSessionAttachmentStatuses } from './agent-harness'
import { getSessionAgentModeEntry, lockSessionAgentMode, setSessionAgentMode } from './agent-mode'
import {
  AGENT_MODE_SUGGESTION_PROMPT,
  type AgentModeSuggestionDecision,
  describeUserMessageForAgentModeDecision,
  getLastUserMessage,
  isFirstUserTurn,
  parseAgentModeSuggestionDecision,
} from './agent-mode-suggestion'
import { createAttachmentResolver } from './attachment-resolver'
import { findMessageLocation } from './forks'
import { cancelRunningToolCallBatch, finishAbortedGeneration } from './generation-cancellation'
import { withSessionGenerationLock } from './generation-lock'
import { beginSessionGeneration, settleSessionGeneration } from './generation-runtime'
import { modifyMessage, persistStreamingMessage, updateStreamingCache } from './messages'
import { registerUnsettledStreamDrain, waitForUnsettledStreamDrains } from './state'
import { createInitialState, processStreamChunk } from './stream-chunk-processor'
import { buildToolsForSession } from './tools-builder'
import {
  findTargetMessageIndex,
  getCompactionPointsForTarget,
  getSessionWebBrowsing,
  handleGenerationError,
  initializeTargetMessage,
  trackGenerateEvent,
} from './utils'

type ExecutableTool = {
  execute?: (
    input: unknown,
    context: {
      toolCallId?: string
      approved?: boolean
      approvalDetails?: AppActionApprovalDetails
      abortSignal?: AbortSignal
    }
  ) => unknown
}

export function createPausedToolCallExecutionContext(
  part: Pick<MessageContentToolCallPart, 'toolCallId' | 'pauseReason'>,
  approvedToolCallId: string | undefined,
  abortSignal?: AbortSignal
): { toolCallId: string; approved: boolean; approvalDetails?: AppActionApprovalDetails; abortSignal?: AbortSignal } {
  const approved = part.toolCallId === approvedToolCallId
  return {
    toolCallId: part.toolCallId,
    approved,
    ...(abortSignal ? { abortSignal } : {}),
    approvalDetails:
      approved && part.pauseReason?.type === 'app_action_approval' ? part.pauseReason.details : undefined,
  }
}

class ToolCallLimitPausedError extends Error {
  constructor(
    readonly toolCallId: string,
    readonly toolName: string,
    readonly maxToolCalls: number
  ) {
    super(`Tool call limit reached before executing ${toolName}`)
    this.name = 'ToolCallLimitPausedError'
  }
}

function isToolCallLimitPausedError(error: unknown): error is ToolCallLimitPausedError {
  return (
    error instanceof ToolCallLimitPausedError ||
    Boolean(
      error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'ToolCallLimitPausedError' &&
        'toolCallId' in error &&
        typeof error.toolCallId === 'string' &&
        'maxToolCalls' in error &&
        typeof error.maxToolCalls === 'number'
    )
  )
}

function isUserExecApprovalPausedError(error: unknown): error is UserExecApprovalPausedError {
  return (
    error instanceof UserExecApprovalPausedError ||
    Boolean(
      error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'UserExecApprovalPausedError' &&
        'toolCallId' in error &&
        typeof error.toolCallId === 'string' &&
        'command' in error &&
        typeof error.command === 'string'
    )
  )
}

function isFileMutationApprovalPausedError(error: unknown): error is FileMutationApprovalPausedError {
  return (
    error instanceof FileMutationApprovalPausedError ||
    Boolean(
      error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'FileMutationApprovalPausedError' &&
        'toolCallId' in error &&
        typeof error.toolCallId === 'string' &&
        'title' in error &&
        typeof error.title === 'string' &&
        'preview' in error &&
        typeof error.preview === 'string'
    )
  )
}

function isAppActionApprovalPausedError(error: unknown): error is AppActionApprovalPausedError {
  return (
    error instanceof AppActionApprovalPausedError ||
    Boolean(
      error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'AppActionApprovalPausedError' &&
        'toolCallId' in error &&
        typeof error.toolCallId === 'string' &&
        'action' in error &&
        typeof error.action === 'string' &&
        'title' in error &&
        typeof error.title === 'string' &&
        'preview' in error &&
        typeof error.preview === 'string'
    )
  )
}

function getToolCallPause(error: unknown): {
  toolCallId: string
  pauseReason: MessageToolCallPart['pauseReason']
} | null {
  if (isToolCallLimitPausedError(error)) {
    return {
      toolCallId: error.toolCallId,
      pauseReason: { type: 'tool_call_limit', maxToolCalls: error.maxToolCalls },
    }
  }
  if (isUserExecApprovalPausedError(error)) {
    return {
      toolCallId: error.toolCallId,
      pauseReason: {
        type: 'user_exec_approval',
        command: error.command,
        explanation: error.explanation,
        explanationError: error.explanationError,
      },
    }
  }
  if (isFileMutationApprovalPausedError(error)) {
    return {
      toolCallId: error.toolCallId,
      pauseReason: { type: 'file_mutation_approval', title: error.title, preview: error.preview },
    }
  }
  if (isAppActionApprovalPausedError(error)) {
    return {
      toolCallId: error.toolCallId,
      pauseReason: {
        type: 'app_action_approval',
        action: error.action,
        title: error.title,
        preview: error.preview,
        details: error.details,
      },
    }
  }
  return null
}

export function applyPersistentToolCallPause(
  state: ReturnType<typeof createInitialState>,
  error: unknown
): ReturnType<typeof createInitialState> {
  const pause = getToolCallPause(error)
  if (!pause) throw error
  return {
    ...state,
    contentParts: markToolCallPaused(state.contentParts, pause.toolCallId, pause.pauseReason),
  }
}

async function shouldSuggestAgentMode(options: {
  sessionId: string
  model: ModelInterface
  userMessage: Message
  signal: AbortSignal
  providerOptions?: SessionSettings['providerOptions']
}): Promise<AgentModeSuggestionDecision> {
  const { sessionId, model, userMessage, signal, providerOptions } = options
  const userPrompt = describeUserMessageForAgentModeDecision(userMessage)
  const promptMessages: ModelMessage[] = model.isSupportSystemMessage()
    ? [
        { role: 'system', content: AGENT_MODE_SUGGESTION_PROMPT },
        { role: 'user', content: userPrompt },
      ]
    : [
        {
          role: 'user',
          content: `${AGENT_MODE_SUGGESTION_PROMPT}\n\n${userPrompt}`,
        },
      ]

  try {
    const result = await model.chat(promptMessages, {
      sessionId,
      signal,
      providerOptions,
    })
    const text = getMessageText({ id: 'agent-mode-decision', role: 'assistant', contentParts: result.contentParts })
    return parseAgentModeSuggestionDecision(text) ?? { suggest: false }
  } catch (error) {
    if (signal.aborted) {
      return { suggest: false }
    }
    console.warn('Agent mode suggestion decision failed:', error)
    captureAgentModeException(error, {
      operation: 'suggestion',
      model: model.modelId,
    })
    return { suggest: false }
  }
}

/**
 * Resolve the model used to classify whether Agent Mode should be suggested.
 * Prefer the user-configured fast model (threadNamingModel) to keep this
 * pre-flight classification cheap; fall back to the conversation model when it
 * is not configured or cannot be created.
 */
async function createAgentModeSuggestionModel(
  settings: SessionSettings,
  namingModel: { provider: string; model: string } | undefined | null,
  dependencies: Awaited<ReturnType<typeof createModelDependencies>>,
  fallbackModel: ModelInterface
): Promise<ModelInterface> {
  if (!namingModel) return fallbackModel
  try {
    return await createModel(
      { ...settings, provider: namingModel.provider as ModelProvider, modelId: namingModel.model },
      dependencies
    )
  } catch (error) {
    console.warn('Failed to create fast model for agent mode suggestion, falling back to current model:', error)
    captureAgentModeException(error, {
      operation: 'suggestion_model',
      provider: namingModel.provider,
      model: namingModel.model,
    })
    return fallbackModel
  }
}

function withToolCallLimitPause(tools: ToolSet, maxToolCalls: number): ToolSet {
  let toolCallsSinceConfirmation = 0
  const wrappedTools: Record<string, unknown> = {}

  for (const [toolName, toolValue] of Object.entries(tools as Record<string, unknown>)) {
    if (!toolValue || typeof toolValue !== 'object') {
      wrappedTools[toolName] = toolValue
      continue
    }

    const executableTool = toolValue as ExecutableTool
    if (typeof executableTool.execute !== 'function') {
      wrappedTools[toolName] = toolValue
      continue
    }

    const originalExecute = executableTool.execute
    wrappedTools[toolName] = {
      ...toolValue,
      execute: (input: unknown, context: { toolCallId?: string; approved?: boolean }) => {
        if (toolCallsSinceConfirmation >= maxToolCalls) {
          const toolCallId = context.toolCallId
          if (!toolCallId) {
            return { error: `Tool call limit reached (${maxToolCalls}). Please continue manually.` }
          }
          throw new ToolCallLimitPausedError(toolCallId, toolName, maxToolCalls)
        }

        toolCallsSinceConfirmation += 1
        return originalExecute(input, context)
      },
    }
  }

  return wrappedTools as ToolSet
}

function markToolCallPaused(
  contentParts: MessageContentParts,
  toolCallId: string,
  pauseReason: MessageToolCallPart['pauseReason']
): MessageContentParts {
  // A tool_call_limit pause freezes the whole in-flight batch, not just the call that
  // tripped the limit; other pause reasons target only the named call.
  const pausesBatch = pauseReason?.type === 'tool_call_limit'
  return contentParts.map((part) => {
    if (part.type !== 'tool-call') return part
    if (part.toolCallId !== toolCallId && !(pausesBatch && part.state === 'call')) return part
    return {
      ...part,
      state: 'paused',
      pauseReason,
    } satisfies MessageToolCallPart
  })
}

/** Rewrites every tool-call part matching the predicate; other parts pass through untouched. */
function updateToolCallParts(
  message: Message,
  shouldUpdate: (part: MessageContentToolCallPart) => boolean,
  updater: (part: MessageContentToolCallPart) => MessageContentToolCallPart
): Message {
  return {
    ...message,
    contentParts: message.contentParts.map((part) =>
      part.type === 'tool-call' && shouldUpdate(part) ? updater(part) : part
    ),
  }
}

function updateToolCallPart(
  message: Message,
  toolCallId: string,
  updater: (part: MessageContentToolCallPart) => MessageContentToolCallPart
): Message {
  return updateToolCallParts(message, (part) => part.toolCallId === toolCallId, updater)
}

function getAbortStoppedAt(signal: AbortSignal): number {
  return typeof signal.reason === 'number' ? signal.reason : Date.now()
}

export function finishPausedToolCallContinuation(message: Message, finishReason?: string): Message {
  return {
    ...message,
    generating: false,
    cancel: undefined,
    finishReason,
  }
}

function findToolCallPart(message: Message, toolCallId: string): MessageContentToolCallPart | undefined {
  return message.contentParts.find(
    (part): part is MessageContentToolCallPart => part.type === 'tool-call' && part.toolCallId === toolCallId
  )
}

function findPausedToolCallLimitBatch(message: Message, toolCallId: string): MessageContentToolCallPart[] {
  const selected = findToolCallPart(message, toolCallId)
  if (selected?.pauseReason?.type !== 'tool_call_limit') return []
  return message.contentParts.filter(
    (part): part is MessageContentToolCallPart =>
      part.type === 'tool-call' && part.state === 'paused' && part.pauseReason?.type === 'tool_call_limit'
  )
}

function getApprovalTrackingTarget(part: MessageToolCallPart) {
  if (part.pauseReason?.type === 'user_exec_approval') return 'user_exec' as const
  if (part.pauseReason?.type !== 'file_mutation_approval') return undefined
  if (part.toolName === 'write_file') return 'file_write' as const
  if (part.toolName === 'edit_file') return 'file_edit' as const
  return undefined
}

function findPausedApprovalBatch(message: Message, toolCallId: string): MessageContentToolCallPart[] {
  const selected = findToolCallPart(message, toolCallId)
  if (!selected || selected.state !== 'paused' || !isApprovalPauseReason(selected.pauseReason)) return []
  if (selected.stepIndex === undefined) return [selected]
  return message.contentParts.filter(
    (part): part is MessageContentToolCallPart =>
      part.type === 'tool-call' &&
      part.state === 'paused' &&
      part.stepIndex === selected.stepIndex &&
      isApprovalPauseReason(part.pauseReason)
  )
}

function hasPausedToolCallPart(message: Message): boolean {
  return message.contentParts.some((part) => part.type === 'tool-call' && part.state === 'paused')
}

function findLastRetryableToolCallPart(message: Message): MessageToolCallPart | undefined {
  for (let index = message.contentParts.length - 1; index >= 0; index -= 1) {
    const part = message.contentParts[index]
    if (part.type === 'tool-call') {
      const toolCallPart = part as MessageToolCallPart
      if (isRetryableToolCallStep(toolCallPart)) {
        return toolCallPart
      }
    }
  }
  return undefined
}

export function isRetryableToolCallStep(part: MessageToolCallPart): boolean {
  return part.state === 'call' || part.state === 'result' || part.state === 'error'
}

function keepContentPartsThroughToolCall(message: Message, toolCallId: string): MessageContentParts {
  const index = message.contentParts.findIndex((part) => part.type === 'tool-call' && part.toolCallId === toolCallId)
  return index >= 0 ? message.contentParts.slice(0, index + 1) : message.contentParts
}

export function shouldPersistStreamingChunk(
  chunkType: ModelStreamPart<ToolSet>['type'],
  elapsedMs: number,
  persistInterval: number
) {
  // Tool calls can block the stream for a long time (for example while waiting
  // on user_exec approval), so persist them immediately instead of relying on
  // the periodic 2s flush.
  return chunkType === 'tool-call' || elapsedMs >= persistInterval
}

function exposeGenerationCancel(sessionId: string, targetMsg: Message, cancel: NonNullable<Message['cancel']>): void {
  targetMsg.cancel = cancel
  chatStore.updateSessionCacheSync(sessionId, (session) => {
    if (!session) {
      throw new Error(`Session ${sessionId} not found while exposing generation cancel`)
    }
    const location = findMessageLocation(session, targetMsg.id)
    if (location) {
      location.list[location.index].cancel = cancel
    }
    return session
  })
}

export async function orchestrateGeneration(
  sessionId: string,
  targetMsg: Message,
  options?: {
    operationType?: 'send_message' | 'regenerate'
    appendToMessage?: boolean
    skipAgentModeSuggestion?: boolean
    agentModeEntrySource?: AgentModeEntrySource
    contextMessages?: Message[]
    externalAbortSignal?: AbortSignal
  }
) {
  const controller = new AbortController()
  const cancel: NonNullable<Message['cancel']> = (stoppedAt = Date.now()) => controller.abort(stoppedAt)
  const externalSignal = options?.externalAbortSignal
  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason)
  } else {
    externalSignal?.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true })
  }

  // Expose cancel on both the local target and the authoritative cached message
  // so clone-based regenerate/continuation paths are cancellable before setup awaits.
  exposeGenerationCancel(sessionId, targetMsg, cancel)
  beginSessionGeneration(sessionId)
  let finalMessage: Message | undefined
  try {
    finalMessage = await runGeneration(sessionId, targetMsg, { controller, cancel }, options)
  } finally {
    settleSessionGeneration(sessionId)
    if (finalMessage) {
      markSessionReplyCompleted(sessionId, finalMessage)
    }
  }
}

async function runGeneration(
  sessionId: string,
  targetMsg: Message,
  generationControl: {
    controller: AbortController
    cancel: NonNullable<Message['cancel']>
  },
  options?: {
    operationType?: 'send_message' | 'regenerate'
    appendToMessage?: boolean
    skipAgentModeSuggestion?: boolean
    agentModeEntrySource?: AgentModeEntrySource
    contextMessages?: Message[]
    /**
     * Signal of the controller the caller previously exposed via `message.cancel`
     * (e.g. a paused-tool-call continuation handing off to a follow-up generation).
     * Chained into this generation's own controller so a Stop pressed during the
     * async setup window — while the stop button still aborts the old controller —
     * is not silently lost.
     */
    externalAbortSignal?: AbortSignal
  }
) {
  const { controller, cancel } = generationControl
  const finishCanceledSetup = async (persist = true): Promise<Message> => {
    targetMsg = { ...targetMsg, generating: false, cancel: undefined, status: [], finishReason: 'canceled' }
    if (persist) {
      await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
    }
    return targetMsg
  }

  const session = await chatStore.getSession(sessionId)
  if (controller.signal.aborted) return finishCanceledSetup(Boolean(session))

  const settings = await chatStore.getSessionSettings(sessionId)
  if (controller.signal.aborted) return finishCanceledSetup()

  const globalSettings = settingsStore.getState().getSettings()
  const configs = await platform.getConfig()
  if (controller.signal.aborted) return finishCanceledSetup()

  if (!session || !settings) {
    return targetMsg
  }

  trackGenerateEvent(sessionId, settings, globalSettings, session.type, options)

  const startTime = Date.now()
  let firstTokenLatency: number | undefined
  const persistInterval = 2000
  let lastPersistTimestamp = Date.now()

  targetMsg = {
    ...(await initializeTargetMessage(targetMsg, settings, globalSettings, session.type)),
    cancel,
  }
  if (controller.signal.aborted) return finishCanceledSetup()

  await persistStreamingMessage(sessionId, targetMsg)
  if (controller.signal.aborted) return finishCanceledSetup()

  const contextMessages = options?.contextMessages
  const contextTargetIndex = contextMessages?.findIndex((message) => message.id === targetMsg.id) ?? -1
  const found =
    contextMessages && contextTargetIndex > 0
      ? { messages: contextMessages, index: contextTargetIndex }
      : findTargetMessageIndex(session, targetMsg.id)
  if (!found) return targetMsg
  const { messages, index: targetMsgIx } = found
  const promptTargetMsgIx = options?.appendToMessage ? targetMsgIx + 1 : targetMsgIx

  // A previous Stop may have left a tool that ignores its abortSignal still executing;
  // its stream drain is registered per session. The generation lock already serializes
  // the locked entry points behind it, but alternative chat replies intentionally bypass
  // the lock, so wait here too — abortable via the freshly wired stop button. Re-check
  // the live set after every wait: with concurrent alternative replies, another
  // generation's Stop can register a new drain while this one was still waiting.
  let abortedDuringDrainWait: Promise<void> | undefined
  while (true) {
    const unsettledDrains = waitForUnsettledStreamDrains(sessionId)
    if (!unsettledDrains) break
    abortedDuringDrainWait ??= new Promise<void>((resolve) => {
      if (controller.signal.aborted) resolve()
      else controller.signal.addEventListener('abort', () => resolve(), { once: true })
    })
    await Promise.race([unsettledDrains, abortedDuringDrainWait])
    if (controller.signal.aborted) {
      targetMsg = { ...targetMsg, generating: false, cancel: undefined, status: [], finishReason: 'canceled' }
      await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
      return targetMsg
    }
  }

  let processorState = createInitialState()
  const infoParts: MessageContentParts = []
  let promptMsgs: Message[] = []
  const persistAbortedGenerationIfNeeded = async (): Promise<boolean> => {
    if (!controller.signal.aborted) return false
    const stoppedAt = getAbortStoppedAt(controller.signal)
    targetMsg = finishAbortedGeneration(targetMsg, [...infoParts, ...processorState.contentParts], stoppedAt)
    await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
    return true
  }

  try {
    const dependencies = await createModelDependencies()
    const model = await createModel(settings, dependencies)
    // Reasoning options are scoped to the provider+model they were configured for;
    // resolving here guarantees a switched model never inherits another model's parameters.
    const reasoningProviderOptions = resolveReasoningProviderOptions(settings, settings.provider, settings.modelId)
    const sessionKnowledgeBaseMap = uiStore.getState().sessionKnowledgeBaseMap
    const knowledgeBase = sessionKnowledgeBaseMap[sessionId]
    const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)
    const agentModeSupported = platform.type === 'desktop' && model.isSupportToolUse('agent')
    const agentModeEntry = getSessionAgentModeEntry(sessionId, session)
    const { value: storedAgentModeValue } = agentModeEntry
    const agentModeValue = agentModeSupported ? storedAgentModeValue : 'off'
    const lastUserMessage = getLastUserMessage(messages, promptTargetMsgIx)

    if (
      options?.operationType === 'send_message' &&
      !options?.appendToMessage &&
      !options.skipAgentModeSuggestion &&
      agentModeSupported &&
      // Only 'auto' runs the suggestion classifier; 'on' is already enabled and
      // 'off' opts out of suggestions entirely.
      agentModeValue === 'auto' &&
      lastUserMessage &&
      isFirstUserTurn(messages, promptTargetMsgIx)
    ) {
      const namingModel = globalSettings.threadNamingModel
      const suggestionModel = await createAgentModeSuggestionModel(settings, namingModel, dependencies, model)
      // The classifier may be a different model than the conversation; resolve the
      // reasoning options for whichever model actually runs the classification.
      const decision = await shouldSuggestAgentMode({
        sessionId,
        model: suggestionModel,
        userMessage: lastUserMessage,
        signal: controller.signal,
        // The session's thinking level applies when the classifier falls back to the
        // conversation model; a separate naming model runs with its own defaults.
        providerOptions: suggestionModel === model ? reasoningProviderOptions : undefined,
      })

      // If the user cancelled while the classifier was running, finalize the
      // message as stopped instead of falling through into a generation with an
      // already-aborted controller. shouldSuggestAgentMode() swallows the abort
      // and returns normally, so this won't reach the catch block below.
      if (controller.signal.aborted) {
        targetMsg = {
          ...targetMsg,
          generating: false,
          cancel: undefined,
          status: [],
          finishReason: 'canceled',
        }
        await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
        return targetMsg
      }

      trackWorkModeSuggestionDecision(
        {
          sessionId,
          mode: 'chat_mode',
          provider: settings.provider,
          model: settings.modelId,
        },
        decision.suggest,
        lastUserMessage.files?.length ?? 0
      )

      if (decision.suggest) {
        trackAgentModeSuggested({
          hasFiles: Boolean(lastUserMessage.files?.length),
          fileCount: lastUserMessage.files?.length ?? 0,
        })
        targetMsg = {
          ...targetMsg,
          generating: false,
          cancel: undefined,
          contentParts: [
            {
              type: 'agent-mode-suggestion',
              reason: decision.reason,
            },
          ],
          status: [],
          finishReason: 'agent-mode-suggested',
        }
        await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
        return targetMsg
      }

      await setSessionAgentMode(sessionId, 'off')
    }

    const prepared = await prepareAgentGenerationHarness({
      session,
      settings,
      globalSettings,
      configs,
      messages,
      targetMsgIx: promptTargetMsgIx,
      model,
      dependencies,
      knowledgeBase,
      webBrowsing,
      agentModeValue,
      agentModeLocked: Boolean(agentModeEntry?.locked),
      agentModeSupported,
      signal: controller.signal,
      providerOptions: reasoningProviderOptions,
      // Retrying from an archived thread must use that thread's points.
      compactionPoints: getCompactionPointsForTarget(session, targetMsg.id),
      preserveLastPromptMessageToolCalls: Boolean(options?.appendToMessage),
      isPro: settingActions.isPro,
      sideEffects: {
        lockAgentMode: (reason) => {
          void lockSessionAgentMode(sessionId, reason)
        },
      },
    })
    promptMsgs = prepared.promptMsgs
    if (!options?.appendToMessage) {
      infoParts.push(...prepared.infoParts)
    }
    const { coreMessages, tools, fallbackToolCallPart } = prepared

    const chatOptions = { ...prepared.chatOptions }

    if (Object.keys(tools).length > 0) {
      // Users can opt out of the periodic "Paused after N steps" confirmation
      // per session or globally; in that case tools run without the pause wrapper.
      chatOptions.tools = shouldPauseOnToolCallLimit(settings, globalSettings)
        ? withToolCallLimitPause(tools as ToolSet, MAX_TOOL_CALLS_BEFORE_CONFIRMATION)
        : (tools as ToolSet)
    }

    const stream = model.chatStream(coreMessages, chatOptions) as AsyncGenerator<ModelStreamPart<ToolSet>>

    processorState = createInitialState(
      options?.appendToMessage ? targetMsg.contentParts : fallbackToolCallPart ? [fallbackToolCallPart] : undefined
    )

    const streamCallbacks = {
      onFileReceived: async (mediaType: string, base64: string) => {
        const storageKey = StorageKeyGenerator.picture(`${session.id}:${targetMsg.id}`)
        await storage.setBlob(storageKey, `data:${mediaType};base64,${base64}`)
        return storageKey
      },
      onLargeToolResult: async (toolCallId: string, serialized: string) => {
        const storageKey = `tool-result:${session.id}:${toolCallId}`
        await storage.setBlob(storageKey, serialized)
        return storageKey
      },
    }

    // On abort, the AI SDK only closes the stream after the in-flight step settles, so a
    // tool execution that ignores its abortSignal would keep this loop blocked on the next
    // chunk indefinitely. Race the signal so Stop finalizes the message immediately; the
    // generation lock is still held until the stream settles (see the drain below).
    const streamIterator = stream[Symbol.asyncIterator]()
    const abortWait = new Promise<{ type: 'aborted' }>((resolve) => {
      if (controller.signal.aborted) {
        resolve({ type: 'aborted' })
      } else {
        controller.signal.addEventListener('abort', () => resolve({ type: 'aborted' }), { once: true })
      }
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
          // Swallow the abandoned read so a late rejection doesn't surface as unhandled.
          nextChunk.then(
            () => {},
            () => {}
          )
          abortedMidStream = true
          break
        }
        if (raced.iteration.done) break
        const chunk = raced.iteration.value

        const result = await processStreamChunk(chunk, processorState, streamCallbacks)
        processorState = result.state
        if (result.persistentToolCallPause) {
          processorState = applyPersistentToolCallPause(processorState, result.persistentToolCallPause)
        }

        if (result.skipUpdate) {
          if (result.statusChunk && result.statusChunk.type === 'status') {
            targetMsg = {
              ...targetMsg,
              status: result.statusChunk.status ? [result.statusChunk.status] : [],
            }
            updateStreamingCache(sessionId, targetMsg)
          }
          continue
        }

        const nextMsg: Message = {
          ...targetMsg,
          contentParts: [...infoParts, ...processorState.contentParts],
        }

        const textLength = getMessageText(nextMsg, true, true).length
        if (!firstTokenLatency && textLength > 0) {
          firstTokenLatency = Date.now() - startTime
        }

        targetMsg = {
          ...nextMsg,
          status: textLength > 0 || result.clearStatus ? [] : nextMsg.status,
          firstTokenLatency,
        }

        const shouldPersist = shouldPersistStreamingChunk(
          chunk.type,
          Date.now() - lastPersistTimestamp,
          persistInterval
        )
        if (shouldPersist) {
          void persistStreamingMessage(sessionId, targetMsg)
        } else {
          updateStreamingCache(sessionId, targetMsg)
        }
        if (shouldPersist) {
          lastPersistTimestamp = Date.now()
        }
      }
    } finally {
      // A `for await` loop closes the iterator when its body throws; this manual loop must
      // do the same so a renderer-side failure (e.g. persisting an image chunk) doesn't
      // leave the provider stream running after the message is finalized as an error.
      // No-op when the stream is already exhausted. The aborted path skips this and closes
      // via the awaited drain below, which also holds the generation lock until settle.
      if (!abortedMidStream) {
        await streamIterator.return?.(undefined)?.catch(() => {})
      }
    }

    // AI SDK v6 emits an `abort` stream part and may then close fullStream normally
    // without throwing. Check the signal before any paused/success completion path,
    // otherwise active tool calls remain in `call` state and their UI timers keep running.
    if (controller.signal.aborted) {
      // A tool that ignores its abortSignal may still be executing (install_skill,
      // write_file, MCP calls…). Create and register the drain before the fallible
      // terminal write below, so even a persistence failure cannot release the session
      // generation lock — or slip past the entry barrier — while the abandoned `next()`
      // and its tool execution remain active. `return()` on the generator queues behind
      // the pending `next()` and resolves once the stream yields or closes.
      let drain: Promise<void> | undefined
      if (abortedMidStream) {
        drain = (async () => {
          try {
            await streamIterator.return?.(undefined)
          } catch {
            // The settled stream may surface its abort as a rejection; the message is
            // already finalized, so there is nothing left to report.
          }
        })()
        // Alternative chat replies bypass the session generation lock, so also expose the
        // drain for generation entry points to await directly.
        registerUnsettledStreamDrain(sessionId, drain)
      }
      try {
        await persistAbortedGenerationIfNeeded()
      } finally {
        if (drain) await drain
      }
      return targetMsg
    }

    if (processorState.contentParts.some((part) => part.type === 'tool-call' && part.state === 'paused')) {
      targetMsg = {
        ...targetMsg,
        generating: false,
        cancel: undefined,
        contentParts: [...infoParts, ...processorState.contentParts],
        tokensUsed: targetMsg.tokensUsed ?? estimateTokensFromMessages([...promptMsgs, targetMsg]),
        status: [],
        finishReason: 'tool-call-paused',
        usage: processorState.usage,
      }
      await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
      return targetMsg
    }

    for (const part of processorState.contentParts) {
      if (part.type === 'reasoning' && part.startTime && !part.duration) {
        part.duration = Date.now() - part.startTime
      }
      if (
        part.type === 'tool-call' &&
        part.startTime &&
        !part.duration &&
        (part.state === 'result' || part.state === 'error')
      ) {
        part.duration = Date.now() - part.startTime
      }
    }

    processorState = {
      ...processorState,
      contentParts: model.normalizeCompletedResponse(processorState.contentParts, processorState.finishReason),
    }

    targetMsg = {
      ...targetMsg,
      generating: false,
      cancel: undefined,
      contentParts: [...infoParts, ...processorState.contentParts],
      tokensUsed: targetMsg.tokensUsed ?? estimateTokensFromMessages([...promptMsgs, targetMsg]),
      status: [],
      finishReason: processorState.finishReason,
      usage: processorState.usage,
      generationDuration: Date.now() - startTime,
    }

    await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
    if (options?.operationType === 'send_message') {
      markFirstSuccessfulChatCompleted()
    }
    appleAppStore.tickAfterMessageGenerated()
  } catch (err: unknown) {
    const pause = getToolCallPause(err)
    if (pause) {
      targetMsg = {
        ...targetMsg,
        generating: false,
        cancel: undefined,
        contentParts: [
          ...infoParts,
          ...markToolCallPaused(processorState.contentParts, pause.toolCallId, pause.pauseReason),
        ],
        tokensUsed: targetMsg.tokensUsed ?? estimateTokensFromMessages([...promptMsgs, targetMsg]),
        status: [],
        finishReason: 'tool-call-paused',
        usage: processorState.usage,
      }
      await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
      return targetMsg
    }

    if (await persistAbortedGenerationIfNeeded()) return targetMsg

    targetMsg = handleGenerationError(err, targetMsg, settings, {
      agentMode: getSessionAgentModeEntry(sessionId, session).value,
      operationType: options?.operationType,
    })
    await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
    return targetMsg
  }
  return targetMsg
}

async function buildToolsForPausedToolCall(session: Session, settings: SessionSettings, targetMsg: Message) {
  const dependencies = await createModelDependencies()
  const model = await createModel(settings, dependencies)
  const location = findTargetMessageIndex(session, targetMsg.id)
  const messagesBeforeTarget = location ? location.messages.slice(0, location.index) : session.messages
  const agentModeSupported = platform.type === 'desktop' && model.isSupportToolUse('agent')
  const { value: storedAgentModeValue } = getSessionAgentModeEntry(session.id, session)
  const agentModeValue = agentModeSupported ? storedAgentModeValue : 'off'
  const effectiveAgentMode = agentModeSupported && agentModeValue === 'on' ? 'on' : 'off'

  const sandboxProvider = effectiveAgentMode !== 'off' ? createSandboxProvider() : null
  // Mirror the main generation path: grant the sandbox the user's bound working directories
  // so a resumed write into them succeeds (allowWrite) instead of failing under confinement.
  const userWorkingDirectories = settings.workingDirectories?.filter((dir) => dir.trim().length > 0) ?? []
  if (sandboxProvider && userWorkingDirectories.length > 0) {
    sandboxProvider.setExtraWritableDirs(userWorkingDirectories)
  }
  let canExecuteCode = Boolean(sandboxProvider && model.isSupportToolUse('agent'))
  if (canExecuteCode && sandboxProvider?.type === 'cloud' && !settingActions.isPro()) {
    canExecuteCode = false
  }
  if (canExecuteCode && sandboxProvider) {
    const availability = await sandboxProvider.checkAvailability()
    if (!availability.available) {
      canExecuteCode = false
    }
  }

  const attachmentResolver = createAttachmentResolver()
  const messagesForPrompt = await refreshSessionAttachmentStatuses(messagesBeforeTarget)
  const promptMsgs = await buildContext(messagesForPrompt, {
    attachmentResolver,
    // Paused tool calls can be resumed from an archived thread too.
    compactionPoints: getCompactionPointsForTarget(session, targetMsg.id),
    modelSupportToolUseForFile: model.isSupportToolUse('read-file'),
    maxContextMessageCount: settings.maxContextMessageCount,
    sandboxMode: canExecuteCode,
  })

  const sessionKnowledgeBaseMap = uiStore.getState().sessionKnowledgeBaseMap
  const knowledgeBase = sessionKnowledgeBaseMap[session.id]
  const webBrowsing = getSessionWebBrowsing(session.id, settings.provider)
  const codeExecutionOption =
    canExecuteCode && sandboxProvider
      ? {
          sessionId: session.id,
          provider: sandboxProvider,
          files: messagesBeforeTarget.flatMap(
            (message) =>
              message.files?.map((file) => ({
                storageKey: file.storageKey || '',
                rawStorageKey: file.rawStorageKey,
                name: file.name,
              })) || []
          ),
        }
      : undefined

  const { tools } = await buildToolsForSession(model, {
    sessionId: session.id,
    webBrowsing,
    knowledgeBase,
    messages: promptMsgs,
    agentMode: effectiveAgentMode,
    sessionSettings: settings,
    codeExecution: codeExecutionOption,
    onAgentModeActivated: () => {
      void lockSessionAgentMode(session.id, 'load_skill')
    },
  })

  return { tools }
}

export function stopPausedToolCall(sessionId: string, messageId: string, toolCallId: string) {
  return withSessionGenerationLock(sessionId, () =>
    stopPausedToolCallWithoutSessionLock(sessionId, messageId, toolCallId)
  ).finally(() => wakeBackgroundTaskFollowUps(sessionId))
}

async function stopPausedToolCallWithoutSessionLock(sessionId: string, messageId: string, toolCallId: string) {
  const [session, settings] = await Promise.all([
    chatStore.getSession(sessionId),
    chatStore.getSessionSettings(sessionId),
  ])
  if (!session) return
  const location = findMessageLocation(session, messageId)
  const message = location ? location.list[location.index] : undefined
  if (!message) return
  const part = findToolCallPart(message, toolCallId)
  if (!part || part.state !== 'paused') return

  const isApproval = isApprovalPauseReason(part.pauseReason)
  const approvalTarget = getApprovalTrackingTarget(part)
  trackAgentModePauseAction({
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
    pauseReason?.type === 'file_mutation_approval' ||
    pauseReason?.type === 'app_action_approval'
  ) {
    const deniedResult =
      pauseReason.type === 'user_exec_approval'
        ? { success: false, exitCode: null, stdout: '', stderr: 'Command denied by user.' }
        : pauseReason.type === 'file_mutation_approval'
          ? { success: false, error: 'File mutation denied by user.' }
          : { success: false, error: 'Chatbox action denied by user.' }
    // Denying one call intentionally denies its whole parallel batch: the model should see
    // one consistent refusal and react once, not a mix of denied and still-pending siblings.
    // Approving stays per-call (each approval is reviewed individually in continuePausedToolCall).
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
        // Denied without executing — no meaningful duration to report.
        startTime: undefined,
        duration: undefined,
      })
    )
    await modifyMessage(sessionId, nextMessage, true)
    // Send the denial back to the model so it can react (mirrors the pre-batch behavior),
    // unless other tool calls in this message are still awaiting resolution.
    if (!hasPausedToolCallPart(nextMessage)) {
      await orchestrateGeneration(
        sessionId,
        { ...nextMessage, generating: true },
        { operationType: 'regenerate', appendToMessage: true }
      )
    }
    return
  }

  // tool_call_limit pauses are batch-scoped (markToolCallPaused pauses the whole in-flight
  // batch), so Stop must clear the whole batch too — otherwise the remaining paused parts
  // keep re-surfacing a Stop/Continue affordance one part at a time.
  const stopBatchIds = new Set(
    findPausedToolCallLimitBatch(message, toolCallId).map((batchPart) => batchPart.toolCallId)
  )
  if (stopBatchIds.size === 0) {
    stopBatchIds.add(toolCallId)
  }
  await modifyMessage(
    sessionId,
    updateToolCallParts(
      message,
      (batchPart) => stopBatchIds.has(batchPart.toolCallId),
      (batchPart) => ({
        ...batchPart,
        state: 'error',
        pauseReason: undefined,
        result: { error: 'Tool execution stopped by user.' },
      })
    ),
    true
  )
}

export function continuePausedToolCall(sessionId: string, messageId: string, toolCallId: string) {
  return withSessionGenerationLock(sessionId, () =>
    continuePausedToolCallWithoutSessionLock(sessionId, messageId, toolCallId)
  ).finally(() => wakeBackgroundTaskFollowUps(sessionId))
}

/**
 * "Don't ask again" on the tool-call-limit pause card: persist the opt-out
 * (for this session or for all sessions), then resume the paused batch.
 *
 * The returned promise settles once the preference is persisted (so callers can
 * report the outcome); the resumed generation itself runs on in the background.
 */
export async function disableToolCallLimitPauseAndContinue(
  sessionId: string,
  messageId: string,
  toolCallId: string,
  scope: 'session' | 'global'
) {
  // This click is a "continue" variant, so track it as one action instead of
  // an extra pause-action event on top of the continuation below.
  trackAgentModePauseAction({
    type: 'tool_limit',
    action: scope === 'global' ? 'disable_global' : 'disable_session',
  })
  try {
    if (scope === 'global') {
      settingsStore.getState().setSettings({ pauseOnToolCallLimit: false })
      // A per-session override would keep beating the new global value in this
      // chat, so drop it — the user asked from this chat's pause card.
      await chatStore.updateSession(sessionId, (session) => {
        if (!session) {
          throw new Error('Session not found')
        }
        const { pauseOnToolCallLimit: _removed, ...settings } = session.settings ?? {}
        return { ...session, settings }
      })
    } else {
      await chatStore.updateSession(sessionId, (session) => {
        if (!session) {
          throw new Error('Session not found')
        }
        return { ...session, settings: { ...session.settings, pauseOnToolCallLimit: false } }
      })
    }
  } finally {
    // The click always means "continue", even when persisting the preference fails.
    void withSessionGenerationLock(sessionId, () =>
      continuePausedToolCallWithoutSessionLock(sessionId, messageId, toolCallId, { skipPauseActionTracking: true })
    )
      .finally(() => wakeBackgroundTaskFollowUps(sessionId))
      .catch((error) => console.error('Failed to continue the paused tool call:', error))
  }
}

async function continuePausedToolCallWithoutSessionLock(
  sessionId: string,
  messageId: string,
  toolCallId: string,
  options?: { skipPauseActionTracking?: boolean }
) {
  const session = await chatStore.getSession(sessionId)
  const settings = await chatStore.getSessionSettings(sessionId)
  if (!session || !settings) return

  const location = findMessageLocation(session, messageId)
  let message = location ? location.list[location.index] : undefined
  if (!message) return
  const part = findToolCallPart(message, toolCallId)
  if (!part || part.state !== 'paused') return

  const isApproval = isApprovalPauseReason(part.pauseReason)
  const approvalTarget = getApprovalTrackingTarget(part)
  if (!options?.skipPauseActionTracking) {
    trackAgentModePauseAction({
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

  // A tool_call_limit continue resumes the whole paused batch; an approval continue targets
  // exactly the clicked call. Either way it's the same flow — a batch of one or many.
  const toolCallLimitBatch = findPausedToolCallLimitBatch(message, toolCallId)
  const isLimitContinue = toolCallLimitBatch.length > 0
  const batch = isLimitContinue ? toolCallLimitBatch : [part]
  const approvedToolCallId = isApproval ? toolCallId : undefined
  const batchIds = new Set(batch.map((batchPart) => batchPart.toolCallId))
  const controller = new AbortController()

  message = {
    ...updateToolCallParts(
      message,
      (batchPart) => batchIds.has(batchPart.toolCallId),
      (batchPart) => ({
        ...batchPart,
        state: 'call',
        // Keep structured app-action approval details until execution finishes so an
        // interrupted continuation can still retry the exact request the user reviewed.
        pauseReason: batchPart.pauseReason?.type === 'app_action_approval' ? batchPart.pauseReason : undefined,
        result: undefined,
        resultStorageKey: undefined,
        // Restart the timer at continuation so the reported duration excludes the
        // time spent waiting for user approval / manual continuation.
        startTime: Date.now(),
        duration: undefined,
      })
    ),
    generating: true,
    cancel: (stoppedAt = Date.now()) => controller.abort(stoppedAt),
  }
  await modifyMessage(sessionId, message, false)

  try {
    const { tools } = await buildToolsForPausedToolCall(session, settings, message)
    for (const batchPart of batch) {
      if (controller.signal.aborted) break

      const toolValue = (tools as Record<string, unknown>)[batchPart.toolName]
      const executableTool = toolValue && typeof toolValue === 'object' ? (toolValue as ExecutableTool) : undefined
      if (typeof executableTool?.execute !== 'function') {
        throw new Error(`Tool "${batchPart.toolName}" is not available`)
      }

      try {
        // Bind approval to the exact call the user reviewed. Never infer authorization from
        // batch membership: a sibling call must pass through its own approval gate.
        const result = await executableTool.execute(
          batchPart.args,
          createPausedToolCallExecutionContext(batchPart, approvedToolCallId, controller.signal)
        )
        message = updateToolCallPart(message, batchPart.toolCallId, (toolPart) => ({
          ...toolPart,
          state: 'result',
          pauseReason: undefined,
          result,
          duration: toolPart.startTime ? Date.now() - toolPart.startTime : undefined,
        }))
      } catch (error) {
        if (controller.signal.aborted) {
          break
        }
        const pause = getToolCallPause(error)
        message = updateToolCallPart(message, batchPart.toolCallId, (toolPart) =>
          pause
            ? {
                // The tool re-paused itself (e.g. exec/file-mutation approval) — surface the
                // approval UI instead of recording an error, same as the streaming path.
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
                duration: toolPart.startTime ? Date.now() - toolPart.startTime : undefined,
              }
        )
      }
      // Cache-only progress tick; the single persist happens once after the loop.
      await modifyMessage(sessionId, message, false, true)
    }

    if (controller.signal.aborted) {
      const stoppedAt = getAbortStoppedAt(controller.signal)
      message = cancelRunningToolCallBatch(message, batchIds, stoppedAt)
      await modifyMessage(sessionId, finishPausedToolCallContinuation(message, 'canceled'), true)
      return
    }

    if (hasPausedToolCallPart(message)) {
      // Some calls are still awaiting user approval — generation resumes once they resolve.
      await modifyMessage(sessionId, finishPausedToolCallContinuation(message, 'tool-call-paused'), true)
      return
    }

    await modifyMessage(sessionId, message, true)
    if (controller.signal.aborted) {
      const stoppedAt = getAbortStoppedAt(controller.signal)
      message = cancelRunningToolCallBatch(message, batchIds, stoppedAt)
      await modifyMessage(sessionId, finishPausedToolCallContinuation(message, 'canceled'), true)
      return
    }

    await orchestrateGeneration(
      sessionId,
      { ...message, generating: true },
      // The message cache still points the stop button at this continuation's
      // controller until the follow-up generation registers its own, so chain
      // the signal across the handoff to keep Stop working in that window.
      { operationType: 'regenerate', appendToMessage: true, externalAbortSignal: controller.signal }
    )
  } catch (error) {
    captureAgentModeException(error, {
      operation: 'tool_pause_continue',
      provider: settings.provider,
      model: settings.modelId,
      agentMode: getSessionAgentModeEntry(sessionId, session).value,
      fullAccess: settings.agentFullAccess === true,
      toolName: part.toolName,
      pauseType: part.pauseReason?.type,
    })
    const errorMessage = error instanceof Error ? error.message : String(error)
    const failedMessage = controller.signal.aborted
      ? cancelRunningToolCallBatch(message, batchIds, getAbortStoppedAt(controller.signal))
      : updateToolCallParts(
          message,
          (batchPart) => batchIds.has(batchPart.toolCallId) && batchPart.state === 'call',
          (batchPart) => ({
            ...batchPart,
            state: 'error',
            pauseReason: undefined,
            result: { error: errorMessage },
            duration: batchPart.startTime ? Date.now() - batchPart.startTime : undefined,
          })
        )
    // The batch has been terminally converted (cancelled or errored), so the
    // paused finish reason must not survive: leaving it (or clearing it to
    // undefined) would let isSuccessfulAssistantReply() count this failed
    // continuation as a successful reply.
    await modifyMessage(
      sessionId,
      finishPausedToolCallContinuation(failedMessage, controller.signal.aborted ? 'canceled' : 'error'),
      true
    )
  }
}

export function retryFromLastToolCallAfterApiError(sessionId: string, messageId: string, toolCallId: string) {
  return withSessionGenerationLock(sessionId, () =>
    retryFromLastToolCallAfterApiErrorWithoutSessionLock(sessionId, messageId, toolCallId)
  )
}

async function retryFromLastToolCallAfterApiErrorWithoutSessionLock(
  sessionId: string,
  messageId: string,
  toolCallId: string
) {
  const session = await chatStore.getSession(sessionId)
  if (!session) return

  const location = findMessageLocation(session, messageId)
  const message = location ? location.list[location.index] : undefined
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
    const settings = await chatStore.getSessionSettings(sessionId)
    if (!settings) return

    let retryMessage = updateToolCallPart(retrySourceMessage, toolCallId, (toolPart) => ({
      ...toolPart,
      state: 'call',
      result: undefined,
      resultStorageKey: undefined,
      resultProviderMetadata: undefined,
      startTime: Date.now(),
      duration: undefined,
    }))
    await modifyMessage(sessionId, retryMessage, false)

    try {
      const { tools } = await buildToolsForPausedToolCall(session, settings, retryMessage)
      const toolValue = (tools as Record<string, unknown>)[part.toolName]
      const executableTool = toolValue && typeof toolValue === 'object' ? (toolValue as ExecutableTool) : undefined
      if (typeof executableTool?.execute !== 'function') {
        throw new Error(`Tool "${part.toolName}" is not available`)
      }

      const result = await executableTool.execute(part.args, {
        toolCallId,
        approved: true,
        approvalDetails: part.pauseReason?.type === 'app_action_approval' ? part.pauseReason.details : undefined,
      })
      retryMessage = updateToolCallPart(retryMessage, toolCallId, (toolPart) => ({
        ...toolPart,
        state: 'result',
        pauseReason: undefined,
        result,
        duration: toolPart.startTime ? Date.now() - toolPart.startTime : undefined,
      }))
      await modifyMessage(sessionId, retryMessage, true)

      await orchestrateGeneration(
        sessionId,
        { ...retryMessage, generating: true },
        { operationType: 'regenerate', appendToMessage: true }
      )
    } catch (error) {
      captureAgentModeException(error, {
        operation: 'tool_retry',
        provider: settings.provider,
        model: settings.modelId,
        agentMode: getSessionAgentModeEntry(sessionId, session).value,
        fullAccess: settings.agentFullAccess === true,
        toolName: part.toolName,
      })
      const errorMessage = error instanceof Error ? error.message : String(error)
      await modifyMessage(
        sessionId,
        updateToolCallPart(retryMessage, toolCallId, (toolPart) => ({
          ...toolPart,
          state: 'error',
          pauseReason: undefined,
          result: { error: errorMessage },
          duration: toolPart.startTime ? Date.now() - toolPart.startTime : undefined,
        })),
        true
      )
    }
    return
  }

  await modifyMessage(sessionId, retrySourceMessage, true)
  await orchestrateGeneration(
    sessionId,
    { ...retrySourceMessage, generating: true },
    { operationType: 'regenerate', appendToMessage: true }
  )
}
