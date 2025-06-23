import { createPerplexity } from '@ai-sdk/perplexity'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from './abstract-ai-sdk'
import { ProviderModelInfo } from 'src/shared/types'

const helpers = {
  isModelSupportVision: (model: string) => {
    return false
  },
  isModelSupportToolUse: (model: string) => {
    return false
  },
}

interface Options {
  perplexityApiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
}

export default class Perplexity extends AbstractAISDKModel {
  public name = 'Perplexity API'

  constructor(public options: Options) {
    super(options)
  }

  protected getChatModel() {
    const provider = createPerplexity({
      apiKey: this.options.perplexityApiKey,
    })
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }
}

export const perplexityModels = ['sonar-deep-research', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-pro', 'sonar']
