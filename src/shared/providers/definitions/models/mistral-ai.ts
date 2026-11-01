import { createMistral } from '@ai-sdk/mistral'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import { createOpenAIChatCompletionSseFetch } from '../../../models/utils/openai-chat-sse-termination'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

export default class MistralAI extends AbstractAISDKModel {
  public name = 'MistralAI'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
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
      fetch: createOpenAIChatCompletionSseFetch(),
    })

    return {
      languageModel: mistral,
      embeddingModel: mistral.embedding,
    }
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
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
