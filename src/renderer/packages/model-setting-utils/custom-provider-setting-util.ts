import CustomClaude from '@shared/providers/definitions/models/custom-claude'
import CustomGemini from '@shared/providers/definitions/models/custom-gemini'
import CustomOpenAI from '@shared/providers/definitions/models/custom-openai'
import CustomOpenAIResponses from '@shared/providers/definitions/models/custom-openai-responses'
import {
  type ModelProvider,
  ModelProviderType,
  type ProviderBaseInfo,
  type ProviderModelInfo,
  type ProviderSettings,
  type SessionType,
} from '@shared/types'
import { getLangSmithErrorMessage } from '@shared/utils/langsmith_adapter'
import { createModelDependencies } from '@/adapters'
import BaseConfig from './base-config'
import type { ModelSettingUtil } from './interface'

/**
 * Unified setting util for all custom providers.
 * Handles OpenAI, Claude, Gemini, and OpenAIResponses custom provider types.
 */
export default class CustomProviderSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider
  private customProviderType: ModelProviderType

  constructor(provider: ModelProvider, customProviderType?: ModelProviderType) {
    super()
    this.provider = provider
    this.customProviderType = customProviderType || ModelProviderType.OpenAI
  }

  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings,
    providerBaseInfo?: ProviderBaseInfo
  ): Promise<string> {
    const providerName = providerBaseInfo?.name ?? this.getDefaultProviderName()
    const nickname = providerSettings?.models?.find((m) => m.modelId === model)?.nickname
    return `${providerName} (${nickname || model})`
  }

  private getDefaultProviderName(): string {
    switch (this.customProviderType) {
      case ModelProviderType.Claude:
        return 'Custom Claude'
      case ModelProviderType.Gemini:
        return 'Custom Gemini'
      case ModelProviderType.OpenAIResponses:
        return 'Custom OpenAI Responses'
      case ModelProviderType.OpenAI:
      default:
        return 'Custom API'
    }
  }

  private getDefaultModelId(): string {
    switch (this.customProviderType) {
      case ModelProviderType.Claude:
        return 'claude-3-5-sonnet-20241022'
      case ModelProviderType.Gemini:
        return 'gemini-2.0-flash-exp'
      case ModelProviderType.OpenAIResponses:
      case ModelProviderType.OpenAI:
      default:
        return 'gpt-4o-mini'
    }
  }

  protected async listProviderModels(settings: ProviderSettings): Promise<ProviderModelInfo[]> {
    const model = settings.models?.[0] || { modelId: this.getDefaultModelId() }
    const dependencies = await createModelDependencies()
    const traceRun = await dependencies.langsmith.startRun({
      name: 'chatbox.settings.provider_models.list',
      runType: 'chain',
      inputs: {
        provider: this.provider,
        modelId: model.modelId,
        source: 'custom',
        customProviderType: this.customProviderType,
      },
      metadata: {
        operation: 'listProviderModels',
      },
      tags: ['chatbox', 'renderer', 'settings', 'models'],
    })

    try {
      let models: ProviderModelInfo[]
      switch (this.customProviderType) {
        case ModelProviderType.Claude: {
          const customClaude = new CustomClaude(
            {
              apiHost: settings.apiHost!,
              apiKey: settings.apiKey!,
              model,
              temperature: 0,
            },
            dependencies
          )
          models = await customClaude.listModels()
          break
        }
        case ModelProviderType.Gemini: {
          const customGemini = new CustomGemini(
            {
              apiHost: settings.apiHost!,
              apiKey: settings.apiKey!,
              model,
              temperature: 0,
            },
            dependencies
          )
          models = await customGemini.listModels()
          break
        }
        case ModelProviderType.OpenAIResponses: {
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
          models = await customOpenAIResponses.listModels()
          break
        }
        case ModelProviderType.OpenAI:
        default: {
          const customOpenAI = new CustomOpenAI(
            {
              apiHost: settings.apiHost!,
              apiKey: settings.apiKey!,
              apiPath: settings.apiPath!,
              model,
              temperature: 0,
              useProxy: settings.useProxy,
            },
            dependencies
          )
          models = await customOpenAI.listModels()
          break
        }
      }

      await traceRun.end({
        outputs: {
          modelCount: models.length,
          status: 'success',
        },
      })
      return models
    } catch (error) {
      await traceRun.end({
        error: getLangSmithErrorMessage(error),
      })
      throw error
    }
  }
}
