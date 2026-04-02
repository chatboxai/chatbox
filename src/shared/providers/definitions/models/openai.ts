import { createOpenAI } from '@ai-sdk/openai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'

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
  customFetch?: typeof globalThis.fetch
  listModelsFallback?: ProviderModelInfo[]
}

export default class OpenAI extends AbstractAISDKModel {
  public name = 'OpenAI'
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
    const { apiHost } = normalizeOpenAIApiHostAndPath(options)
    this.options = { ...options, apiHost }
  }

  static isSupportTextEmbedding() {
    return true
  }

  private createProvider(fetchFunction?: typeof globalThis.fetch) {
    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: fetchFunction || this.options.customFetch || createFetchWithProxy(this.options.useProxy, this.dependencies),
      headers: this.options.apiHost.includes('openrouter.ai')
        ? {
            'HTTP-Referer': 'https://chatboxai.app',
            'X-Title': 'Chatbox AI',
          }
        : undefined,
    })
  }

  protected getProvider(_options: CallChatCompletionOptions) {
    return this.createProvider()
  }

  protected getChatModel() {
    const provider = this.createProvider()
    return wrapLanguageModel({
      model: provider.chat(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  protected getImageModel(modelId?: string) {
    const provider = this.createProvider()
    const imageModelId = modelId || this.options.model.modelId || 'gpt-image-1'
    return provider.image(imageModelId)
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const isModelSupportReasoning = this.isSupportReasoning()
    let providerOptions = {}
    if (isModelSupportReasoning) {
      providerOptions = {
        openai: options.providerOptions?.openai || {},
      }
    }

    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      providerOptions,
    }
  }

  public listModels() {
    return fetchRemoteModels(
      {
        apiHost: this.options.apiHost,
        apiKey: this.options.apiKey,
        useProxy: this.options.useProxy,
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
