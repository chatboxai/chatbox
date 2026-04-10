import { createGoogleGenerativeAI, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { generateText } from 'ai'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import { ApiError } from '../../../models/errors'
import type { CallChatCompletionOptions } from '../../../models/types'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeGoogleThinkingConfig } from '../../../utils/google-thinking'
import { normalizeGeminiHost } from '../../../utils/llm_utils'

const GEMINI_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-image',
]

interface Options {
  apiKey: string
  apiHost: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

export default class CustomGemini extends AbstractAISDKModel {
  public name = 'Custom Gemini'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
    this.injectDefaultMetadata = false
  }

  isSupportSystemMessage() {
    return ![
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-thinking-exp',
      'gemini-2.0-flash-exp-image-generation',
      'gemini-2.5-flash-image-preview',
    ].includes(this.options.model.modelId)
  }

  protected getProvider() {
    return createGoogleGenerativeAI({
      apiKey: this.options.apiKey,
      baseURL: normalizeGeminiHost(this.options.apiHost).apiHost,
    })
  }

  protected getChatModel(_options: CallChatCompletionOptions): LanguageModelV3 {
    const provider = this.getProvider()
    return provider.chat(this.options.model.modelId)
  }

  protected getCallSettings(options: CallChatCompletionOptions): CallSettings {
    const isModelSupportThinking = this.isSupportReasoning()

    let providerParams: GoogleGenerativeAIProviderOptions = {
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      ],
    }

    if (isModelSupportThinking) {
      providerParams = {
        ...providerParams,
        ...(options.providerOptions?.google || {}),
        thinkingConfig: {
          ...(normalizeGoogleThinkingConfig(
            this.options.model.modelId,
            options.providerOptions?.google?.thinkingConfig
          ) || {}),
          includeThoughts: true,
        },
      }
    }

    const settings: CallSettings = {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      providerOptions: {
        google: {
          ...providerParams,
        } satisfies GoogleGenerativeAIProviderOptions,
      },
    }

    if (GEMINI_IMAGE_MODELS.includes(this.options.model.modelId)) {
      settings.providerOptions = {
        google: {
          ...providerParams,
          responseModalities: ['TEXT', 'IMAGE'],
        } satisfies GoogleGenerativeAIProviderOptions,
      }
    }

    return settings
  }

  public async paint(
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
      aspectRatio?: string
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void
  ): Promise<string[]> {
    if (!GEMINI_IMAGE_MODELS.includes(this.options.model.modelId)) {
      throw new ApiError('This Gemini model does not support image generation')
    }

    const provider = this.getProvider()
    const model = provider.chat(this.options.model.modelId)

    const results: string[] = []
    for (let i = 0; i < params.num; i++) {
      const providerOptions: GoogleGenerativeAIProviderOptions = {
        responseModalities: ['TEXT', 'IMAGE'],
      }
      if (params.aspectRatio && params.aspectRatio !== 'auto') {
        providerOptions.imageConfig = { aspectRatio: params.aspectRatio }
      }

      const result = await generateText({
        model,
        messages: [{ role: 'user', content: params.prompt }],
        abortSignal: signal,
        providerOptions: {
          google: providerOptions,
        },
      })

      for (const file of result.files) {
        if (file.mediaType?.startsWith('image/') && file.base64) {
          const dataUrl = `data:${file.mediaType};base64,${file.base64}`
          results.push(dataUrl)
          callback?.(dataUrl)
        }
      }
    }
    return results
  }

  async listModels(): Promise<ProviderModelInfo[]> {
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

    try {
      const { apiHost } = normalizeGeminiHost(this.options.apiHost)
      const res = await this.dependencies.request.apiRequest({
        url: `${apiHost}/models?key=${this.options.apiKey}`,
        method: 'GET',
        headers: {},
      })
      const json: Response = await res.json()

      if (!json.models) {
        throw new ApiError(JSON.stringify(json))
      }

      return json.models
        .filter((m) => m.supportedGenerationMethods.some((method) => method.includes('generate')))
        .filter((m) => m.name.includes('gemini'))
        .map((m) => ({
          modelId: m.name.replace('models/', ''),
          nickname: m.displayName,
          type: 'chat' as const,
          contextWindow: m.inputTokenLimit,
          maxOutput: m.outputTokenLimit,
        }))
        .sort((a, b) => a.modelId.localeCompare(b.modelId))
    } catch (error) {
      console.error('Failed to fetch Gemini models:', error)
      return []
    }
  }
}
