import CustomOpenAIResponses from 'src/shared/models/custom-openai-responses'
import type { ProviderSettings } from 'src/shared/types'
import { createModelDependencies } from '@/adapters'
import CustomModelSettingUtil from './custom-setting-util'

export default class CustomOpenAIResponsesSettingUtil extends CustomModelSettingUtil {
  protected async listProviderModels(settings: ProviderSettings) {
    const model = settings.models?.[0] || { modelId: 'gpt-4o-mini' }

    const dependencies = await createModelDependencies()
    const customOpenAIResponses = new CustomOpenAIResponses(
      {
        apiHost: settings.apiHost || '',
        apiKey: settings.apiKey || '',
        apiPath: settings.apiPath || '',
        model,
        temperature: 0,
        useProxy: settings.useProxy,
      },
      dependencies
    )
    return customOpenAIResponses.listModels()
  }
}
