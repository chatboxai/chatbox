import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

type Options = Omit<OpenAICompatibleSettings, 'apiHost'>

export default class ApiRoute extends OpenAICompatible {
  public name = 'API Route'

  static isSupportTextEmbedding() {
    return false
  }

  constructor(options: Options, dependencies: ModelDependencies) {
    super(
      {
        ...options,
        apiHost: 'https://global.api-route.com/v1',
      },
      dependencies
    )
  }
}
