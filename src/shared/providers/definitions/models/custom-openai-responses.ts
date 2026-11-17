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
import {
  compatibleImageApiHeaders,
  createOpenAICompatibleImageModel,
  getOpenAIImageGenerationOptions,
} from './openai-compatible-image'

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
}

type FetchFunction = typeof globalThis.fetch

export default class CustomOpenAIResponses extends AbstractAISDKModel {
  public name = 'Custom OpenAI Responses'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
    const { apiHost, apiPath } = normalizeOpenAIResponsesHostAndPath(options)
    this.options = { ...options, apiHost, apiPath }
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
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
          ...normalizeOpenAIReasoningOptions(this.options.model.modelId, options.providerOptions?.openai),
          store: false,
        },
      },
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider(_options: CallChatCompletionOptions, fetchFunction?: FetchFunction) {
    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: fetchFunction,
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
    const provider = this.getProvider(options, (_input, init) =>
      createFetchWithProxy(this.options.useProxy, this.dependencies)(`${apiHost}${apiPath}`, init)
    )
    return wrapLanguageModel({
      model: provider.responses(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
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

  protected getImageModel() {
    const modelId = this.options.model.modelId
    if (!modelId) return null
    return createOpenAICompatibleImageModel({
      apiKey: this.options.apiKey,
      apiHost: this.options.apiHost,
      modelId,
      fetch: createFetchWithProxy(this.options.useProxy, this.dependencies),
      headers: compatibleImageApiHeaders(this.options.apiHost),
    })
  }

  protected override getImageGenerationOptions(aspectRatio?: string) {
    return getOpenAIImageGenerationOptions(this.options.model.modelId, aspectRatio)
  }

  protected override getMaxImagesPerGenerationRequest() {
    return 1
  }
}
