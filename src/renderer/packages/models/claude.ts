import { apiRequest } from '@/utils/request'
import { AnthropicProviderOptions, createAnthropic } from '@ai-sdk/anthropic'
import { ProviderModelInfo } from 'src/shared/types'
import AbstractAISDKModel, { CallSettings } from './abstract-ai-sdk'
import { ApiError } from './errors'
import { normalizeClaudeHost } from './llm_utils'
import { CallChatCompletionOptions } from './types'

interface Options {
  claudeApiKey: string
  claudeApiHost: string
  model: ProviderModelInfo
}

export default class Claude extends AbstractAISDKModel {
  public name = 'Claude'

  constructor(public options: Options) {
    super(options)
  }

  protected getChatModel() {
    const provider = createAnthropic({
      baseURL: normalizeClaudeHost(this.options.claudeApiHost).apiHost,
      apiKey: this.options.claudeApiKey,
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    return provider.languageModel(this.options.model.modelId)
  }

  protected getCallSettings(options: CallChatCompletionOptions): CallSettings {
    const isModelSupportReasoning = this.isSupportReasoning()
    let providerOptions = {} as { anthropic: AnthropicProviderOptions }
    if (isModelSupportReasoning) {
      providerOptions = {
        anthropic: {
          ...(options.providerOptions?.claude || {}),
        },
      }
    }
    return {
      providerOptions,
    }
  }

  // https://docs.anthropic.com/en/docs/api/models
  public async listModels(): Promise<string[]> {
    type Response = {
      data: { id: string; type: string }[]
    }
    const url = `${this.options.claudeApiHost}/models?limit=990`
    const res = await apiRequest.get(url, {
      'anthropic-version': '2023-06-01',
      'x-api-key': this.options.claudeApiKey,
    })
    const json: Response = await res.json()
    if (!json['data']) {
      throw new ApiError(JSON.stringify(json))
    }
    return json['data'].filter((item) => item.type === 'model').map((item) => item.id)
  }
}
