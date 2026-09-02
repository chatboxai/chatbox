import { createDeepSeek, type DeepSeekChatOptions } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import { ApiError } from '../../../models/errors'
import { getOpenAICompatibleProviderOptionsKey } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import {
  isDeepSeekReasoningModel,
  isDeepSeekWeakToolUse,
  normalizeDeepSeekReasoningEffort,
} from '../../../models/utils/deepseek'
import type { ProviderModelInfo, ToolUseScope } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

export default class DeepSeek extends AbstractAISDKModel {
  public name = 'DeepSeek'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  private usesVisionCompatibleTransport() {
    return this.isSupportVision()
  }

  protected getProvider() {
    if (this.usesVisionCompatibleTransport()) {
      return createOpenAICompatible({
        name: this.name,
        apiKey: this.options.apiKey,
        baseURL: 'https://api.deepseek.com',
      })
    }

    return createDeepSeek({
      apiKey: this.options.apiKey,
    })
  }

  protected getChatModel(_options: CallChatCompletionOptions): LanguageModelV3 {
    if (this.usesVisionCompatibleTransport()) {
      const provider = createOpenAICompatible({
        name: this.name,
        apiKey: this.options.apiKey,
        baseURL: 'https://api.deepseek.com',
      })
      return provider.chatModel(this.options.model.modelId)
    }

    const provider = createDeepSeek({
      apiKey: this.options.apiKey,
    })
    return provider.chat(this.options.model.modelId)
  }

  protected getCallSettings(options: CallChatCompletionOptions): CallSettings {
    const deepseekOptions = options.providerOptions?.deepseek
    const thinkingType = deepseekOptions?.thinking?.type
    const reasoningEffort = normalizeDeepSeekReasoningEffort(
      this.options.model.modelId,
      deepseekOptions?.reasoningEffort
    )
    const isThinkingMode = this.isSupportReasoning() && thinkingType !== 'disabled'
    const settings: CallSettings = {
      maxOutputTokens: this.options.maxOutputTokens,
    }

    // DeepSeek thinking mode does not support temperature or topP.
    if (!isThinkingMode) {
      settings.temperature = this.options.temperature
      settings.topP = this.options.topP
    }

    if (!this.isSupportReasoning() || (!thinkingType && !reasoningEffort)) {
      return settings
    }

    if (this.usesVisionCompatibleTransport()) {
      const openAICompatibleOptions = {
        ...(thinkingType ? { thinking: { type: thinkingType } } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      }
      settings.providerOptions = {
        openaiCompatible: openAICompatibleOptions,
        [getOpenAICompatibleProviderOptionsKey(this.name)]: openAICompatibleOptions,
      }
      return settings
    }

    settings.providerOptions = {
      deepseek: {
        ...(thinkingType ? { thinking: { type: thinkingType } } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      } satisfies DeepSeekChatOptions,
    }

    return settings
  }

  isSupportToolUse(scope?: ToolUseScope) {
    if (isDeepSeekWeakToolUse(this.options.model.modelId, scope)) return false
    return super.isSupportToolUse()
  }

  isSupportReasoning() {
    return isDeepSeekReasoningModel(this.options.model.modelId)
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const res = await this.dependencies.request.apiRequest({
      url: 'https://api.deepseek.com/models',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
      },
    })
    const json = await res.json()
    if (!json.data) {
      throw new ApiError(JSON.stringify(json))
    }
    return json.data
      .map((m: { id: string; owned_by?: string }) => ({
        modelId: m.id,
        type: 'chat' as const,
      }))
      .sort((a: ProviderModelInfo, b: ProviderModelInfo) => a.modelId.localeCompare(b.modelId))
  }
}
