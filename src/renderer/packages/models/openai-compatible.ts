import { apiRequest, fetchWithProxy } from '@/utils/request'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import AbstractAISDKModel from './abstract-ai-sdk'
import { ApiError } from './errors'
import { ModelInterface } from './types'
import { ProviderModelInfo } from 'src/shared/types'

interface OpenAICompatibleSettings {
  apiKey: string
  apiHost: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  useProxy?: boolean
}

export default abstract class OpenAICompatible extends AbstractAISDKModel implements ModelInterface {
  public name = 'OpenAI Compatible'

  constructor(private settings: OpenAICompatibleSettings) {
    super(settings)
  }

  protected getCallSettings() {
    return {
      temperature: this.settings.temperature,
      topP: this.settings.topP,
    }
  }

  protected getChatModel() {
    const provider = createOpenAICompatible({
      name: this.name,
      apiKey: this.settings.apiKey,
      baseURL: this.settings.apiHost,
      fetch: this.settings.useProxy ? fetchWithProxy : undefined,
    })
    return provider.languageModel(this.settings.model.modelId)
  }

  public async listModels(): Promise<string[]> {
    return fetchRemoteModels({
      apiHost: this.settings.apiHost,
      apiKey: this.settings.apiKey,
      useProxy: this.settings.useProxy,
    }).catch((err) => {
      console.error(err)
      return []
    })
  }
}

interface ListModelsResponse {
  object: 'list'
  data: {
    id: string
    object: 'model'
    created: number
    owned_by: string
  }[]
}

export async function fetchRemoteModels(params: { apiHost: string; apiKey: string; useProxy?: boolean }) {
  const response = await apiRequest.get(
    `${params.apiHost}/models`,
    {
      Authorization: `Bearer ${params.apiKey}`,
    },
    {
      useProxy: params.useProxy,
    }
  )
  const json: ListModelsResponse = await response.json()
  if (!json.data) {
    throw new ApiError(JSON.stringify(json))
  }
  return json.data.map((item) => item.id)
}
