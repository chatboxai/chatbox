import OpenAI from 'src/shared/models/openai'
import { type ModelProvider, ModelProviderEnum, type ProviderSettings, type SessionType } from 'src/shared/types'
import { createModelDependencies } from '@/adapters'
import BaseConfig from './base-config'
import type { ModelSettingUtil } from './interface'

export default class NovitaAISettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.NovitaAI

  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    if (sessionType === 'picture') {
      return `Novita AI (DALL-E-3)`
    } else {
      return `Novita AI (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
    }
  }

  protected async listProviderModels(settings: ProviderSettings): Promise<string[]> {
    const model = settings.models?.[0] || { modelId: 'deepseek/deepseek-v3-0324' }
    const dependencies = await createModelDependencies()
    
    const openai = new OpenAI(
      {
        apiHost: settings.apiHost!,
        apiKey: settings.apiKey!,
        model,
        temperature: 0,
        dalleStyle: 'vivid',
        injectDefaultMetadata: false,
        useProxy: settings.useProxy || false,
      },
      dependencies
    )

    try {
      const [chatModels, embeddingModels] = await Promise.all([
        openai.listModels(),
        this.fetchEmbeddingModels(settings.apiHost!, settings.apiKey!),
      ])

      return [...chatModels, ...embeddingModels]
    } catch (error) {
      console.error('Failed to fetch Novita AI models:', error)
      return openai.listModels()
    }
  }

  private async fetchEmbeddingModels(apiHost: string, apiKey: string): Promise<string[]> {
    try {
      const response = await fetch(`${apiHost}/models?model_type=embedding`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      return data.data?.map((model: any) => model.id) || []
    } catch (error) {
      console.error('Failed to fetch embedding models:', error)
      return []
    }
  }
} 