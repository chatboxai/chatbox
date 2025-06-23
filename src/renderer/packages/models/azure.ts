import { createAzure } from '@ai-sdk/azure'
import AbstractAISDKModel from './abstract-ai-sdk'
import { normalizeAzureEndpoint } from './llm_utils'
import { ProviderModelInfo } from 'src/shared/types'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import { CallChatCompletionOptions } from './types'

interface Options {
  azureEndpoint: string
  model: ProviderModelInfo
  azureDalleDeploymentName: string // dall-e-3 的部署名称
  azureApikey: string
  azureApiVersion: string

  // openaiMaxTokens: number
  temperature: number
  topP: number

  dalleStyle: 'vivid' | 'natural'
  imageGenerateNum: number // 生成图片的数量

  injectDefaultMetadata: boolean
}

export default class AzureOpenAI extends AbstractAISDKModel {
  public name = 'Azure OpenAI'

  constructor(public options: Options) {
    super(options)
  }

  private getProvider() {
    return createAzure({
      apiKey: this.options.azureApikey,
      apiVersion: this.options.azureApiVersion,
      baseURL: normalizeAzureEndpoint(this.options.azureEndpoint).endpoint,
    })
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
    }
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.chat(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  protected getImageModel() {
    const provider = this.getProvider()
    return provider.imageModel(this.options.model.modelId)
  }
}
