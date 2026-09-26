import type { ModelDependencies } from '../../../types/adapters'
import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'

interface Options extends OpenAICompatibleSettings {}

export default class AtlasCloud extends OpenAICompatible {
  public name = 'AtlasCloud'

  constructor(options: Omit<Options, 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = 'https://api.atlascloud.ai/v1'
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
