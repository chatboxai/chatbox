import { OpenAICompatible } from './openai-compatible'

export class ChinaLLM extends OpenAICompatible {
  name = 'ChinaLLM'

  constructor(apiKey: string, apiHost: string) {
    super(apiKey, apiHost)
  }
}
