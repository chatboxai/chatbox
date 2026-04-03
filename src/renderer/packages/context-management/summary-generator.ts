import * as Sentry from '@sentry/react'
import { getModel } from '@shared/models'
import { createLangSmithConversationMetadata } from '@shared/models/tracing'
import { ApiError, NetworkError } from '@shared/models/errors'
import { getLangSmithErrorMessage } from '@shared/utils/langsmith_adapter'
import type { Language, Message, ModelProvider, SessionSettings, Settings } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { langsmith } from '@/adapters/langsmith'
import { languageNameMap } from '@/i18n/locales'
import { generateText } from '@/packages/model-calls'
import { convertToModelMessages } from '@/packages/model-calls/message-utils'
import * as promptFormat from '@/packages/prompts'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'
import { settingsStore } from '@/stores/settingsStore'

export interface SummaryGeneratorOptions {
  messages: Message[]
  language?: Language
  sessionSettings?: SessionSettings
  sessionId?: string
  threadId?: string
  messageId?: string
}

export interface SummaryResult {
  success: boolean
  summary?: string
  error?: Error
}

export async function generateSummary(options: SummaryGeneratorOptions): Promise<SummaryResult> {
  const { messages, sessionSettings } = options

  if (messages.length === 0) {
    return { success: true, summary: '' }
  }

  const globalSettings = settingsStore.getState().getSettings()
  const language = options.language ?? globalSettings.language
  const languageName = languageNameMap[language]

  const settings = buildModelSettings(globalSettings, sessionSettings)

  try {
    const dependencies = await createModelDependencies()
    const configs = await platform.getConfig()
    const model = getModel(settings, globalSettings, configs, dependencies)

    const promptMessages = promptFormat.summarizeConversation(messages, languageName)
    const result = await generateText(model, promptMessages, {
      name: 'chatbox.summary.generate',
      sessionId: options.sessionId,
      threadId: options.threadId,
      messageId: options.messageId,
      metadata: {
        operation: 'generateSummary',
        messageCount: messages.length,
      },
      tags: ['summary'],
    })

    const summary =
      result.contentParts
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('') ?? ''

    const cleanedSummary = summary.replace(/<think>.*?<\/think>/gs, '').trim()

    return { success: true, summary: cleanedSummary }
  } catch (e: unknown) {
    if (!(e instanceof ApiError || e instanceof NetworkError)) {
      Sentry.captureException(e)
    }

    return {
      success: false,
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}

function buildModelSettings(globalSettings: Settings, sessionSettings?: SessionSettings): SessionSettings & Settings {
  const remoteConfig = settingActions.getRemoteConfig()

  const fastModel = (remoteConfig as { fastModel?: { provider: string; model: string } })?.fastModel
  if (fastModel?.provider && fastModel?.model) {
    return {
      ...globalSettings,
      ...sessionSettings,
      provider: fastModel.provider as ModelProvider,
      modelId: fastModel.model,
    }
  }

  if (globalSettings.threadNamingModel?.provider && globalSettings.threadNamingModel?.model) {
    return {
      ...globalSettings,
      ...sessionSettings,
      provider: globalSettings.threadNamingModel.provider as ModelProvider,
      modelId: globalSettings.threadNamingModel.model,
    }
  }

  if (sessionSettings?.provider && sessionSettings?.modelId) {
    return {
      ...globalSettings,
      ...sessionSettings,
    }
  }

  return {
    ...globalSettings,
    ...sessionSettings,
  }
}

export function isSummaryGenerationAvailable(): boolean {
  const globalSettings = settingsStore.getState().getSettings()
  const remoteConfig = settingActions.getRemoteConfig()

  const fastModel = (remoteConfig as { fastModel?: { provider: string; model: string } })?.fastModel
  if (fastModel?.provider && fastModel?.model) {
    return true
  }

  if (globalSettings.threadNamingModel?.provider && globalSettings.threadNamingModel?.model) {
    return true
  }

  if (globalSettings.defaultChatModel?.provider && globalSettings.defaultChatModel?.model) {
    return true
  }

  return false
}

export interface StreamingSummaryOptions extends SummaryGeneratorOptions {
  onStreamUpdate?: (text: string) => void
}

export async function generateSummaryWithStream(options: StreamingSummaryOptions): Promise<SummaryResult> {
  const { messages, sessionSettings, onStreamUpdate } = options

  if (messages.length === 0) {
    return { success: true, summary: '' }
  }

  const globalSettings = settingsStore.getState().getSettings()
  const language = options.language ?? globalSettings.language
  const languageName = languageNameMap[language]

  const settings = buildModelSettings(globalSettings, sessionSettings)

  try {
    const dependencies = await createModelDependencies()
    const configs = await platform.getConfig()
    const model = getModel(settings, globalSettings, configs, dependencies)

    const promptMessages = promptFormat.summarizeConversation(messages, languageName)
    const coreMessages = await convertToModelMessages(promptMessages, { modelSupportVision: model.isSupportVision() })
    const traceMetadata = createLangSmithConversationMetadata(
      {
        sessionId: options.sessionId,
        threadId: options.threadId,
        messageId: options.messageId,
      },
      {
        messageCount: messages.length,
        operation: 'generateSummaryWithStream',
      }
    )
    const traceRun = await langsmith.startRun({
      name: 'chatbox.summary.generate_stream',
      runType: 'chain',
      inputs: {
        sessionId: options.sessionId ?? null,
        threadId: options.threadId ?? options.sessionId ?? null,
        messageId: options.messageId ?? null,
        messageCount: messages.length,
        modelId: model.modelId,
      },
      metadata: traceMetadata,
      tags: ['chatbox', 'renderer', 'summary'],
    })

    const result = await model
      .chat(coreMessages, {
        onResultChange: (data) => {
          if (data.contentParts && onStreamUpdate) {
            const newText = data.contentParts
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('')
            onStreamUpdate(newText)
          }
        },
        traceContext: {
          name: 'chatbox.summary.generate_stream.llm',
          parentRunId: traceRun.runId,
          metadata: traceMetadata,
          tags: ['summary'],
        },
      })
      .catch(async (error) => {
        await traceRun.end({
          error: getLangSmithErrorMessage(error),
        })
        throw error
      })

    const summary =
      result.contentParts
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('') ?? ''

    const cleanedSummary = summary.replace(/<think>.*?<\/think>/gs, '').trim()
    await traceRun.end({
      outputs: {
        summaryPreview: cleanedSummary.slice(0, 240),
      },
    })

    return { success: true, summary: cleanedSummary }
  } catch (e: unknown) {
    if (!(e instanceof ApiError || e instanceof NetworkError)) {
      Sentry.captureException(e)
    }

    return {
      success: false,
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}
