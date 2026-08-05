import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'

interface Options extends OpenAICompatibleSettings {}

export default class LMStudio extends OpenAICompatible {
  public name = 'LM Studio'
  public options: Options

  constructor(options: Omit<Options, 'apiKey'>, dependencies: ModelDependencies) {
    const apiHost = normalizeOpenAIApiHostAndPath({ apiHost: options.apiHost }).apiHost
    super(
      {
        apiKey: '',
        apiHost,
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
        useProxy: options.useProxy,
      },
      dependencies
    )
    this.options = {
      ...options,
      apiKey: '',
      apiHost,
    }
  }
}
