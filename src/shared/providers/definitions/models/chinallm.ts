import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import type { CallChatCompletionOptions } from '../../../models/types'
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

export default class ChinaLLM extends AbstractAISDKModel {
  public name = 'ChinaLLM'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getProvider() {
    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: 'https://api.chinallm.dev/v1',
      compatibility: 'strict',
    })
  }

  protected getChatModel(_options: CallChatCompletionOptions): LanguageModelV3 {
    const provider = this.getProvider()
    return provider.chat(this.options.model.modelId)
  }

  protected getCallSettings(_options: CallChatCompletionOptions): CallSettings {
    const isReasonerModel = this.options.model.modelId === 'deepseek-reasoner'
    const settings: CallSettings = {
      maxOutputTokens: this.options.maxOutputTokens,
    }

    if (!isReasonerModel) {
      settings.temperature = this.options.temperature
      settings.topP = this.options.topP
    }

    return settings
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
}
