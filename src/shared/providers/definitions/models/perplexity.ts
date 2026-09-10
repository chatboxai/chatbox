import { createPerplexity } from '@ai-sdk/perplexity'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { createOpenAIChatCompletionSseFetch } from '../../../models/utils/openai-chat-sse-termination'
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

  protected getProvider() {
    return createPerplexity({
      apiKey: this.options.perplexityApiKey,
      fetch: createOpenAIChatCompletionSseFetch(),
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
