import { createPerplexity } from '@ai-sdk/perplexity'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import type { CallChatCompletionOptions } from '../../../models/types'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  perplexityApiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

export default class Perplexity extends AbstractAISDKModel {
  public name = 'Perplexity API'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings(_options: CallChatCompletionOptions): CallSettings {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      // Perplexity API rejects max_tokens < 16 with HTTP 400.
      // Floor to 16 so a small user-configured value never causes a request error.
      maxOutputTokens: this.options.maxOutputTokens != null ? Math.max(16, this.options.maxOutputTokens) : undefined,
    }
  }

  protected getProvider() {
    return createPerplexity({
      apiKey: this.options.perplexityApiKey,
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }
}

export const perplexityModels = ['sonar-deep-research', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-pro', 'sonar']
