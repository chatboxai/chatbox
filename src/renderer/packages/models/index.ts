import OpenAI from './openai'
import { Settings, Config, ModelProvider } from '@/../shared/types'
import ChatboxAI from './chatboxai'
import AzureOpenAI from './azure'
import ChatGLM from './chatglm'
import Claude from './claude'
import Gemini from './gemini'
import Ollama from './ollama'
import LMStudio from './lmstudio'
import Groq from './groq'
import DeepSeek from './deepseek'
import SiliconFlow from './siliconflow'
import Perplexity from './perplexity'
import XAI from './xai'
import BurnCloud from './burncloud'
import type { ModelInterface } from './types'
import CustomOpenAI from './custom-openai'
import { SystemProviders } from 'src/shared/defaults'

export function getModel(setting: Settings, config: Config): ModelInterface {
  const provider = setting.provider
  if (!provider) {
    throw new Error('Model provider must not be empty.')
  }
  const providerBaseInfo = [...SystemProviders, ...(setting.customProviders || [])].find((p) => p.id === provider)
  if (!providerBaseInfo) {
    throw new Error('Cannot find model with provider: ' + setting.provider)
  }
  const providerSetting = setting.providers?.[setting.provider!] || {}

  const formattedApiHost = (providerSetting.apiHost || providerBaseInfo.defaultSettings?.apiHost || '').trim()

  switch (provider) {
    case ModelProvider.ChatboxAI:
      return new ChatboxAI(
        {
          licenseKey: setting.licenseKey,
          chatboxAIModel: setting.modelId!,
          licenseInstances: setting.licenseInstances,
          licenseDetail: setting.licenseDetail,
          language: setting.language,
          dalleStyle: setting.dalleStyle || 'vivid',
          temperature: setting.temperature!,
        },
        config
      )
    case ModelProvider.OpenAI:
      return new OpenAI({
        apiKey: providerSetting.apiKey || '',
        apiHost: formattedApiHost,
        model: setting.modelId!,
        dalleStyle: setting.dalleStyle || 'vivid',
        temperature: setting.temperature!,
        topP: setting.topP,
        injectDefaultMetadata: setting.injectDefaultMetadata,
        useProxy: false, // 之前的openaiUseProxy已经没有在使用，直接写死false
      })

    case ModelProvider.Azure:
      return new AzureOpenAI({
        azureEndpoint: providerSetting.endpoint || providerBaseInfo.defaultSettings?.endpoint || '',
        azureDeploymentName: setting.modelId || '',
        azureDalleDeploymentName: providerSetting.dalleDeploymentName || '',
        azureApikey: providerSetting.apiKey || '',
        azureApiVersion: providerSetting.apiVersion || providerBaseInfo.defaultSettings?.apiVersion || '',
        temperature: setting.temperature!,
        topP: setting.topP || 0,
        dalleStyle: setting.dalleStyle || 'vivid',
        imageGenerateNum: setting.imageGenerateNum || 1,
        injectDefaultMetadata: setting.injectDefaultMetadata,
      })

    case ModelProvider.ChatGLM6B:
      return new ChatGLM({
        chatglmApiKey: providerSetting.apiKey || '',
        chatglmModel: setting.modelId || '',
      })

    case ModelProvider.Claude:
      return new Claude({
        claudeApiKey: providerSetting.apiKey || '',
        claudeApiHost: formattedApiHost,
        claudeModel: setting.modelId || '',
      })

    case ModelProvider.Gemini:
      return new Gemini({
        geminiAPIKey: providerSetting.apiKey || '',
        geminiAPIHost: formattedApiHost,
        geminiModel: setting.modelId || ('' as any),
        temperature: setting.temperature!,
      })

    case ModelProvider.Ollama:
      return new Ollama({
        ollamaHost: formattedApiHost,
        ollamaModel: setting.modelId || '',
        temperature: setting.temperature!,
      })

    case ModelProvider.Groq:
      return new Groq({
        groqAPIKey: providerSetting.apiKey || '',
        groqModel: setting.modelId || '',
        temperature: setting.temperature!,
      })

    case ModelProvider.DeepSeek:
      return new DeepSeek({
        deepseekAPIKey: providerSetting.apiKey || '',
        deepseekModel: setting.modelId || '',
        temperature: setting.temperature,
        topP: setting.topP,
      })

    case ModelProvider.SiliconFlow:
      return new SiliconFlow({
        siliconCloudKey: providerSetting.apiKey || '',
        siliconCloudModel: setting.modelId || '',
        temperature: setting.temperature,
        topP: setting.topP,
      })

    case ModelProvider.LMStudio:
      return new LMStudio({
        lmStudioHost: formattedApiHost,
        lmStudioModel: setting.modelId || '',
        temperature: setting.temperature,
        topP: setting.topP,
      })

    case ModelProvider.Perplexity:
      return new Perplexity({
        perplexityApiKey: providerSetting.apiKey || '',
        perplexityModel: setting.modelId || '',
        temperature: setting.temperature,
        topP: setting.topP,
      })

    case ModelProvider.XAI:
      return new XAI({
        xAIKey: providerSetting.apiKey || '',
        xAIModel: setting.modelId || '',
        temperature: setting.temperature,
        topP: setting.topP,
      })

    case ModelProvider.BurnCloud:
      return new BurnCloud({
        apiKey: providerSetting.apiKey || '',
        apiHost: formattedApiHost,
        model: setting.modelId || '',
        temperature: setting.temperature,
        topP: setting.topP,
        useProxy: providerSetting.useProxy,
      })

    default:
      if (providerBaseInfo.isCustom) {
        return new CustomOpenAI({
          apiKey: providerSetting.apiKey || '',
          apiHost: formattedApiHost,
          apiPath: providerSetting.apiPath || '',
          model: setting.modelId || '',
          temperature: setting.temperature,
          topP: setting.topP,
          useProxy: providerSetting.useProxy,
        })
      } else {
        throw new Error('Cannot find model with provider: ' + setting.provider)
      }
  }
}

