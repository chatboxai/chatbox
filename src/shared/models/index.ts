import { SystemProviders } from '../defaults'
import {
  type Config,
  type ModelProvider,
  ModelProviderEnum,
  ModelProviderType,
  type SessionSettings,
  type Settings,
} from '../types'
import type { ModelDependencies } from '../types/adapters'
import AzureOpenAI from './azure'
import ChatboxAI from './chatboxai'
import ChatGLM from './chatglm'
import Claude from './claude'
import CustomClaude from './custom-claude'
import CustomGemini from './custom-gemini'
import CustomOpenAI from './custom-openai'
import CustomOpenAIResponses from './custom-openai-responses'
import DeepSeek from './deepseek'
import Gemini from './gemini'
import Groq from './groq'
import LMStudio from './lmstudio'
import MistralAI from './mistral-ai'
import Ollama from './ollama'
import OpenAI from './openai'
import OpenRouter from './openrouter'
import Perplexity from './perplexity'
import SiliconFlow from './siliconflow'
import type { ModelInterface } from './types'
import VolcEngine from './volcengine'
import XAI from './xai'

export function getProviderSettings(setting: SessionSettings, globalSettings: Settings) {
  console.debug('getModel', setting.provider, setting.modelId)
  const provider = setting.provider
  if (!provider) {
    throw new Error('Model provider must not be empty.')
  }
  const providerBaseInfo = [...SystemProviders, ...(globalSettings.customProviders || [])].find(
    (p) => p.id === provider
  )
  if (!providerBaseInfo) {
    throw new Error(`Cannot find model with provider: ${setting.provider}`)
  }
  const providerSetting = globalSettings.providers?.[provider] || {}
  const formattedApiHost = (providerSetting.apiHost || providerBaseInfo.defaultSettings?.apiHost || '').trim()
  return {
    providerSetting,
    formattedApiHost,
    providerBaseInfo,
  }
}

