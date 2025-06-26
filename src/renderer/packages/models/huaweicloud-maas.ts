import { fetchWithProxy } from '@/utils/request'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from './abstract-ai-sdk'
import { ProviderModelInfo } from 'src/shared/types'
import { fetchRemoteModels } from './openai-compatible'

const helpers = {
  isModelSupportVision: (model: string) => {
    // HuaweiCloudMaaS支持视觉的模型
    return false
  },
  isModelSupportToolUse: (model: string) => {
    // HuaweiCloudMaaS支持工具使用的模型（除了纯图像生成和推理专用模型）
    const nonToolModels = [
      'qwen3-235b-a22b',
      'qwen3-32b'
    ]
    return !nonToolModels.some(nonToolModel => model.includes(nonToolModel))
  },
}

interface Options {
  apiKey: string
  apiHost: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  useProxy?: boolean
}

export default class HuaweiCloudMaaS extends AbstractAISDKModel {
  public name = 'HuaweiCloudMaaS'
  public static helpers = helpers
  public options: Options

  constructor(options: Options) {
    super(options)
    this.options = {
      ...options,
      apiHost: options.apiHost || 'https://ai.huaweicloud.com/v1',
    }
  }

  public isSupportToolUse() {
    return helpers.isModelSupportToolUse(this.options.model.modelId)
  }

  private getProvider() {
    return createOpenAICompatible({
      name: 'HuaweiCloudMaaS',
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: this.options.useProxy ? fetchWithProxy : undefined,
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  protected getImageModel() {
    const provider = this.getProvider()
    return provider.imageModel('dall-e-3')
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
    }
  }

  public async listModels(): Promise<string[]> {
    return fetchRemoteModels({
      apiHost: this.options.apiHost,
      apiKey: this.options.apiKey,
      useProxy: this.options.useProxy,
    }).catch((err) => {
      console.error('HuaweiCloudMaaS models fetch error:', err)
      // 返回HuaweiCloudMaaS支持的常见模型作为备选
      return [
        'deepseek-r1-250528',
        'DeepSeek-V3',
        'DeepSeek-R1',
        'qwen3-235b-a22b',
        'qwen3-32b'
      ]
    })
  }
} 