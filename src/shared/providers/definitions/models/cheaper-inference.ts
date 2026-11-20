import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

export const CHEAPER_INFERENCE_API_HOST = 'https://api.cheaperinference.com/v1'

const CHAT_COMPLETIONS_ENDPOINT = '/v1/chat/completions'

interface Options extends Omit<OpenAICompatibleSettings, 'apiHost'> {}

/** Shape of one entry in Cheaper Inference's GET /v1/models response. */
export interface CheaperInferenceCatalogEntry {
  id?: string
  type?: string
  endpoint?: string
  context_length?: number
  max_output_tokens?: number
  capabilities?: {
    vision?: boolean
    reasoning?: boolean
  }
}

/**
 * The gateway serves image and video models from the same catalog as chat models, so the chat model
 * list keeps only entries the chat completions endpoint can answer. Every chat model accepts the
 * OpenAI tool-calling fields; vision and reasoning are per model and the catalog states them.
 */
export function mapCheaperInferenceCatalog(entries: CheaperInferenceCatalogEntry[]): ProviderModelInfo[] {
  return entries
    .filter((entry): entry is CheaperInferenceCatalogEntry & { id: string } => {
      if (!entry?.id) return false
      if (entry.type && entry.type !== 'text') return false
      if (entry.endpoint && entry.endpoint !== CHAT_COMPLETIONS_ENDPOINT) return false
      return true
    })
    .map((entry) => {
      const capabilities: NonNullable<ProviderModelInfo['capabilities']> = ['tool_use']
      if (entry.capabilities?.reasoning) capabilities.push('reasoning')
      if (entry.capabilities?.vision) capabilities.push('vision')

      const model: ProviderModelInfo = {
        modelId: entry.id,
        type: 'chat',
        capabilities,
      }
      if (entry.context_length) model.contextWindow = entry.context_length
      if (entry.max_output_tokens) model.maxOutput = entry.max_output_tokens
      return model
    })
}

export default class CheaperInference extends OpenAICompatible {
  public name = 'Cheaper Inference'

  constructor(options: Options, dependencies: ModelDependencies) {
    super({ ...options, apiHost: CHEAPER_INFERENCE_API_HOST }, dependencies)
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const headers = { Authorization: `Bearer ${this.options.apiKey}` }
      const url = `${this.options.apiHost}/models`
      const response = this.options.customFetch
        ? await this.options.customFetch(url, { method: 'GET', headers })
        : await this.dependencies.request.apiRequest({
            url,
            method: 'GET',
            headers,
            useProxy: this.options.useProxy,
          })
      const json = (await response.json()) as { data?: CheaperInferenceCatalogEntry[] }
      if (!json?.data) {
        throw new Error(`Unexpected response from ${url}`)
      }
      return mapCheaperInferenceCatalog(json.data)
    } catch (err) {
      console.error('Failed to fetch Cheaper Inference models:', err)
      return this.options.listModelsFallback || []
    }
  }
}
