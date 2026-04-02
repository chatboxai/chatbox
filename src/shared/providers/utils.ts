import type { ModelInterface } from '../models/types'
import { ModelProviderType } from '../types'
import type { ModelDependencies } from '../types/adapters'
import CustomClaude from './definitions/models/custom-claude'
import CustomGemini from './definitions/models/custom-gemini'
import CustomOpenAI from './definitions/models/custom-openai'
import CustomOpenAIResponses from './definitions/models/custom-openai-responses'
import type { CreateModelConfig } from './types'

export function createCustomProviderModel(
  config: CreateModelConfig,
  customProviderType: ModelProviderType | undefined,
  dependencies: ModelDependencies
): ModelInterface {
  const { settings, providerSetting, formattedApiHost, formattedApiPath, model } = config

  switch (customProviderType) {
    case ModelProviderType.Claude:
      return new CustomClaude(
        {
          apiKey: config.effectiveApiKey || '',
          apiHost: formattedApiHost,
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )
    case ModelProviderType.Gemini:
      return new CustomGemini(
        {
          apiKey: config.effectiveApiKey || '',
          apiHost: formattedApiHost,
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )
    case ModelProviderType.OpenAIResponses:
      return new CustomOpenAIResponses(
        {
          apiKey: config.effectiveApiKey || '',
          apiHost: formattedApiHost,
          apiPath: formattedApiPath,
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
          useProxy: providerSetting.useProxy,
        },
        dependencies
      )
    case ModelProviderType.OpenAI:
    default:
      return new CustomOpenAI(
        {
          apiKey: config.effectiveApiKey || '',
          apiHost: formattedApiHost,
          apiPath: formattedApiPath,
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
          useProxy: providerSetting.useProxy,
        },
        dependencies
      )
  }
}
