import OpenAICompatible from '../../../models/openai-compatible'
import type { ProviderModelInfo } from '../../../types'

interface TopxAIModel {
  id: string
  supported_endpoint_types: string[]
}

export default class TopxAI extends OpenAICompatible {
  public name = 'TopxAI'

  public async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const response = await this.dependencies.request.apiRequest({
        url: `${this.options.apiHost}/models`,
        method: 'GET',
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        useProxy: this.options.useProxy,
      })
      const { data } = await response.json()
      if (!response.ok || !Array.isArray(data)) return []

      return data
        .filter(({ supported_endpoint_types: endpoints }: TopxAIModel) => {
          // Image generators also accept the chat wire format, but produce images.
          return endpoints?.includes('openai') && !endpoints.includes('image-generation')
        })
        .map(({ id }: TopxAIModel) => ({ modelId: id, type: 'chat' }))
    } catch (error) {
      console.error(error)
      return []
    }
  }
}
