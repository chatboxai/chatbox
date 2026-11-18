import { ApiError } from '../../../models/errors'
import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export interface WallyListedModel {
  id: string
  name?: string
  context_length?: number
  max_output_tokens?: number
  input_modalities?: string[]
  supported_features?: string[]
}

// Wally's /models response carries capabilities as top-level fields, which the
// OpenRouter-shaped parser in fetchRemoteModels() does not read.
export function toWallyModelInfo(item: WallyListedModel): ProviderModelInfo {
  const capabilities: NonNullable<ProviderModelInfo['capabilities']> = []
  if (item.input_modalities?.includes('image')) capabilities.push('vision')
  if (item.supported_features?.includes('reasoning')) capabilities.push('reasoning')
  if (item.supported_features?.includes('tools')) capabilities.push('tool_use')

  return {
    modelId: item.id,
    type: 'chat',
    ...(item.name ? { nickname: item.name } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(item.context_length ? { contextWindow: item.context_length } : {}),
    ...(item.max_output_tokens ? { maxOutput: item.max_output_tokens } : {}),
  }
}

export default class Wally extends OpenAICompatible {
  public name = 'Wally'
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
    this.options = options
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const response = await this.dependencies.request.apiRequest({
        url: `${this.options.apiHost}/models`,
        method: 'GET',
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        useProxy: this.options.useProxy,
      })
      const json: { data?: WallyListedModel[] } = await response.json()
      if (!json.data) {
        throw new ApiError(JSON.stringify(json))
      }
      return json.data.map(toWallyModelInfo)
    } catch (err) {
      console.error(err)
      return []
    }
  }
}
