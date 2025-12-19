import { SystemProviders } from 'src/shared/defaults'
import {
  type ModelProvider,
  ModelProviderEnum,
  ModelProviderType,
  type SessionSettings,
  type SessionType,
  type Settings,
} from 'src/shared/types'
import AzureSettingUtil from './azure-setting-util'
import ChatboxAISettingUtil from './chatboxai-setting-util'
import ChatGLMSettingUtil from './chatglm-setting-util'
import ClaudeSettingUtil from './claude-setting-util'
import CustomClaudeSettingUtil from './custom-claude-util'
import CustomGeminiSettingUtil from './custom-gemini-setting-util'
import CustomOpenAIResponsesSettingUtil from './custom-openai-responses-util'
import CustomModelSettingUtil from './custom-setting-util'
import DeepSeekSettingUtil from './deepseek-setting-util'
import GeminiSettingUtil from './gemini-setting-util'
import GroqSettingUtil from './groq-setting-util'
import type { ModelSettingUtil } from './interface'
import LMStudioSettingUtil from './lmstudio-setting-util'
import MistralAISettingUtil from './mistral-ai-setting-util'
import OllamaSettingUtil from './ollama-setting-util'
import OpenAIResponsesSettingUtil from './openai-responses-setting-util'
import OpenAISettingUtil from './openai-setting-util'
import PerplexitySettingUtil from './perplexity-setting-util'
import SiliconFlowSettingUtil from './siliconflow-setting-util'
import VolcEngineSettingUtil from './volcengine-setting-util'
import XAISettingUtil from './xai-setting-util'

export function getModelSettingUtil(
  aiProvider: ModelProvider,
  customProviderType?: ModelProviderType
): ModelSettingUtil {
  const hash: Record<ModelProvider, new () => ModelSettingUtil> = {
    [ModelProviderEnum.Azure]: AzureSettingUtil,
    [ModelProviderEnum.ChatboxAI]: ChatboxAISettingUtil,
    [ModelProviderEnum.ChatGLM6B]: ChatGLMSettingUtil,
    [ModelProviderEnum.Claude]: ClaudeSettingUtil,
    [ModelProviderEnum.Gemini]: GeminiSettingUtil,
    [ModelProviderEnum.Groq]: GroqSettingUtil,
    [ModelProviderEnum.Ollama]: OllamaSettingUtil,
    [ModelProviderEnum.OpenAI]: OpenAISettingUtil,
    [ModelProviderEnum.OpenAIResponses]: OpenAIResponsesSettingUtil,
    [ModelProviderEnum.DeepSeek]: DeepSeekSettingUtil,
    [ModelProviderEnum.SiliconFlow]: SiliconFlowSettingUtil,
    [ModelProviderEnum.VolcEngine]: VolcEngineSettingUtil,
    [ModelProviderEnum.MistralAI]: MistralAISettingUtil,
    [ModelProviderEnum.LMStudio]: LMStudioSettingUtil,
    [ModelProviderEnum.Perplexity]: PerplexitySettingUtil,
    [ModelProviderEnum.XAI]: XAISettingUtil,
    [ModelProviderEnum.Custom]: CustomModelSettingUtil,
  }

  // If provider is in hash, use the corresponding setting util
  if (hash[aiProvider]) {
    return new hash[aiProvider]()
  }

  // For custom providers, determine setting util based on type
  if (customProviderType) {
    switch (customProviderType) {
      case ModelProviderType.OpenAIResponses:
        return new CustomOpenAIResponsesSettingUtil()
      case ModelProviderType.OpenAI:
        return new CustomModelSettingUtil()
      case ModelProviderType.Claude:
        return new CustomClaudeSettingUtil()
      case ModelProviderType.Gemini:
        return new CustomGeminiSettingUtil()
      default:
        return new CustomModelSettingUtil()
    }
  }

  // Fallback to CustomModelSettingUtil
  return new CustomModelSettingUtil()
}

export function getModelDisplayName(settings: SessionSettings, globalSettings: Settings, sessionType: SessionType) {
  const provider = settings.provider ?? ModelProviderEnum.ChatboxAI
  const model = settings.modelId ?? ''

  const providerBaseInfo =
    globalSettings.customProviders?.find((p) => p.id === provider) || SystemProviders.find((p) => p.id === provider)

  const util = getModelSettingUtil(provider, providerBaseInfo?.isCustom ? providerBaseInfo.type : undefined)
  const providerSettings = globalSettings.providers?.[provider]
  return util.getCurrentModelDisplayName(model, sessionType, providerSettings, providerBaseInfo)
}
