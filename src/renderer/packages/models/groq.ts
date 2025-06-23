import { ProviderModelInfo } from 'src/shared/types'
import OpenAICompatible from './openai-compatible'

interface Options {
  groqAPIKey: string
  model: ProviderModelInfo
  temperature: number
}

export default class Groq extends OpenAICompatible {
  public name = 'Groq'

  constructor(public options: Options) {
    super({
      apiKey: options.groqAPIKey,
      apiHost: 'https://api.groq.com/openai/v1',
      model: options.model,
      temperature: options.temperature,
    })
  }
}
