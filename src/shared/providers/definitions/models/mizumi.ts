import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export default class Mizumi extends OpenAICompatible {
  public name = 'Mizumi'
  public options: Options
  constructor(options: Options, dependencies: ModelDependencies) {
    // The OpenAI-compatible endpoint contract requires the /v1 suffix; append it only when missing
    // so custom apiHost overrides (with or without /v1) work correctly.
    const trimmedApiHost = options.apiHost.replace(/\/+$/, '')
    const apiHost = trimmedApiHost.endsWith('/v1') ? trimmedApiHost : `${trimmedApiHost}/v1`
    super(
      {
        ...options,
        apiHost,
      },
      dependencies
    )
    this.options = {
      ...options,
      apiHost,
    }
  }
}
