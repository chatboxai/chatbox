import { ProviderModelInfo } from 'src/shared/types'
import OpenAICompatible from './openai-compatible'

interface Options {
  chatglmApiKey: string
  model: ProviderModelInfo
}

export default class ChatGLM extends OpenAICompatible {
  public name = 'ChatGLM'

  constructor(public options: Options) {
    super({
      apiKey: options.chatglmApiKey,
      apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
      model: options.model,
    })
  }

  public async listModels() {
    return []
  }
}
