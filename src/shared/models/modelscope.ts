import type { ModelDependencies } from '../types/adapters'
import OpenAICompatible, { type OpenAICompatibleSettings } from './openai-compatible'

interface Options extends OpenAICompatibleSettings {}

export default class ModelScope extends OpenAICompatible {
  public name = 'ModelScope'
  public options: Options
  constructor(options: Omit<Options, 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = 'https://api-inference.modelscope.cn/v1'
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
