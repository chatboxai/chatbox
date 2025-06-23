import { ModelProvider, ModelProviderEnum, ProviderSettings, SessionType } from 'src/shared/types'
import Gemini from '../models/gemini'
import BaseConfig from './base-config'
import { ModelSettingUtil } from './interface'

export default class GeminiSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.Gemini
  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    return `Gemini API (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  public getLocalOptionGroups() {
    return []
  }

  protected async listProviderModels(settings: ProviderSettings) {
    const model = settings.models?.[0]
    if (!model) {
      return []
    }
    const gemini = new Gemini({
      geminiAPIHost: settings.apiHost!,
      geminiAPIKey: settings.apiKey!,
      model,
      temperature: 0,
    })
    return gemini.listModels()
  }
}
