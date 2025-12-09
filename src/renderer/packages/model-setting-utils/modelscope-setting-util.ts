import ModelScope from 'src/shared/models/modelscope'
import { type ModelProvider, ModelProviderEnum, type ProviderSettings, type SessionType } from 'src/shared/types'
import { createModelDependencies } from '@/adapters'
import BaseConfig from './base-config'
import type { ModelSettingUtil } from './interface'

export default class ModelScopeSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.ModelScope
  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    return `ModelScope API (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  protected async listProviderModels(settings: ProviderSettings) {
    const dependencies = await createModelDependencies()
    const modelscope = new ModelScope({ apiKey: settings.apiKey!, model: { modelId: '', capabilities: [] } }, dependencies)
    return modelscope.listModels()
  }
}