export function getModel(
  settings: SessionSettings,
  globalSettings: Settings,
  config: Config,
  dependencies: ModelDependencies
): ModelInterface {
  console.debug('getModel', settings.provider, settings.modelId)
  const provider = settings.provider
  if (!provider) {
    throw new Error('Model provider must not be empty.')
  }
  const { providerSetting, formattedApiHost, providerBaseInfo } = getProviderSettings(settings, globalSettings)

  let model = providerSetting.models?.find((m) => m.modelId === settings.modelId)
  if (!model) {
    model = SystemProviders.find((p) => p.id === provider)?.defaultSettings?.models?.find(
      (m) => m.modelId === settings.modelId
    )
  }
  if (!model) {
    // 如果没有找到对应的 model 配置，直接使用传入的 modelId，这种情况通常发生在用户本地列表中删除了某个 model，但是某个 session 中还在使用，或是检查连接的时候，使用了 defaults 中的 modelId，
    model = {
      modelId: settings.modelId ?? '',
    }
  }

  switch (provider) {
    case ModelProviderEnum.ChatboxAI:
      return new ChatboxAI(
        {
          licenseKey: globalSettings.licenseKey,
          model,
          licenseInstances: globalSettings.licenseInstances,
          licenseDetail: globalSettings.licenseDetail,
          language: globalSettings.language,
          dalleStyle: settings.dalleStyle || 'vivid',
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        config,
        dependencies
      )
    case ModelProviderEnum.OpenAI:
      return new OpenAI(
        {
          apiKey: providerSetting.apiKey || '',
          apiHost: formattedApiHost,
          model: model,
          dalleStyle: settings.dalleStyle || 'vivid',
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          injectDefaultMetadata: globalSettings.injectDefaultMetadata,
          useProxy: false, // 之前的openaiUseProxy已经没有在使用，直接写死false
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.Azure:
      return new AzureOpenAI(
        {
          azureEndpoint: providerSetting.endpoint || providerBaseInfo.defaultSettings?.endpoint || '',
          model,
          azureDalleDeploymentName: providerSetting.dalleDeploymentName || '',
          azureApikey: providerSetting.apiKey || '',
          azureApiVersion: providerSetting.apiVersion || providerBaseInfo.defaultSettings?.apiVersion || '',
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          dalleStyle: settings.dalleStyle || 'vivid',
          imageGenerateNum: settings.imageGenerateNum || 1,
          injectDefaultMetadata: globalSettings.injectDefaultMetadata,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.ChatGLM6B:
      return new ChatGLM(
        {
          apiKey: providerSetting.apiKey || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.Claude:
      return new Claude(
        {
          claudeApiKey: providerSetting.apiKey || '',
          claudeApiHost: formattedApiHost,
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.Gemini:
      return new Gemini(
        {
          geminiAPIKey: providerSetting.apiKey || '',
          geminiAPIHost: formattedApiHost,
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.Ollama:
      return new Ollama(
        {
          ollamaHost: formattedApiHost,
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
          useProxy: providerSetting.useProxy,
        },
        dependencies
      )

    case ModelProviderEnum.Groq:
      return new Groq(
        {
          apiKey: providerSetting.apiKey || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.DeepSeek:
      return new DeepSeek(
        {
          apiKey: providerSetting.apiKey || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.SiliconFlow:
      return new SiliconFlow(
        {
          apiKey: providerSetting.apiKey || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.OpenRouter:
      return new OpenRouter(
        {
          apiKey: providerSetting.apiKey || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.VolcEngine:
      return new VolcEngine(
        {
          apiKey: providerSetting.apiKey || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.MistralAI:
      return new MistralAI(
        {
          apiKey: providerSetting.apiKey || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.LMStudio:
      return new LMStudio(
        {
          apiHost: formattedApiHost,
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.Perplexity:
      return new Perplexity(
        {
          perplexityApiKey: providerSetting.apiKey || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )

    case ModelProviderEnum.XAI:
      return new XAI(
        {
          apiKey: providerSetting.apiKey || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
        },
        dependencies
      )
    case ModelProviderEnum.OpenAIResponses:
      return new CustomOpenAIResponses(
        {
          apiKey: providerSetting.apiKey || '',
          apiHost: formattedApiHost,
          apiPath: providerSetting.apiPath || providerBaseInfo.defaultSettings?.apiPath || '',
          model,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens,
          stream: settings.stream,
          useProxy: providerSetting.useProxy,
        },
        dependencies
      )
    default:
      if (providerBaseInfo.isCustom) {
        switch (providerBaseInfo.type) {
          case ModelProviderType.Claude:
            return new CustomClaude(
              {
                apiKey: providerSetting.apiKey || '',
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
                apiKey: providerSetting.apiKey || '',
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
                apiKey: providerSetting.apiKey || '',
                apiHost: formattedApiHost,
                apiPath: providerSetting.apiPath || '',
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
                apiKey: providerSetting.apiKey || '',
                apiHost: formattedApiHost,
                apiPath: providerSetting.apiPath || '',
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
      } else {
        throw new Error(`Cannot find model with provider: ${settings.provider}`)
      }
  }
}

export const aiProviderNameHash: Record<ModelProvider, string> = {
  [ModelProviderEnum.OpenAI]: 'OpenAI API',
  [ModelProviderEnum.OpenAIResponses]: 'OpenAI Responses API',
  [ModelProviderEnum.Azure]: 'Azure OpenAI API',
  [ModelProviderEnum.ChatGLM6B]: 'ChatGLM API',
  [ModelProviderEnum.ChatboxAI]: 'Chatbox AI',
  [ModelProviderEnum.Claude]: 'Claude API',
  [ModelProviderEnum.Gemini]: 'Google Gemini API',
  [ModelProviderEnum.Ollama]: 'Ollama API',
  [ModelProviderEnum.Groq]: 'Groq API',
  [ModelProviderEnum.DeepSeek]: 'DeepSeek API',
  [ModelProviderEnum.SiliconFlow]: 'SiliconFlow API',
  [ModelProviderEnum.VolcEngine]: 'VolcEngine API',
  [ModelProviderEnum.MistralAI]: 'MistralAI',
  [ModelProviderEnum.LMStudio]: 'LM Studio API',
  [ModelProviderEnum.Perplexity]: 'Perplexity API',
  [ModelProviderEnum.XAI]: 'xAI API',
  [ModelProviderEnum.OpenRouter]: 'OpenRouter API',
  [ModelProviderEnum.Custom]: 'Custom Provider',
}

export const AIModelProviderMenuOptionList = [
  {
    value: ModelProviderEnum.ChatboxAI,
    label: aiProviderNameHash[ModelProviderEnum.ChatboxAI],
    featured: true,
    disabled: false,
  },
  {
    value: ModelProviderEnum.OpenAI,
    label: aiProviderNameHash[ModelProviderEnum.OpenAI],
    disabled: false,
  },
  {
    value: ModelProviderEnum.OpenAIResponses,
    label: aiProviderNameHash[ModelProviderEnum.OpenAIResponses],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Claude,
    label: aiProviderNameHash[ModelProviderEnum.Claude],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Gemini,
    label: aiProviderNameHash[ModelProviderEnum.Gemini],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Ollama,
    label: aiProviderNameHash[ModelProviderEnum.Ollama],
    disabled: false,
  },
  {
    value: ModelProviderEnum.LMStudio,
    label: aiProviderNameHash[ModelProviderEnum.LMStudio],
    disabled: false,
  },
  {
    value: ModelProviderEnum.DeepSeek,
    label: aiProviderNameHash[ModelProviderEnum.DeepSeek],
    disabled: false,
  },
  {
    value: ModelProviderEnum.SiliconFlow,
    label: aiProviderNameHash[ModelProviderEnum.SiliconFlow],
    disabled: false,
  },
  {
    value: ModelProviderEnum.OpenRouter,
    label: aiProviderNameHash[ModelProviderEnum.OpenRouter],
    disabled: false,
  },
  {
    value: ModelProviderEnum.MistralAI,
    label: aiProviderNameHash[ModelProviderEnum.MistralAI],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Azure,
    label: aiProviderNameHash[ModelProviderEnum.Azure],
    disabled: false,
  },
  {
    value: ModelProviderEnum.XAI,
    label: aiProviderNameHash[ModelProviderEnum.XAI],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Perplexity,
    label: aiProviderNameHash[ModelProviderEnum.Perplexity],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Groq,
    label: aiProviderNameHash[ModelProviderEnum.Groq],
    disabled: false,
  },
  {
    value: ModelProviderEnum.ChatGLM6B,
    label: aiProviderNameHash[ModelProviderEnum.ChatGLM6B],
    disabled: false,
  },
  // {
  //     value: 'hunyuan',
  //     label: '腾讯混元',
  //     disabled: true,
  // },
]
