import { ModelProvider, ModelProviderEnum, ProviderSettings, SessionType } from 'src/shared/types'
import DeepSeek from '../models/deepseek'
import BaseConfig from './base-config'
import { ModelSettingUtil } from './interface'

export default class DeepSeekSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.DeepSeek
  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    return `DeepSeek API (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  protected async listProviderModels(settings: ProviderSettings) {
    const deepSeek = new DeepSeek({
      deepseekAPIKey: settings.apiKey!,
      model: {
        modelId: '',
        capabilities: [],
      },
    })
    return deepSeek.listModels()
  }
}
