// 文件: src/shared/providers/definitions/models/kevoryn.ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

const KEVORYN_API_HOST = 'https://api.kevoryn.com/v1'
const KEVORYN_APP_HEADER = 'ChatBox'

export default class KevorynModel extends AbstractAISDKModel {
  public name = 'Kevoryn'
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
    this.options = options
  }

  protected getProvider() {
    return createOpenAICompatible({
      name: this.name,
      apiKey: this.options.apiKey,
      baseURL: KEVORYN_API_HOST,
      headers: {
        'x-source': KEVORYN_APP_HEADER,
      },
    })
  }

  protected getChatModel(options: CallChatCompletionOptions) {
    const provider = this.getProvider()
    return provider.languageModel(this.options.model.modelId)
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      stream: this.options.stream,
    }
  }

  public listModels() {
    return fetchRemoteModels(
      {
        apiHost: KEVORYN_API_HOST,
        apiKey: this.options.apiKey,
        useProxy: false,
        extraHeaders: { 'x-source': KEVORYN_APP_HEADER },
      },
      this.dependencies
    )
  }

  protected getImageModel() {
    return null
  }
}
