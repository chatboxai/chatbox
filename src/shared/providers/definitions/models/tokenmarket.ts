import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

type Options = Omit<OpenAICompatibleSettings, 'apiHost'>

export default class TokenMarket extends OpenAICompatible {
  public name = 'Token Market'

  /**
   * Indicates whether Token Market supports text embedding models.
   */
  static isSupportTextEmbedding() {
    return false
  }

  constructor(options: Options, dependencies: ModelDependencies) {
    super(
      {
        ...options,
        apiHost: 'https://api.tokensmarket.ai/v1',
      },
      dependencies
    )
  }
}
