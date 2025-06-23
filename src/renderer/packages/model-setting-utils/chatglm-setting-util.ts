import { ModelProvider, ModelProviderEnum, ProviderSettings } from 'src/shared/types'
import BaseConfig from './base-config'
import { ModelSettingUtil } from './interface'

export default class ChatGLMSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.ChatGLM6B
  async getCurrentModelDisplayName(model: string): Promise<string> {
    return model
  }

  protected async listProviderModels(settings: ProviderSettings) {
    return []
  }
}
