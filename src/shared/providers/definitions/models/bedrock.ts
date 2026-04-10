import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import type { CallChatCompletionOptions } from '../../../models/types'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  accessKey: string
  secretKey: string
  sessionToken?: string
  region: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
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
    const config: {
      region: string
      accessKeyId: string
      secretAccessKey: string
      sessionToken?: string
    } = {
      region: this.options.region,
      accessKeyId: this.options.accessKey,
      secretAccessKey: this.options.secretKey,
    }

    if (this.options.sessionToken) {
      config.sessionToken = this.options.sessionToken
    }

    return createAmazonBedrock(config)
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return provider.languageModel(this.options.model.modelId)
  }

  protected getCallSettings(_options: CallChatCompletionOptions): CallSettings {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
    }
  }
}
