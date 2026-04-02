import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import type { ProviderModelInfo, ToolUseScope } from '../types'
import type { ModelDependencies } from '../types/adapters'
import AbstractAISDKModel from './abstract-ai-sdk'
import { ApiError } from './errors'
import type { ModelInterface } from './types'
import { createFetchWithProxy } from './utils/fetch-proxy'

export interface OpenAICompatibleSettings {
  apiKey: string
  apiHost: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  useProxy?: boolean
  maxOutputTokens?: number
  stream?: boolean
  customFetch?: typeof globalThis.fetch
}

export default abstract class OpenAICompatible extends AbstractAISDKModel implements ModelInterface {
  public name = 'OpenAI Compatible'

  constructor(
    public options: OpenAICompatibleSettings,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
    }
  }

  static isSupportTextEmbedding() {
    return true
  }
  isSupportToolUse(scope?: ToolUseScope) {
    if (
      scope &&
      ['web-browsing', 'read-file'].includes(scope) &&
      /deepseek-(v3|r1)$/.test(this.options.model.modelId.toLowerCase())
    ) {
      return false
    }
    return super.isSupportToolUse()
  }

  protected getProvider() {
    return createOpenAICompatible({
      name: this.name,
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: this.options.customFetch || createFetchWithProxy(this.options.useProxy, this.dependencies),
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    return await fetchRemoteModels(
      {
        apiHost: this.options.apiHost,
        apiKey: this.options.apiKey,
        useProxy: this.options.useProxy,
      },
      this.dependencies
    ).catch((err) => {
      console.error(err)
      return []
    })
  }
}

interface ListModelsResponse {
  object: 'list'
  data: {
    id: string
    object: 'model'
    created: number
    owned_by?: string
    // OpenRouter specific fields
    name?: string
    context_length?: number
    architecture?: {
      input_modalities?: string[]
      output_modalities?: string[]
      tokenizer?: string
    }
    pricing?: {
      prompt?: string
      completion?: string
      image?: string
      request?: string
      web_search?: string
      internal_reasoning?: string
    }
    top_provider?: {
      is_moderated?: boolean
    }
    canonical_slug?: string
    hugging_face_id?: string
    per_request_limits?: Record<string, any>
    supported_parameters?: string[]
  }[]
}

export async function fetchRemoteModels(
  params: { apiHost: string; apiKey: string; useProxy?: boolean; customFetch?: typeof globalThis.fetch },
  dependencies: ModelDependencies
) {
  const response = params.customFetch
    ? await params.customFetch(`${params.apiHost}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
        },
      })
    : await dependencies.request.apiRequest({
        url: `${params.apiHost}/models`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
        },
        useProxy: params.useProxy,
      })
  const json: ListModelsResponse = await response.json()
  if (!json.data) {
    throw new ApiError(JSON.stringify(json))
  }
  return json.data.map((item) => {
    const modelInfo: ProviderModelInfo = {
      modelId: item.id,
      type: 'chat',
    }

    // Add nickname from OpenRouter name field
    if (item.name) {
      modelInfo.nickname = item.name
    }

    // Add context window if available
    if (item.context_length) {
      modelInfo.contextWindow = item.context_length
    }

    // Add capabilities based on architecture
    if (item.architecture) {
      const capabilities: ProviderModelInfo['capabilities'] = []

      // Check for vision capability
      if (item.architecture.input_modalities?.includes('image')) {
        capabilities.push('vision')
      }

      // Check for web search capability (OpenRouter specific)
      if (item.pricing?.web_search && item.pricing.web_search !== '0') {
        capabilities.push('web_search')
      }

      // Check for reasoning capability (OpenRouter specific)
      if (item.pricing?.internal_reasoning && item.pricing.internal_reasoning !== '0') {
        capabilities.push('reasoning')
      }

      // Note: tool_use capability cannot be determined from OpenRouter response
      // It would need to be added from local defaults

      if (capabilities.length > 0) {
        modelInfo.capabilities = capabilities
      }
    }

    return modelInfo
  })
}
