import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { fetchRemoteModels, getOpenAICompatibleProviderOptionsKey } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { isDeepSeekReasoningModel, normalizeDeepSeekReasoningEffort } from '../../../models/utils/deepseek'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import { createOpenAIChatCompletionSseFetch } from '../../../models/utils/openai-chat-sse-termination'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'
import { pickOpenAICompatibleReasoningOptions } from '../../../utils/reasoning-control'
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

export default class CustomOpenAI extends AbstractAISDKModel {
  public name = 'Custom OpenAI'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
    const { apiHost, apiPath } = normalizeOpenAIApiHostAndPath(options)
    this.options = { ...options, apiHost, apiPath }
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const modelId = this.options.model.modelId
    // The reasoning control writes DeepSeek's namespace for custom compatible
    // endpoints too. The compatible SDK needs those values in its own namespace.
    // Keep OpenAI-only flags filtered and don't carry stale DeepSeek options to
    // other model families.
    const deepseekOptions = isDeepSeekReasoningModel(modelId) ? options.providerOptions?.deepseek : undefined
    const thinking = deepseekOptions?.thinking
    const reasoningEffort = normalizeDeepSeekReasoningEffort(modelId, deepseekOptions?.reasoningEffort)
    const compatibleOptions = {
      ...pickOpenAICompatibleReasoningOptions(modelId, options.providerOptions),
      ...(thinking ? { thinking } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    }
    const openAICompatibleOptions = Object.keys(compatibleOptions).length ? compatibleOptions : undefined
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      stream: this.options.stream,
      providerOptions: openAICompatibleOptions
        ? {
            openaiCompatible: openAICompatibleOptions,
            [getOpenAICompatibleProviderOptionsKey(this.name)]: openAICompatibleOptions,
          }
        : undefined,
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider(_options: CallChatCompletionOptions, fetchFunction?: FetchFunction) {
    return createOpenAICompatible({
      name: this.name,
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
    const fetch = createOpenAIChatCompletionSseFetch(async (_input, init) =>
      createFetchWithProxy(this.options.useProxy, this.dependencies)(`${apiHost}${apiPath}`, init)
    )
    const provider = this.getProvider(options, fetch)
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
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
