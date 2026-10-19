import { SessionNotFoundError } from '@chatbox/core/application/session'
import {
  GenerationService,
  type GenerationServiceDependencies,
  type GenerationSessionPort,
  withSessionGenerationLock,
} from '@chatbox/core/generation'
import type { LoggerPort, SessionContextSource } from '@chatbox/core/ports'
import { buildContext } from '@shared/context'
import { workModelDisclosure } from '@shared/mobile-work/model-disclosure'
import type { Message, SessionPromptContextSnapshot, SessionSettings } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { combineMemoryStateTokens } from '@shared/types/agent-persona'
import {
  trackAgentModePauseAction,
  trackAgentModeSuggested,
  trackWorkModeSuggestionDecision,
} from '@/analytics/agent-mode'
import { guardBackupWrite } from '@/app/backup-operation-guard'
import { rendererApplication } from '@/app/renderer-application'
import { languageNameMap } from '@/i18n/locales'
import { getLogger } from '@/lib/utils'
import { captureAgentModeException } from '@/observability/agent-mode'
import * as appleAppStore from '@/packages/apple_app_store'
import { wakeBackgroundTaskFollowUps } from '@/packages/chatbox-cli/background-follow-up'
import { getCompactionThresholdTokens } from '@/packages/context-management/compaction-detector'
import { getConfiguredContextWindow } from '@/packages/context-management/context-pressure'
import { prepareMobileMCPTools } from '@/packages/mcp/mobile-tools'
import { buildPausedAgentMemoryTools } from '@/packages/model-calls/toolsets/agent-memory'
import platform from '@/platform'
import { createSandboxProvider } from '@/sandbox'
import { settingsService } from '@/settings-runtime'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { getCopilotMemorySelection } from '@/stores/copilotStore'
import { markFirstSuccessfulChatCompleted } from '@/stores/firstSuccessfulChat'
import { prepareAgentGenerationHarness, refreshSessionAttachmentStatuses } from '@/stores/session/agent-harness'
import {
  getSessionAgentModeEntry,
  lockSessionAgentMode,
  persistSessionPromptContextSnapshotGuarded,
  setSessionAgentMode,
} from '@/stores/session/agent-mode'
import { wakeQueuedUserMessages } from '@/stores/session/message-queue'
import {
  insertMessageAfter,
  modifyMessage,
  persistStreamingMessage,
  splitStreamingMessage,
  updateStreamingCache,
} from '@/stores/session/messages'
import { sessionPromptContextSnapshotMatchesMemoryState } from '@/stores/session/prompt-context-snapshot'
import { getSessionSettings } from '@/stores/session/session-settings'
import { registerSteeringConsumer } from '@/stores/session/steering'
import { buildToolsForSession } from '@/stores/session/tools-builder'
import {
  getSessionWebBrowsing,
  handleGenerationError,
  initializeTargetMessage,
  trackGenerateEvent,
} from '@/stores/session/utils'
import { markSessionReplyCompleted, markSessionReplyFailed } from '@/stores/sessionActivityStore'
import * as settingActions from '@/stores/settingActions'
import { uiStore } from '@/stores/uiStore'
import { trackEvent } from '@/utils/track'
import { CurrentAttachmentAdapter } from './CurrentAttachmentAdapter'
import { CurrentBlobStorage } from './CurrentBlobStorage'
import { currentModelFactory } from './CurrentModelFactory'
import { CurrentPlatformCapabilities } from './CurrentPlatformCapabilities'
import { createModelDependencies } from './RendererModelDependencies'
import { withSessionWorkAccess } from './session-work-lock'

const log = getLogger('generation-service')
const attachmentAdapter = new CurrentAttachmentAdapter()

const logger: LoggerPort = {
  log(level, message, context) {
    log.log(level, message, context)
  },
}

