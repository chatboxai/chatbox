import { ModelProvider, ModelProviderEnum, ProviderSettings, SessionType } from 'src/shared/types'
import { createModelDependencies } from '@/adapters'
import MistralAI from 'src/shared/models/mistral-ai'
import BaseConfig from './base-config'
import { ModelSettingUtil } from './interface'

export default class MistralAISettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.MistralAI
  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    return `MistralAI (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  protected async listProviderModels(settings: ProviderSettings) {
    const model = settings.models?.[0] || { modelId: 'mistral-large-latest', capabilities: [] }
    const dependencies = await createModelDependencies()
    const mistral = new MistralAI(
      {
        apiKey: settings.apiKey!,
        model,
        temperature: 0,
      },
      dependencies
    )
    return mistral.listModels()
  }
}
