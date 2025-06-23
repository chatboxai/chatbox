import { ModelProvider, ModelProviderEnum, ProviderSettings, SessionType } from 'src/shared/types'
import SiliconFlow from '../models/siliconflow'
import BaseConfig from './base-config'
import { ModelSettingUtil } from './interface'

export default class SiliconFlowSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.SiliconFlow
  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    return `SiliconFlow API (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  protected async listProviderModels(settings: ProviderSettings) {
    const siliconFlow = new SiliconFlow({
      siliconCloudKey: settings.apiKey!,
      model: {
        modelId: '',
        capabilities: [],
      },
    })
    return siliconFlow.listModels()
  }
}
