import { ModelProvider, ModelProviderEnum, ProviderBaseInfo, ProviderSettings, SessionType } from 'src/shared/types'
import { ModelSettingUtil } from './interface'
import BaseConfig from './base-config'

// TODO: 重新实现
export default class CustomModelSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.Custom
  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings,
    providerBaseInfo?: ProviderBaseInfo
  ): Promise<string> {
    const providerName = providerBaseInfo?.name ?? 'Custom API'
    return `${providerName} (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  protected async listProviderModels(settings: ProviderSettings) {
    return []
  }
}
