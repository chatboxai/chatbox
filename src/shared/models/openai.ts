import { createOpenAI } from '@ai-sdk/openai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import type { ProviderModelInfo } from '../types'
import type { ModelDependencies } from '../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../utils/llm_utils'
import AbstractAISDKModel from './abstract-ai-sdk'
import { fetchRemoteModels } from './openai-compatible'
import type { CallChatCompletionOptions } from './types'

interface Options {
  apiKey: string
  apiHost: string
  model: ProviderModelInfo
  dalleStyle: 'vivid' | 'natural'
  temperature?: number
  topP?: number
  maxTokens?: number
  injectDefaultMetadata: boolean
  useProxy: boolean
  stream?: boolean
}

export default class OpenAI extends AbstractAISDKModel {
  public name = 'OpenAI'
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
    const { apiHost } = normalizeOpenAIApiHostAndPath(options)
    this.options = { ...options, apiHost }
  }

  private createFetchWithProxy = () => {
    if (!this.options.useProxy) {
      return undefined
    }

    return async (url: RequestInfo | URL, init?: RequestInit) => {
      return this.dependencies.request.fetchWithProxy(url.toString(), init)
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider() {
    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: this.createFetchWithProxy(),
      headers: this.options.apiHost.includes('openrouter.ai')
        ? {
            'HTTP-Referer': 'https://chatboxai.app',
            'X-Title': 'Chatbox AI',
          }
        : this.options.apiHost.includes('aihubmix.com')
          ? {
              'APP-Code': 'VAFU9221',
            }
          : undefined,
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.chat(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  protected getImageModel() {
    const provider = this.getProvider()
    return provider.image('dall-e-3')
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
      maxTokens: this.options.maxTokens,
      providerOptions,
    }
  }

  public listModels() {
    return fetchRemoteModels(
      {
        apiHost: this.options.apiHost,
        apiKey: this.options.apiKey,
        useProxy: this.options.useProxy,
      },
      this.dependencies
    )
  }
}
