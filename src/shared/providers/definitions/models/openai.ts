import { createOpenAI } from '@ai-sdk/openai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'
import { normalizeOpenAIReasoningOptions } from '../../../utils/reasoning-control'

interface Options {
  apiKey: string
  apiHost: string
  model: ProviderModelInfo
  dalleStyle: 'vivid' | 'natural'
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  injectDefaultMetadata: boolean
  useProxy: boolean
  stream?: boolean
  extraHeaders?: Record<string, string>
  customFetch?: typeof globalThis.fetch
  listModelsFallback?: ProviderModelInfo[]
  /** Skip remote model fetching and use listModelsFallback directly (e.g. OAuth tokens that can't access /models) */
  skipRemoteModelList?: boolean
  /** Skip host normalization (e.g. for Copilot API which doesn't use /v1 prefix) */
  skipHostNormalization?: boolean
}

export default class OpenAI extends AbstractAISDKModel {
  public name = 'OpenAI'
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
    if (options.skipHostNormalization) {
      this.options = options
    } else {
      const { apiHost } = normalizeOpenAIApiHostAndPath(options)
      this.options = { ...options, apiHost }
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getRequestHeaders(_options?: CallChatCompletionOptions): Record<string, string> | undefined {
    if (this.options.extraHeaders && Object.keys(this.options.extraHeaders).length > 0) {
      return this.options.extraHeaders
    }
    if (this.options.apiHost.includes('openrouter.ai')) {
      return {
        'HTTP-Referer': 'https://chatboxai.app',
        'X-Title': 'Chatbox AI',
      }
    }
    if (this.options.apiHost.includes('aihubmix.com')) {
      return {
        'APP-Code': 'VAFU9221',
      }
    }
    return undefined
  }

  protected getProvider(options?: CallChatCompletionOptions) {
    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: this.options.customFetch || createFetchWithProxy(this.options.useProxy, this.dependencies),
      headers: this.getRequestHeaders(options),
    })
  }

  protected getChatModel(options?: CallChatCompletionOptions) {
    const provider = this.getProvider(options)
    return wrapLanguageModel({
      model: provider.chat(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  protected getImageModel(modelId?: string) {
    const provider = this.getProvider()
    const imageModelId = modelId || this.options.model.modelId || 'gpt-image-1'
    return provider.image(imageModelId)
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const openaiOptions = normalizeOpenAIReasoningOptions(this.options.model.modelId, options.providerOptions?.openai)
    const providerOptions = openaiOptions
      ? {
          openai: openaiOptions,
        }
      : undefined

    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      providerOptions,
    }
  }

  public listModels() {
    if (this.options.skipRemoteModelList && this.options.listModelsFallback) {
      return Promise.resolve(this.options.listModelsFallback)
    }
    return fetchRemoteModels(
      {
        apiHost: this.options.apiHost,
        apiKey: this.options.apiKey,
        useProxy: this.options.useProxy,
        extraHeaders: this.options.extraHeaders,
        customFetch: this.options.customFetch,
      },
      this.dependencies
    ).catch((error) => {
      if (this.options.listModelsFallback) {
        console.warn(`[OpenAI] Failed to fetch remote models for ${this.options.apiHost}, using fallback.`, error)
        return this.options.listModelsFallback
      }
      throw error
    })
  }
}