const sessions: GenerationSessionPort = {
  getSessionContextSource: (request) => rendererApplication.sessions.getSessionContextSource(request),
  readSessionMessages: (request) => rendererApplication.sessions.readSessionMessages(request),
  isSessionMissingError: (error) => error instanceof SessionNotFoundError,
  getSessionSettings: (sessionId, header) => getSessionSettings(sessionId, header),
  updateSessionSettings: async (sessionId, update) => {
    await rendererApplication.sessions.updateSessionHeader(sessionId, (current) => {
      if (!current) {
        throw new Error(`Session ${sessionId} not found`)
      }
      return { ...current, settings: update(current.settings) }
    })
  },
  initializeTargetMessage: (message, settings, globalSettings, sessionType) =>
    initializeTargetMessage(message, settings, globalSettings, sessionType),
  persistStreamingMessage: (sessionId, message, options) => persistStreamingMessage(sessionId, message, options),
  splitStreamingMessage,
  insertMessageAfter: async (sessionId, message, afterMessageId) => {
    await insertMessageAfter(sessionId, message, afterMessageId, { requireAnchor: true })
  },
  updateStreamingCache: (sessionId, message) => updateStreamingCache(sessionId, message),
  modifyMessage: (sessionId, message, refreshCounting, updateOnlyCache) =>
    modifyMessage(sessionId, message, refreshCounting, updateOnlyCache),
  handleGenerationError: (error, message, settings, context) =>
    handleGenerationError(error, message, settings, context),
}

async function buildToolsForPausedToolCall(
  source: SessionContextSource,
  settings: SessionSettings,
  targetMessage: Message,
  signal: AbortSignal
) {
  const session = source.header
  const snapshot = source.thread.sessionPromptContextSnapshot ?? settings.sessionPromptContextSnapshot
  const modelDependencies = await createModelDependencies()
  const model = await currentModelFactory.createModel(settings, modelDependencies)
  const messagesBeforeTarget = source.candidateMessages
  const agentModeSupported = platform.isDesktopLike && model.isSupportToolUse('agent')
  const { value: storedAgentModeValue } = getSessionAgentModeEntry(session.id, session)
  const agentModeValue = agentModeSupported ? storedAgentModeValue : 'off'
  const effectiveAgentMode = agentModeSupported && agentModeValue === 'on' ? 'on' : 'off'

  if (platform.type === 'mobile' && storedAgentModeValue === 'on' && model.isSupportToolUse('agent')) {
    const { capacitorWorkMode, buildMobileWebTools, capacitorImageTools } = await import(
      '@/packages/mobile-work-mode/runtime'
    )
    const mcp = await prepareMobileMCPTools({ enabled: true, model, settings: settingsService.getSettings(), signal })
    const web = buildMobileWebTools(model, getSessionWebBrowsing(session.id, settings.provider))
    return (
      await capacitorWorkMode.createTools(
        {
          sessionId: session.id,
          capabilities: settings.localWorkCapabilities,
          skillPreferences: settingsService.getSettings().mobileSkillPreferences,
          ...workModelDisclosure(settings, settingsService.getSettings()),
          signal,
        },
        {
          ...web.tools,
          ...capacitorImageTools(model, session.id, signal)?.tools,
          ...mcp.tools,
          ...buildPausedAgentMemoryTools({
            targetMessage,
            languageName: languageNameMap[settingsService.getSettings().language],
          }).tools,
        },
        true
      )
    ).tools
  }

  const sandboxProvider = effectiveAgentMode !== 'off' ? createSandboxProvider() : null
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

  const messagesForPrompt = await refreshSessionAttachmentStatuses(messagesBeforeTarget)
  const promptMessages = await buildContext(messagesForPrompt, {
    attachmentResolver: attachmentAdapter,
    compactionPoints: source.compactionPoints,
    modelSupportToolUseForFile: model.isSupportToolUse('read-file'),
    maxContextMessageCount: settings.maxContextMessageCount,
    sandboxMode: canExecuteCode,
    language: settingsService.getSettings().language,
  })

  const knowledgeBase = uiStore.getState().sessionKnowledgeBaseMap[session.id]
  const webBrowsing = getSessionWebBrowsing(session.id, settings.provider)
  const codeExecution =
    canExecuteCode && sandboxProvider
      ? {
          sessionId: session.id,
          provider: sandboxProvider,
          files: source.beforeTarget.sandboxSeedAttachments,
        }
      : undefined

  const { tools } = await buildToolsForSession(model, {
    sessionId: session.id,
    webBrowsing,
    knowledgeBase,
    messages: promptMessages,
    fileMessages: messagesForPrompt,
    fileResourceKeys: source.beforeTarget.fileResourceKeys,
    agentMode: effectiveAgentMode,
    sessionSettings: settings,
    codeExecution,
    commandExecution:
      effectiveAgentMode === 'on' && sandboxProvider
        ? { sessionId: session.id, provider: canExecuteCode ? sandboxProvider : undefined }
        : undefined,
    agentToolContractVersion: snapshot?.agentToolContractVersion ?? 1,
    onAgentModeActivated: () => {
      void lockSessionAgentMode(session.id, 'load_skill')
    },
    pausedMemoryContext: { targetMessage },
  })
  return tools
}

