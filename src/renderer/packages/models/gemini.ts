import { apiRequest } from '@/utils/request'
import { createGoogleGenerativeAI, GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { LanguageModelV1 } from 'ai'
import AbstractAISDKModel, { CallSettings } from './abstract-ai-sdk'
import { ApiError } from './errors'
import { normalizeGeminiHost } from './llm_utils'
import { CallChatCompletionOptions } from './types'
import { ProviderModelInfo } from 'src/shared/types'

interface Options {
  geminiAPIKey: string
  geminiAPIHost: string
  model: ProviderModelInfo
  temperature: number
}

export default class Gemeni extends AbstractAISDKModel {
  public name = 'Google Gemini'

  constructor(public options: Options) {
    super(options)
    this.injectDefaultMetadata = false
  }

  isSupportSystemMessage() {
    return !['gemini-2.0-flash-exp', 'gemini-2.0-flash-thinking-exp', 'gemini-2.0-flash-exp-image-generation'].includes(
      this.options.model.modelId
    )
  }

  protected getChatModel(options: CallChatCompletionOptions): LanguageModelV1 {
    const provider = createGoogleGenerativeAI({
      apiKey: this.options.geminiAPIKey,
      baseURL: normalizeGeminiHost(this.options.geminiAPIHost).apiHost,
    })

    return provider.chat(this.options.model.modelId, {
      structuredOutputs: false,
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      ],
    })
  }

  protected getCallSettings(options: CallChatCompletionOptions): CallSettings {
    const isModelSupportThinking = this.isSupportReasoning()
    let providerParams = {} as GoogleGenerativeAIProviderOptions
    if (isModelSupportThinking) {
      providerParams = {
        ...(options.providerOptions?.google || {}),
        thinkingConfig: {
          ...(options.providerOptions?.google?.thinkingConfig || {}),
          includeThoughts: true,
        },
      }
    }

    const settings: CallSettings = {
      providerOptions: {
        google: {
          ...providerParams,
        } satisfies GoogleGenerativeAIProviderOptions,
      },
    }
    if (['gemini-2.0-flash-preview-image-generation'].includes(this.options.model.modelId)) {
      settings.providerOptions = {
        google: {
          ...providerParams,
          responseModalities: ['TEXT', 'IMAGE'],
        } satisfies GoogleGenerativeAIProviderOptions,
      }
    }
    return settings
  }

  async listModels(): Promise<string[]> {
    // https://ai.google.dev/api/models#method:-models.list
    type Response = {
      models: {
        name: string
        version: string
        displayName: string
        description: string
        inputTokenLimit: number
        outputTokenLimit: number
        supportedGenerationMethods: string[]
        temperature: number
        topP: number
        topK: number
      }[]
    }
    const res = await apiRequest.get(`${this.options.geminiAPIHost}/v1beta/models?key=${this.options.geminiAPIKey}`, {})
    const json: Response = await res.json()
    if (!json['models']) {
      throw new ApiError(JSON.stringify(json))
    }
    return json['models']
      .filter((m) => m['supportedGenerationMethods'].some((method) => method.includes('generate')))
      .filter((m) => m['name'].includes('gemini'))
      .map((m) => m['name'].replace('models/', ''))
      .sort()
  }
}
