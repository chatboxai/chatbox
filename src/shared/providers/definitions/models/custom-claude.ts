import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ModelMessage, ToolSet } from 'ai'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import { addAnthropicCacheControl } from '../../../models/anthropic-cache'
import { ApiError } from '../../../models/errors'
import type { CallChatCompletionOptions, ChatStreamOptions, ModelStreamPart } from '../../../models/types'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo, StreamTextResult } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeClaudeHost } from '../../../utils/llm_utils'
import { normalizeClaudeReasoningOptions } from '../../../utils/reasoning-control'

interface Options {
  apiKey: string
  apiHost: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
  useProxy?: boolean
}

export default class CustomClaude extends AbstractAISDKModel {
  public name = 'Custom Claude'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
    const { apiHost } = normalizeClaudeHost(options.apiHost)
    this.options = { ...options, apiHost }
    this.injectDefaultMetadata = false
  }

  protected getProvider() {
    return createAnthropic({
      baseURL: this.options.apiHost,
      apiKey: this.options.apiKey,
      fetch: createFetchWithProxy(this.options.useProxy, this.dependencies),
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
  }

  protected getChatModel(_options: CallChatCompletionOptions): LanguageModelV3 {
    const provider = this.getProvider()
    return provider.languageModel(this.options.model.modelId)
  }

  protected getCallSettings(options: CallChatCompletionOptions): CallSettings {
    const isModelSupportReasoning = this.isSupportReasoning()
    let providerOptions: CallSettings['providerOptions'] = {}
    if (isModelSupportReasoning) {
      providerOptions = {
        anthropic: {
          ...(normalizeClaudeReasoningOptions(this.options.model.modelId, options.providerOptions?.claude) || {}),
        },
      }
    }

    const callSettings: CallSettings = {
      providerOptions,
      maxOutputTokens: this.options.maxOutputTokens,
    }

    if (this.options.temperature !== undefined) {
      callSettings.temperature = this.options.temperature
    } else if (this.options.topP !== undefined) {
      callSettings.topP = this.options.topP
    }

    return callSettings
  }

  public async chat(messages: ModelMessage[], options: CallChatCompletionOptions): Promise<StreamTextResult> {
    return super.chat(addAnthropicCacheControl(messages), options)
  }

  public async *chatStream<T extends ToolSet>(
    messages: ModelMessage[],
    options: ChatStreamOptions
  ): AsyncGenerator<ModelStreamPart<T>> {
    yield* super.chatStream<T>(addAnthropicCacheControl(messages), options)
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    type Response = {
      data: { id: string; type: string }[]
    }
    const url = `${this.options.apiHost}/models?limit=990`
    const res = await this.dependencies.request.apiRequest({
      url: url,
      method: 'GET',
      useProxy: this.options.useProxy,
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-api-key': this.options.apiKey,
      },
    })
    const json: Response = await res.json()
    if (!json['data']) {
      throw new ApiError(JSON.stringify(json))
    }
    return json['data']
      .filter((item) => item.type === 'model')
      .map((item) => ({
        modelId: item.id,
        type: 'chat',
      }))
  }
}
