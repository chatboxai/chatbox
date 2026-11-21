import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export default class CrowLLM extends OpenAICompatible {
  public name = 'CrowLLM'
  public options: Options
  constructor(options: Omit<Options, 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = 'https://crowllm.com/v1'
    super(
      {
        apiKey: options.apiKey,
        apiHost,
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
      },
      dependencies
    )
    this.options = {
      ...options,
      apiHost,
    }
  }
}
