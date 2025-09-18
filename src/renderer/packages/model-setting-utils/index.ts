import { SystemProviders } from 'src/shared/defaults'
import { ModelProvider, ModelProviderEnum, ProviderBaseInfo, SessionType, Settings } from 'src/shared/types'
import AzureSettingUtil from './azure-setting-util'
import ChatboxAISettingUtil from './chatboxai-setting-util'
import ChatGLMSettingUtil from './chatglm-setting-util'
import ClaudeSettingUtil from './claude-setting-util'
import CustomModelSettingUtil from './custom-setting-util'
import DeepSeekSettingUtil from './deepseek-setting-util'
import GeminiSettingUtil from './gemini-setting-util'
import GroqSettingUtil from './groq-setting-util'
import { ModelSettingUtil } from './interface'
import LMStudioSettingUtil from './lmstudio-setting-util'
import MistralAISettingUtil from './mistral-ai-setting-util'
import OllamaSettingUtil from './ollama-setting-util'
import OpenAISettingUtil from './openai-setting-util'
import OpenRouterSettingUtil from './openrouter-setting-util'
import PerplexitySettingUtil from './perplexity-setting-util'
import SiliconFlowSettingUtil from './siliconflow-setting-util'
import VolcEngineSettingUtil from './volcengine-setting-util'
import XAISettingUtil from './xai-setting-util'

export function getModelSettingUtil(aiProvider: ModelProvider): ModelSettingUtil {
  const hash: Record<ModelProvider, new () => ModelSettingUtil> = {
    [ModelProviderEnum.Azure]: AzureSettingUtil,
    [ModelProviderEnum.ChatboxAI]: ChatboxAISettingUtil,
    [ModelProviderEnum.ChatGLM6B]: ChatGLMSettingUtil,
    [ModelProviderEnum.Claude]: ClaudeSettingUtil,
    [ModelProviderEnum.Gemini]: GeminiSettingUtil,
    [ModelProviderEnum.Groq]: GroqSettingUtil,
    [ModelProviderEnum.Ollama]: OllamaSettingUtil,
    [ModelProviderEnum.OpenAI]: OpenAISettingUtil,
    [ModelProviderEnum.OpenRouter]: OpenRouterSettingUtil,
    [ModelProviderEnum.DeepSeek]: DeepSeekSettingUtil,
    [ModelProviderEnum.SiliconFlow]: SiliconFlowSettingUtil,
    [ModelProviderEnum.VolcEngine]: VolcEngineSettingUtil,
    [ModelProviderEnum.MistralAI]: MistralAISettingUtil,
    [ModelProviderEnum.LMStudio]: LMStudioSettingUtil,
    [ModelProviderEnum.Perplexity]: PerplexitySettingUtil,
    [ModelProviderEnum.XAI]: XAISettingUtil,
    [ModelProviderEnum.Custom]: CustomModelSettingUtil,
  }
  const Class = hash[aiProvider] || CustomModelSettingUtil
  return new Class()
}

export async function getModelDisplayName(settings: Settings, sessionType: SessionType) {
  const provider = settings.provider!
  const model = settings.modelId!

  const util = getModelSettingUtil(provider)
  const providerSettings = settings.providers?.[provider]
  const providerBaseInfo =
    settings.customProviders?.find((p) => p.id === provider) || SystemProviders.find((p) => p.id === provider)
  return util.getCurrentModelDisplayName(model, sessionType, providerSettings, providerBaseInfo)
}
