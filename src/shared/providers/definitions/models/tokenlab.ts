import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export default class TokenLab extends OpenAICompatible {
  public name = 'TokenLab'

  constructor(options: Omit<Options, 'apiHost'>, dependencies: ModelDependencies) {
    super(
      {
        apiKey: options.apiKey,
        apiHost: 'https://api.tokenlab.sh/v1',
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
      },
      dependencies
    )
  }
}
