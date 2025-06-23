import OpenAICompatible from './openai-compatible'
import { normalizeOpenAIApiHostAndPath } from './llm_utils'
import { ProviderModelInfo } from 'src/shared/types'

interface Options {
  lmStudioHost: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
}

export default class LMStudio extends OpenAICompatible {
  public name = 'LM Studio'

  constructor(public options: Options) {
    super({
      apiKey: '',
      apiHost: normalizeOpenAIApiHostAndPath({ apiHost: options.lmStudioHost }).apiHost,
      model: options.model,
      temperature: options.temperature,
      topP: options.topP,
    })
  }
}
