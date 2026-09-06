import { createAnthropic } from '@ai-sdk/anthropic'
import type { ModelMessage, ToolSet } from 'ai'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import { type AnthropicCacheTtl, addAnthropicCacheControl } from '../../../models/anthropic-cache'
import { ApiError } from '../../../models/errors'
import type { CallChatCompletionOptions, ChatStreamOptions, ModelStreamPart } from '../../../models/types'
import type { ProviderModelInfo, StreamTextResult } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeClaudeHost } from '../../../utils/llm_utils'
import { isClaudeAdaptiveThinkingModel, normalizeClaudeReasoningOptions } from '../../../utils/reasoning-control'

interface Options {
  claudeApiKey: string
  claudeApiHost: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
  anthropicCacheTtl?: AnthropicCacheTtl
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
      fetch: this.createFetch(),
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
        ...this.options.extraHeaders,
      },
    })
  }

  private createFetch(): typeof globalThis.fetch | undefined {
    const baseFetch = this.options.customFetch || globalThis.fetch.bind(globalThis)
    return (input, init) => {
      if (typeof init?.body !== 'string') {
        return baseFetch(input, init)
      }

      const body = parseJsonObject(init.body)
      if (!body) {
        return baseFetch(input, init)
      }

      let nextBody = body
      if (
        isClaudeAdaptiveThinkingModel(this.options.model.modelId) &&
        isRecord(nextBody.output_config) &&
        typeof nextBody.output_config.effort === 'string'
      ) {
        nextBody = {
          ...nextBody,
          thinking: { type: 'adaptive' },
        }
      }

      if (isRecord(nextBody.thinking) && nextBody.thinking.type !== 'disabled' && !nextBody.thinking.display) {
        nextBody = {
          ...nextBody,
          thinking: {
            ...nextBody.thinking,
            display: 'summarized',
          },
        }
      }

      if (nextBody === body) {
        return baseFetch(input, init)
      }

      return baseFetch(input, {
        ...init,
        body: JSON.stringify(nextBody),
      })
    }
  }

  protected getChatModel() {
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

  public async chat(messages: ModelMessage[], options: CallChatCompletionOptions): Promise<StreamTextResult> {
    return super.chat(addAnthropicCacheControl(messages, this.options.anthropicCacheTtl), options)
  }

  public async *chatStream<T extends ToolSet>(
    messages: ModelMessage[],
    options: ChatStreamOptions
  ): AsyncGenerator<ModelStreamPart<T>> {
    yield* super.chatStream<T>(addAnthropicCacheControl(messages, this.options.anthropicCacheTtl), options)
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

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
