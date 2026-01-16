import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { ProviderModelInfo } from '../types'
import type { ModelDependencies } from '../types/adapters'
import AbstractAISDKModel, { type CallSettings } from './abstract-ai-sdk'
import type { CallChatCompletionOptions } from './types'

interface Options {
  awsAccessKeyId: string
  awsSecretAccessKey: string
  awsSessionToken?: string
  awsRegion: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

export default class Bedrock extends AbstractAISDKModel {
  public name = 'AWS Bedrock'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getProvider() {
    // v3.0.73 only supports: accessKeyId, secretAccessKey, sessionToken (optional)
    const config: {
      region: string
      accessKeyId: string
      secretAccessKey: string
      sessionToken?: string
    } = {
      region: this.options.awsRegion,
      accessKeyId: this.options.awsAccessKeyId,
      secretAccessKey: this.options.awsSecretAccessKey,
    }

    if (this.options.awsSessionToken) {
      config.sessionToken = this.options.awsSessionToken
    }

    return createAmazonBedrock(config)
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return provider.languageModel(this.options.model.modelId)
  }

  protected getCallSettings(options: CallChatCompletionOptions): CallSettings {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
    }
  }

  // 不实现 listModels，使用静态模型列表
}
