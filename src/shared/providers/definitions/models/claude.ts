import { type AnthropicProviderOptions, createAnthropic } from '@ai-sdk/anthropic'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import { ApiError } from '../../../models/errors'
import type { CallChatCompletionOptions } from '../../../models/types'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeClaudeHost } from '../../../utils/llm_utils'

interface Options {
  claudeApiKey: string
  claudeApiHost: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
  extraHeaders?: Record<string, string>
  customFetch?: typeof globalThis.fetch
  authToken?: string
  isOAuth?: boolean
}

export default class Claude extends AbstractAISDKModel {
  public name = 'Claude'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getProvider() {
    const authOptions = this.options.authToken
      ? { authToken: this.options.authToken }
      : { apiKey: this.options.claudeApiKey }
    return createAnthropic({
      ...authOptions,
      baseURL: normalizeClaudeHost(this.options.claudeApiHost).apiHost,
      fetch: this.options.customFetch,
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
        ...this.options.extraHeaders,
      },
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
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

    // Anthropic API requires only one of temperature or topP to be specified
    // Prefer temperature as recommended by Anthropic
    const callSettings: CallSettings = {
      providerOptions,
      maxOutputTokens: this.options.maxOutputTokens,
    }

    // Only include temperature or topP if defined, and only one of them
    if (this.options.temperature !== undefined) {
      callSettings.temperature = this.options.temperature
    } else if (this.options.topP !== undefined) {
      callSettings.topP = this.options.topP
    }

    // Anthropic OAuth tokens require Claude Code identity passphrase as the first system block
    if (this.options.isOAuth) {
      callSettings.system = "You are Claude Code, Anthropic's official CLI for Claude."
    }

    return callSettings
  }

  // https://docs.anthropic.com/en/docs/api/models
  public async listModels(): Promise<ProviderModelInfo[]> {
    type Response = {
      data: { id: string; type: string }[]
    }
    const url = `${this.options.claudeApiHost}/models?limit=990`
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
      ...this.options.extraHeaders,
    }
    if (this.options.authToken) {
      headers['Authorization'] = `Bearer ${this.options.authToken}`
    } else if (this.options.claudeApiKey) {
      headers['x-api-key'] = this.options.claudeApiKey
    }
    const res = await this.dependencies.request.apiRequest({
      url: url,
      method: 'GET',
      headers,
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
