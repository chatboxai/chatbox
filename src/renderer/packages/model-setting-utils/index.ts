import { ModelProvider, SessionType, Settings } from 'src/shared/types'
import { ModelSettingUtil } from './interface'
import AzureSettingUtil from './azure-setting-util'
import ChatGLMSettingUtil from './chatglm-setting-util'
import ChatboxAISettingUtil from './chatboxai-setting-util'
import ClaudeSettingUtil from './claude-setting-util'
import GeminiSettingUtil from './gemini-setting-util'
import GroqSettingUtil from './groq-setting-util'
import LMStudioSettingUtil from './lmstudio-setting-util'
import OllamaSettingUtil from './ollama-setting-util'
import OpenAISettingUtil from './openai-setting-util'
import PerplexitySettingUtil from './perplexity-setting-util'
import CustomModelSettingUtil from './custom-setting-util'
import DeepSeekSettingUtil from './deepseek-setting-util'
import SiliconFlowSettingUtil from './siliconflow-setting-util'
import XAISettingUtil from './xai-setting-util'
import BurnCloudSettingUtil from './burncloud-setting-util'

export function getModelSettingUtil(aiProvider: ModelProvider): ModelSettingUtil {
  const hash: Record<ModelProvider, new () => ModelSettingUtil> = {
    [ModelProvider.Azure]: AzureSettingUtil,
    [ModelProvider.ChatboxAI]: ChatboxAISettingUtil,
    [ModelProvider.ChatGLM6B]: ChatGLMSettingUtil,
    [ModelProvider.Claude]: ClaudeSettingUtil,
    [ModelProvider.Gemini]: GeminiSettingUtil,
    [ModelProvider.Groq]: GroqSettingUtil,
    [ModelProvider.Ollama]: OllamaSettingUtil,
    [ModelProvider.OpenAI]: OpenAISettingUtil,
    [ModelProvider.DeepSeek]: DeepSeekSettingUtil,
    [ModelProvider.SiliconFlow]: SiliconFlowSettingUtil,
    [ModelProvider.LMStudio]: LMStudioSettingUtil,
    [ModelProvider.Perplexity]: PerplexitySettingUtil,
    [ModelProvider.XAI]: XAISettingUtil,
    [ModelProvider.Custom]: CustomModelSettingUtil,
    [ModelProvider.BurnCloud]: BurnCloudSettingUtil,
  }
  const Class = hash[aiProvider] || CustomModelSettingUtil
  return new Class()
}

export async function getModelDisplayName(
  provider: ModelProvider,
  model: string,
  providers: Settings['providers'],
  sessionType: SessionType
) {
  const util = getModelSettingUtil(provider)
  return util.getCurrentModelDisplayName(model, sessionType, providers?.[provider])
}

export function isModelSupportToolUse(provider: ModelProvider, model: string): boolean {
  const util = getModelSettingUtil(provider)
  return util.isCurrentModelSupportToolUse(model)
}
