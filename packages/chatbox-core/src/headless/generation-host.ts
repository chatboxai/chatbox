import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import { SessionRowWriteQueue } from '../application/session/SessionRowWriteQueue'
import { InMemorySessionRecordStore } from '../persistence/memory-session-record-store'
import { InMemorySessionRowStore } from '../persistence/memory-session-row-store'
import { buildContext } from '@shared/context/builder'
import { convertToModelMessages } from '@shared/services/model-message-converter'
import type { ModelInterface } from '@shared/models/types'
import { createMessage, type Message, type SessionHeader } from '@shared/types'
import type { ToolSet } from 'ai'
import { createDefaultSettings } from '../domain/settings/settings-defaults'
import { GenerationService, type GenerationServiceDependencies } from '../generation/GenerationService'
import { GenerationRuntimeStore } from '../generation/runtime-store'

/** One isolated, in-memory terminal evaluation. Persistence callbacks retain production stream state. */
export async function generateTerminalSession(options: {
  model: ModelInterface
  instruction: string
  systemPrompt: string
  tools: ToolSet
  maxSteps: number
  signal: AbortSignal
}): Promise<Message> {
  const target = createMessage('assistant', '')
  const settings = { modelId: options.model.modelId, stream: true, pauseOnToolCallLimit: false }
  const header: SessionHeader = {
    id: target.id,
    name: 'Headless terminal evaluation',
    type: 'chat',
    settings,
  }
  const globalSettings = createDefaultSettings()
  const rows = new InMemorySessionRowStore()
  const repository = new RowBackedSessionRepository({
    records: new InMemorySessionRecordStore(),
    rows,
    backup: rows,
    writes: new SessionRowWriteQueue((_id, run) => run()),
  })
  await repository.createSessionRows(header, [
    createMessage('system', options.systemPrompt),
    createMessage('user', options.instruction),
    target,
  ])
  const save = async (message: Message, onlyIfGenerating = false) => {
    await repository.executeSessionCommand(header.id, {
      type: 'update',
      messageId: message.id,
      updater: (current) => {
        if (!current) throw new Error('Terminal generation message is unavailable')
        return onlyIfGenerating && !current.generating ? current : message
      },
    })
  }
  const attachments = { read: async () => null }
  const unsupported = async (): Promise<never> => {
    throw new Error('Binary attachments are unavailable in terminal-only profile')
  }
  const dependencies: GenerationServiceDependencies<null> = {
    sessions: {
      getSessionContextSource: (request) => repository.getSessionContextSource(request),
      readSessionMessages: (request) => repository.readSessionMessages(request),
      getSessionSettings: async () => (await repository.getSessionHeader(header.id))?.header.settings,
      updateSessionSettings: async (_id, update) => {
        await repository.executeSessionCommand(header.id, {
          type: 'header',
          updater: (current) => {
            if (!current) throw new Error('Terminal generation header is unavailable')
            return { ...current, settings: update(current.settings) }
          },
        })
      },
      initializeTargetMessage: async (message) => ({ ...message, generating: true }),
      persistStreamingMessage: async (_id, message, options) => save(message, options?.onlyIfGenerating),
      updateStreamingCache: () => {},
      modifyMessage: async (_id, message) => save(message),
      insertMessageAfter: async (_id, message, previousId) => {
        await repository.executeSessionCommand(header.id, {
          type: 'structure',
          operation: { action: 'message-insert-after', message, previousId, requireAnchor: true },
        })
      },
      handleGenerationError: (error, message) => ({
        ...message,
        generating: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    },
    settings: {
      getSettings: () => globalSettings,
      updateSettings: (update) => {
        Object.assign(globalSettings, typeof update === 'function' ? update(globalSettings) : update)
      },
    },
    models: {
      createModel: async () => options.model,
      createContext: async () => ({ model: options.model, context: null }),
      createWithContext: async () => options.model,
    },
    preparation: {
      prepare: async (request) => {
        const promptMessages = await buildContext(request.messages.slice(0, request.targetMessageIndex), {
          attachmentResolver: attachments,
        })
        return {
          promptMessages,
          coreMessages: await convertToModelMessages(promptMessages, unsupported),
          tools: options.tools,
          chatOptions: { agentMode: true, maxSteps: options.maxSteps, signal: request.signal },
          infoParts: [],
          fallbackToolCallPart: undefined,
          systemPrompt: options.systemPrompt,
        }
      },
    },
    tools: { buildToolsForPausedToolCall: async () => options.tools },
    coordination: { runExclusive: async (_id, operation) => operation(), wakeBackgroundTaskFollowUps: () => undefined },
    runtime: new GenerationRuntimeStore(),
    blobs: { get: unsupported, set: unsupported },
    attachments,
    capabilities: { supports: (capability) => capability === 'agent-mode' },
    host: {
      getConfig: async () => ({ uuid: header.id }),
      getKnowledgeBase: () => undefined,
      getWebBrowsing: () => false,
      getAgentModeEntry: () => ({ value: 'on', locked: true }),
      setAgentMode: () => undefined,
      lockAgentMode: () => undefined,
      createPictureStorageKey: () => {
        throw new Error('Images are unavailable in terminal-only profile')
      },
      markFirstSuccessfulChatCompleted: () => undefined,
      afterMessageGenerated: () => undefined,
      afterMessageFailed: () => undefined,
      now: Date.now,
    },
    analytics: {
      init: () => undefined,
      event: () => undefined,
      trackGenerate: () => undefined,
      trackSuggestionDecision: () => undefined,
      trackAgentModeSuggested: () => undefined,
      trackPauseAction: () => undefined,
      captureException: () => undefined,
    },
    logger: { log: () => undefined },
  }
  await new GenerationService(dependencies).orchestrate(header.id, target, {
    skipAgentModeSuggestion: true,
    externalAbortSignal: options.signal,
  })
  const result = await repository.readSessionMessages({ sessionId: header.id, messageIds: [target.id] })
  if (!result?.messages[0]) throw new Error('Terminal result is unavailable')
  return result.messages[0]
}
