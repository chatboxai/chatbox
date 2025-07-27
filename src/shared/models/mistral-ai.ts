import { createMistral } from '@ai-sdk/mistral'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import type { ProviderModelInfo } from 'src/shared/types'
import type { ModelDependencies } from 'src/shared/types/adapters'
import AbstractAISDKModel from './abstract-ai-sdk'
import { fetchRemoteModels } from './utils/fetch-proxy'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxTokens?: number
  stream?: boolean
}

export default class MistralAI extends AbstractAISDKModel {
  public name = 'MistralAI'

  constructor(public options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxTokens: this.options.maxTokens,
      providerOptions: {
        mistral: {
          documentImageLimit: 8, 
          documentPageLimit: 64,  
        },
      },
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider() {
    const mistral = createMistral({
      apiKey: this.options.apiKey,
      baseURL: 'https://api.mistral.ai/v1',
    })
    
    return {
      languageModel: mistral,
      textEmbeddingModel: mistral.textEmbedding,
    }
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }
  public async listModels(): Promise<string[]> {
    return fetchRemoteModels(
      {
        apiHost: 'https://api.mistral.ai/v1',
        apiKey: this.options.apiKey,
        useProxy: false,
      },
      this.dependencies
    ).catch((err) => {
      console.error(err)
      return []
    })
  }
}
