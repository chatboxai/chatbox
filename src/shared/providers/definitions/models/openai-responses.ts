import { createOpenAI } from '@ai-sdk/openai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIResponsesHostAndPath } from '../../../utils/llm_utils'

interface Options {
  apiKey: string
  apiHost: string
  apiPath: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
  useProxy?: boolean
  customFetch?: typeof globalThis.fetch
  listModelsFallback?: ProviderModelInfo[]
  /** Skip remote model fetching and use listModelsFallback directly (e.g. OAuth tokens that can't access /models) */
  skipRemoteModelList?: boolean
  /** Force stateless Responses requests so the SDK does not emit item references or persisted response links. */
  forceStatelessResponses?: boolean
}

type FetchFunction = typeof globalThis.fetch

export default class OpenAIResponses extends AbstractAISDKModel {
  public name = 'OpenAI Responses'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
    const { apiHost, apiPath } = normalizeOpenAIResponsesHostAndPath(options)
    this.options = { ...options, apiHost, apiPath }
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const openaiProviderOptions = options.providerOptions?.openai

    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      stream: this.options.stream,
      providerOptions:
        openaiProviderOptions || this.options.forceStatelessResponses
          ? {
              openai: {
                ...openaiProviderOptions,
                ...(this.options.forceStatelessResponses ? { store: false } : {}),
              },
            }
          : undefined,
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider(_options: CallChatCompletionOptions, fetchFunction?: FetchFunction) {
    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: fetchFunction || this.options.customFetch,
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

  protected getChatModel(options: CallChatCompletionOptions) {
    const { apiHost, apiPath } = this.options
    const provider = this.getProvider(
      options,
      this.options.customFetch ||
        ((_input, init) => createFetchWithProxy(this.options.useProxy, this.dependencies)(`${apiHost}${apiPath}`, init))
    )
    return wrapLanguageModel({
      model: provider.responses(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
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
        customFetch: this.options.customFetch,
      },
      this.dependencies
    ).catch((error) => {
      if (this.options.listModelsFallback) {
        console.warn(
          `[OpenAIResponses] Failed to fetch remote models for ${this.options.apiHost}, using fallback.`,
          error
        )
        return this.options.listModelsFallback
      }
      throw error
    })
  }

  protected getImageModel() {
    return null
  }
}
