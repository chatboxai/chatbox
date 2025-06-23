import { ProviderModelInfo } from 'src/shared/types'
import OpenAICompatible from './openai-compatible'

interface Options {
  siliconCloudKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
}

export default class SiliconFlow extends OpenAICompatible {
  public name = 'SiliconFlow'

  constructor(public options: Options) {
    super({
      apiKey: options.siliconCloudKey,
      apiHost: 'https://api.siliconflow.cn/v1',
      model: options.model,
      temperature: options.temperature,
      topP: options.topP,
    })
  }

  isSupportToolUse(scope?: 'web-browsing') {
    if (scope === 'web-browsing' && this.options.model.modelId.includes('deepseek')) {
      return false
    }
    return super.isSupportToolUse()
  }
}
