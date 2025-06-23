import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { ProviderModelInfo } from 'src/shared/types'
import AbstractAISDKModel from './abstract-ai-sdk'

type FetchFunction = typeof globalThis.fetch

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
}

const Host = 'https://ark.cn-beijing.volces.com'
const Path = '/api/v3/chat/completions'

export default class VolcEngine extends AbstractAISDKModel {
  public name = 'VolcEngine'

  constructor(public options: Options) {
    super(options)
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
    }
  }

  private getProvider(fetchFunction?: FetchFunction) {
    return createOpenAICompatible({
      name: this.name,
      apiKey: this.options.apiKey,
      baseURL: Host,
      fetch: fetchFunction,
    })
  }
  protected getChatModel() {
    const provider = this.getProvider(async (_input, init) => {
      return fetch(`${Host}${Path}`, init)
    })
    return provider.chatModel(this.options.model.modelId)
  }

  isSupportToolUse(scope?: 'web-browsing') {
    if (scope === 'web-browsing' && this.options.model.modelId.includes('deepseek')) {
      return false
    }
    return super.isSupportToolUse()
  }
}
