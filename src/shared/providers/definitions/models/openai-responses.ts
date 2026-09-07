import { createOpenAI } from '@ai-sdk/openai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIResponsesHostAndPath } from '../../../utils/llm_utils'
import { normalizeOpenAIReasoningOptions } from '../../../utils/reasoning-control'

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
  extraHeaders?: Record<string, string>
  customFetch?: typeof globalThis.fetch
  listModelsFallback?: ProviderModelInfo[]
  /** Skip remote model fetching and use listModelsFallback directly (e.g. OAuth tokens that can't access /models) */
  skipRemoteModelList?: boolean
  /** Skip host normalization (e.g. for Copilot API which doesn't use /v1 prefix) */
  skipHostNormalization?: boolean
}

type FetchFunction = typeof globalThis.fetch

export default class OpenAIResponses extends AbstractAISDKModel {
  public name = 'OpenAI Responses'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
    if (options.skipHostNormalization) {
      this.options = { ...options, apiPath: options.apiPath || '/responses' }
    } else {
      const { apiHost, apiPath } = normalizeOpenAIResponsesHostAndPath(options)
      this.options = { ...options, apiHost, apiPath }
    }
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const openaiProviderOptions = normalizeOpenAIReasoningOptions(
      this.options.model.modelId,
      options.providerOptions?.openai
    )

    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      stream: this.options.stream,
      // Chatbox always sends the full context itself and never relies on the Responses API's
      // server-side state (previous_response_id / item_reference), which additionally cannot be
      // resolved across relay/gateway providers. Force store=false so the SDK inlines the full
      // history and avoids tool-call / item id mismatches (see issue #3728).
      providerOptions: {
        openai: {
          ...openaiProviderOptions,
          store: false,
        },
      },
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider(_options: CallChatCompletionOptions, fetchFunction?: FetchFunction) {
    let headers: Record<string, string> | undefined
    if (this.options.extraHeaders && Object.keys(this.options.extraHeaders).length > 0) {
      headers = this.options.extraHeaders
    } else if (this.options.apiHost.includes('openrouter.ai')) {
      headers = {
        'HTTP-Referer': 'https://chatboxai.app',
        'X-Title': 'Chatbox AI',
      }
    } else if (this.options.apiHost.includes('aihubmix.com')) {
      headers = {
        'APP-Code': 'VAFU9221',
      }
    }

    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: fetchFunction || this.options.customFetch,
      headers,
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
        extraHeaders: this.options.extraHeaders,
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
