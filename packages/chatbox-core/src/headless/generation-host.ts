import { buildContext } from '@shared/context/builder'
import { convertToModelMessages } from '@shared/services/model-message-converter'
import type { ModelInterface } from '@shared/models/types'
import { createMessage, type Message, type Session } from '@shared/types'
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
}): Promise<Session> {
  const target = createMessage('assistant', '')
  const settings = { modelId: options.model.modelId, stream: true, pauseOnToolCallLimit: false }
  const session: Session = {
    id: target.id,
    name: 'Headless terminal evaluation',
    type: 'chat',
    settings,
    messages: [createMessage('system', options.systemPrompt), createMessage('user', options.instruction), target],
  }
  const globalSettings = createDefaultSettings()
  const save = (message: Message) => {
    const index = session.messages.findIndex((candidate) => candidate.id === message.id)
    if (index < 0) throw new Error(`Unknown headless message: ${message.id}`)
    session.messages[index] = structuredClone(message)
  }
  const attachments = { read: async () => null }
  const unsupported = async (): Promise<never> => {
    throw new Error('Binary attachments are unavailable in terminal-only profile')
  }
  const dependencies: GenerationServiceDependencies<null> = {
    sessions: {
      getSession: async () => session,
      getSessionSettings: async () => session.settings,
      updateSessionSettings: async (_id, update) => {
        session.settings = update(session.settings)
      },
      initializeTargetMessage: async (message) => ({ ...message, generating: true }),
      persistStreamingMessage: async (_id, message) => save(message),
      updateStreamingCache: (_id, message) => save(message),
      modifyMessage: async (_id, message) => save(message),
      findMessage: (current, id) => current.messages.find((message) => message.id === id),
      insertMessageAfter: async (_id, message, anchor) => {
        if (session.messages.some((item) => item.id === message.id)) return
        const index = session.messages.findIndex((item) => item.id === anchor)
        if (index < 0) throw new Error('Headless message anchor is missing')
        session.messages.splice(index + 1, 0, structuredClone(message))
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
      getConfig: async () => ({ uuid: session.id }),
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
  await new GenerationService(dependencies).orchestrate(session.id, target, {
    skipAgentModeSuggestion: true,
    externalAbortSignal: options.signal,
  })
  return session
}
