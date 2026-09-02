import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import AzureOpenAI from './models/azure'

export const azureProvider = defineProvider({
  id: ModelProviderEnum.Azure,
  name: 'Azure OpenAI',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://azure.microsoft.com/products/ai-services/openai-service',
    docs: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
  },
  defaultSettings: {
    endpoint: 'https://<resource_name>.openai.azure.com',
    apiVersion: 'v1',
  },
  createModel: (config) => {
    return new AzureOpenAI(
      {
        azureEndpoint: config.providerSetting.endpoint || config.providerSetting.apiHost || '',
        model: config.model,
        azureDalleDeploymentName: config.providerSetting.dalleDeploymentName || '',
        azureApikey: config.effectiveApiKey,
        azureApiVersion: config.providerSetting.apiVersion || 'v1',
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        dalleStyle: config.settings.dalleStyle || 'vivid',
        imageGenerateNum: config.settings.imageGenerateNum || 1,
        injectDefaultMetadata: config.globalSettings.injectDefaultMetadata,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings, sessionType) => {
    if (sessionType === 'picture') {
      return `Azure OpenAI API (${modelId})`
    }
    return `Azure OpenAI API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
