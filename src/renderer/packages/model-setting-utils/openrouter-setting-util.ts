import OpenRouter from 'src/shared/models/openrouter'
import { type ModelProvider, ModelProviderEnum, type ProviderSettings, type SessionType } from 'src/shared/types'
import { createModelDependencies } from '@/adapters'
import BaseConfig from './base-config'
import type { ModelSettingUtil } from './interface'

export default class OpenRouterSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.OpenRouter
  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    if (sessionType === 'picture') {
      return `OpenRouter API (DALL-E-3)`
    } else {
      return `OpenRouter API (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
    }
  }

  protected async listProviderModels(settings: ProviderSettings) {
    const model = settings.models?.[0] || { modelId: 'openai/gpt-4o-mini' }
    const dependencies = await createModelDependencies()
    const openrouter = new OpenRouter(
      {
        apiKey: settings.apiKey!,
        model,
        temperature: 0,
      },
      dependencies
    )
    return openrouter.listModels()
  }
}