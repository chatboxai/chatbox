import { ModelProvider, ModelProviderEnum, ProviderModelInfo, ProviderSettings, SessionType } from 'src/shared/types'
import Groq from '../models/groq'
import BaseConfig from './base-config'
import { ModelSettingUtil } from './interface'

export default class GroqSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.Groq
  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    return `Groq API (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  protected async listProviderModels(settings: ProviderSettings) {
    const model: ProviderModelInfo | undefined = settings.models?.[0]
    if (!model) {
      return []
    }
    const groq = new Groq({
      groqAPIKey: settings.apiKey!,
      model,
      temperature: 0,
    })
    return groq.listModels()
  }
}