export const aiProviderNameHash: Record<ModelProvider, string> = {
  [ModelProvider.OpenAI]: 'OpenAI API',
  [ModelProvider.Azure]: 'Azure OpenAI API',
  [ModelProvider.ChatGLM6B]: 'ChatGLM API',
  [ModelProvider.ChatboxAI]: 'Chatbox AI',
  [ModelProvider.Claude]: 'Claude API',
  [ModelProvider.Gemini]: 'Google Gemini API',
  [ModelProvider.Ollama]: 'Ollama API',
  [ModelProvider.Groq]: 'Groq API',
  [ModelProvider.DeepSeek]: 'DeepSeek API',
  [ModelProvider.SiliconFlow]: 'SiliconFlow API',
  [ModelProvider.LMStudio]: 'LM Studio API',
  [ModelProvider.Perplexity]: 'Perplexity API',
  [ModelProvider.XAI]: 'xAI API',
  [ModelProvider.BurnCloud]: 'BurnCloud API',
  [ModelProvider.Custom]: 'Custom Provider',
}

export const AIModelProviderMenuOptionList = [
  {
    value: ModelProvider.ChatboxAI,
    label: aiProviderNameHash[ModelProvider.ChatboxAI],
    featured: true,
    disabled: false,
  },
  {
    value: ModelProvider.OpenAI,
    label: aiProviderNameHash[ModelProvider.OpenAI],
    disabled: false,
  },
  {
    value: ModelProvider.Claude,
    label: aiProviderNameHash[ModelProvider.Claude],
    disabled: false,
  },
  {
    value: ModelProvider.Gemini,
    label: aiProviderNameHash[ModelProvider.Gemini],
    disabled: false,
  },
  {
    value: ModelProvider.Ollama,
    label: aiProviderNameHash[ModelProvider.Ollama],
    disabled: false,
  },
  {
    value: ModelProvider.LMStudio,
    label: aiProviderNameHash[ModelProvider.LMStudio],
    disabled: false,
  },
  {
    value: ModelProvider.DeepSeek,
    label: aiProviderNameHash[ModelProvider.DeepSeek],
    disabled: false,
  },
  {
    value: ModelProvider.SiliconFlow,
    label: aiProviderNameHash[ModelProvider.SiliconFlow],
    disabled: false,
  },
  {
    value: ModelProvider.Azure,
    label: aiProviderNameHash[ModelProvider.Azure],
    disabled: false,
  },
  {
    value: ModelProvider.XAI,
    label: aiProviderNameHash[ModelProvider.XAI],
    disabled: false,
  },
  {
    value: ModelProvider.Perplexity,
    label: aiProviderNameHash[ModelProvider.Perplexity],
    disabled: false,
  },
  {
    value: ModelProvider.Groq,
    label: aiProviderNameHash[ModelProvider.Groq],
    disabled: false,
  },
  {
    value: ModelProvider.ChatGLM6B,
    label: aiProviderNameHash[ModelProvider.ChatGLM6B],
    disabled: false,
  },
  {
    value: ModelProvider.BurnCloud,
    label: aiProviderNameHash[ModelProvider.BurnCloud],
    disabled: false,
  },
  // {
  //     value: 'hunyuan',
  //     label: '腾讯混元',
  //     disabled: true,
  // },
]

function keepRange(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num))
}
