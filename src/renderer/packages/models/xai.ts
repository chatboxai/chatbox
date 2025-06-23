import { ProviderModelInfo } from 'src/shared/types'
import OpenAICompatible from './openai-compatible'


interface Options {
  xAIKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
}

export default class XAI extends OpenAICompatible {
  public name = 'xAI'

  constructor(public options: Options) {
    super({
      apiKey: options.xAIKey,
      apiHost: 'https://api.x.ai/v1',
      model: options.model,
      temperature: options.temperature,
      topP: options.topP,
    })
  }
}
