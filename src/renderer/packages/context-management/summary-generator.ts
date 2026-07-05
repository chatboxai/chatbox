import { ApiError, NetworkError } from '@shared/models/errors'
import * as Sentry from '@shared/sentry-shim'
import type { Language, Message, ModelProvider, SessionSettings, Settings } from '@shared/types'
import { createModel } from '@/adapters'
import { languageNameMap } from '@/i18n/locales'
import { generateText } from '@/packages/model-calls'
import { convertToModelMessages } from '@/packages/model-calls/message-utils'
import * as promptFormat from '@/packages/prompts'
import * as settingActions from '@/stores/settingActions'
import { settingsStore } from '@/stores/settingsStore'

export interface SummaryGeneratorOptions {
  messages: Message[]
  language?: Language
  sessionSettings?: SessionSettings
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
    const model = await createModel(settings)

    const promptMessages = promptFormat.summarizeConversation(messages, languageName)
    const result = await generateText(model, promptMessages)

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
    const model = await createModel(settings)

    const promptMessages = promptFormat.summarizeConversation(messages, languageName)
    const coreMessages = await convertToModelMessages(promptMessages, { modelSupportVision: model.isSupportVision() })

    const result = await model.chat(coreMessages, {
      onResultChange: (data) => {
        if (data.contentParts && onStreamUpdate) {
          const newText = data.contentParts
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('')
          onStreamUpdate(newText)
        }
      },
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