const dependencies: GenerationServiceDependencies<ModelDependencies> = {
  sessions,
  settings: settingsService,
  models: {
    createModel(settings) {
      return currentModelFactory.createModel(settings)
    },
    async createContext(settings) {
      const context = await createModelDependencies()
      return {
        model: await currentModelFactory.createModel(settings, context),
        context,
      }
    },
    createWithContext(settings, context) {
      return currentModelFactory.createModel(settings, context)
    },
  },
  preparation: {
    async prepare(request) {
      const persistSnapshot = (snapshot: SessionPromptContextSnapshot) => {
        // A canceled generation (thread switch/new thread) must not write its
        // late capture. Re-check the live memory state as well: an older
        // generation may finish loading after the user changes the source.
        if (request.signal.aborted) return
        void getCopilotMemorySelection(request.session.copilotId)
          .then((memorySelection) => {
            if (request.signal.aborted) return
            const liveGlobalSettings = settingsService.getSettings()
            const memoryScope = memorySelection.scope
            const memoryEnabled = memoryScope.type === 'copilot' || liveGlobalSettings.memoryEnabled !== false
            const memoryStateToken = combineMemoryStateTokens(
              memorySelection.memoryStateToken,
              memoryScope.type === 'global' ? liveGlobalSettings.memoryStateToken : ''
            )
            if (
              !sessionPromptContextSnapshotMatchesMemoryState(snapshot, memoryScope, memoryEnabled, memoryStateToken)
            ) {
              return
            }
            persistSessionPromptContextSnapshotGuarded(
              request.session.id,
              snapshot,
              request.settings.sessionPromptContextSnapshot?.capturedAt
            )
          })
          .catch((error) => log.error('Failed to validate prompt-context memory state:', error))
      }
      if (platform.type === 'mobile' && request.agentModeValue === 'on' && request.agentModeSupported) {
        const { prepareCapacitorWorkMode } = await import('@/packages/mobile-work-mode/runtime')
        const { prepareCapacitorMemoryContext } = await import('@/packages/mobile-work-mode/memory-context')
        return prepareCapacitorWorkMode(request, await prepareCapacitorMemoryContext(request, persistSnapshot))
      }
      const prepared = await prepareAgentGenerationHarness({
        session: request.session,
        settings: request.settings,
        globalSettings: request.globalSettings,
        configs: request.config,
        messages: request.messages,
        targetMsgIx: request.targetMessageIndex,
        history: request.history,
        fileResourceKeys: request.history?.fileResourceKeys,
        model: request.model,
        dependencies: request.modelContext,
        attachmentResolver: request.attachments,
        knowledgeBase: request.knowledgeBase,
        webBrowsing: request.webBrowsing,
        agentModeValue: request.agentModeValue,
        agentModeLocked: request.agentModeLocked,
        agentModeSupported: request.agentModeSupported,
        signal: request.signal,
        providerOptions: request.providerOptions,
        preserveLastPromptMessageToolCalls: request.preserveLastPromptMessageToolCalls,
        compactionPoints: request.compactionPoints,
        sideEffects: {
          lockAgentMode: request.lockAgentMode,
          persistSessionPromptContextSnapshot: persistSnapshot,
        },
        isPro: settingActions.isPro,
      })
      return {
        promptMessages: prepared.promptMsgs,
        coreMessages: prepared.coreMessages,
        tools: prepared.tools,
        memoryToolContext: prepared.memoryToolContext,
        chatOptions: prepared.chatOptions,
        infoParts: prepared.infoParts,
        fallbackToolCallPart: prepared.fallbackToolCallPart,
        systemPrompt: prepared.systemPrompt,
      }
    },
  },
  tools: {
    buildToolsForPausedToolCall,
  },
  coordination: {
    runExclusive: (sessionId, operation) => withSessionGenerationLock(sessionId, operation),
    wakeBackgroundTaskFollowUps: (sessionId) => wakeBackgroundTaskFollowUps(sessionId),
  },
  steering: {
    register: (sessionId, conversationMessageIds) =>
      registerSteeringConsumer(sessionId, conversationMessageIds, (message, afterMessageId) =>
        // Fail closed: a steered user appended somewhere other than its anchor
        // would reorder the transcript. The consumer leaves the item queued for
        // the next boundary instead.
        insertMessageAfter(sessionId, message, afterMessageId, { requireAnchor: true })
      ),
    wake: (sessionId) => wakeQueuedUserMessages(sessionId),
  },
  compaction: {
    getThresholdTokens(sessionSettings, globalSettings) {
      const providerId = sessionSettings.provider ?? globalSettings.defaultChatModel?.provider
      const modelId = sessionSettings.modelId ?? globalSettings.defaultChatModel?.model
      if (!modelId) return null
      return getCompactionThresholdTokens(
        modelId,
        { compactionThreshold: globalSettings.compactionThreshold },
        getConfiguredContextWindow(globalSettings, providerId, modelId)
      )
    },
    async compact(sessionId, request, abortSignal) {
      const { runCompactionWithUIState } = await import('@/packages/context-management/compaction')
      return runCompactionWithUIState(sessionId, request, { abortSignal })
    },
  },
  runtime: rendererApplication.generationRuntime,
  blobs: new CurrentBlobStorage(),
  attachments: attachmentAdapter,
  capabilities: new CurrentPlatformCapabilities(),
  host: {
    getConfig: () => platform.getConfig(),
    getKnowledgeBase: (sessionId) => uiStore.getState().sessionKnowledgeBaseMap[sessionId],
    getWebBrowsing: (sessionId, provider) => getSessionWebBrowsing(sessionId, provider),
    getAgentModeEntry: (sessionId, session) => getSessionAgentModeEntry(sessionId, session),
    async setAgentMode(sessionId, value) {
      await setSessionAgentMode(sessionId, value, { source: 'system' })
    },
    async lockAgentMode(sessionId, reason) {
      await lockSessionAgentMode(sessionId, reason)
    },
    createPictureStorageKey: (sessionId, messageId) => StorageKeyGenerator.picture(`${sessionId}:${messageId}`),
    markFirstSuccessfulChatCompleted: () => markFirstSuccessfulChatCompleted(),
    afterMessageGenerated: (sessionId, message) => {
      appleAppStore.tickAfterMessageGenerated()
      markSessionReplyCompleted(sessionId, message)
    },
    afterMessageFailed: (sessionId, message) => markSessionReplyFailed(sessionId, message),
    now: Date.now,
  },
  analytics: {
    init: () => undefined,
    event: (name, params) => trackEvent(name, params),
    trackGenerate: (sessionId, settings, globalSettings, sessionType, options) =>
      trackGenerateEvent(sessionId, settings, globalSettings, sessionType, options),
    trackSuggestionDecision(context, suggested, fileCount) {
      trackWorkModeSuggestionDecision({ ...context, mode: 'chat_mode' }, suggested, fileCount)
    },
    trackAgentModeSuggested: (context) => trackAgentModeSuggested(context),
    trackPauseAction: (options) => trackAgentModePauseAction(options),
    captureException: (error, context) => captureAgentModeException(error, context),
  },
  logger,
}

/**
 * Current Renderer composition root for the host-neutral generation service.
 * React Native can compose the same service with native implementations of
 * these ports without importing Renderer state, storage, or platform modules.
 */
const generationService = new GenerationService(dependencies)

async function runGenerationWork(action: () => Promise<void>): Promise<void> {
  if (!(await guardBackupWrite())) return
  await withSessionWorkAccess(action)
}

export const currentGenerationService = {
  orchestrate: (...args: Parameters<typeof generationService.orchestrate>) =>
    withSessionWorkAccess(() => generationService.orchestrate(...args)),
  continuePausedToolCall: (...args: Parameters<typeof generationService.continuePausedToolCall>) =>
    runGenerationWork(() => generationService.continuePausedToolCall(...args)),
  disableToolCallLimitPauseAndContinue: (
    ...args: Parameters<typeof generationService.disableToolCallLimitPauseAndContinue>
  ) => runGenerationWork(() => generationService.disableToolCallLimitPauseAndContinue(...args)),
  stopPausedToolCall: (...args: Parameters<typeof generationService.stopPausedToolCall>) =>
    runGenerationWork(() => generationService.stopPausedToolCall(...args)),
  retryFromLastToolCallAfterApiError: (
    ...args: Parameters<typeof generationService.retryFromLastToolCallAfterApiError>
  ) => runGenerationWork(() => generationService.retryFromLastToolCallAfterApiError(...args)),
}
