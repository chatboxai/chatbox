import { fetchWithProxy } from '@/utils/request'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from './abstract-ai-sdk'
import { ModelHelpers } from './types'
import { fetchRemoteModels } from './openai-compatible'

const helpers: ModelHelpers = {
  isModelSupportVision: (model: string) => {
    // BurnCloud支持视觉的模型
    const visionModels = [
      'claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', // Claude系列都支持视觉
      'gpt-4o', 'gpt-4o-mini', 'gpt-4.5-preview', // GPT视觉模型
      'gemini-2.5-pro-preview-05-06', 'gemini-2.0', // Gemini系列支持视觉
    ]
    return visionModels.some(visionModel => model.includes(visionModel.replace(/[.-]/g, ''))) ||
           model.includes('claude') || 
           model.includes('gpt-4o') || 
           model.includes('gemini')
  },
  isModelSupportToolUse: (model: string) => {
    // BurnCloud支持工具使用的模型（除了纯图像生成和推理专用模型）
    const nonToolModels = [
      'gpt-image-1', // 图像生成模型不支持工具
      'o1', 'o1-mini', // 推理模型通常不支持工具调用
    ]
    return !nonToolModels.some(nonToolModel => model.includes(nonToolModel))
  },
}

interface Options {
  apiKey: string
  apiHost: string
  model: string
  temperature?: number
  topP?: number
  useProxy?: boolean
}

export default class BurnCloud extends AbstractAISDKModel {
  public name = 'BurnCloud'
  public static helpers = helpers
  public options: Options

  constructor(options: Options) {
    super()
    this.options = {
      ...options,
      apiHost: options.apiHost || 'https://ai.burncloud.com/v1',
    }
  }

  public isSupportToolUse() {
    return helpers.isModelSupportToolUse(this.options.model)
  }

  private getProvider() {
    return createOpenAICompatible({
      name: 'BurnCloud',
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: this.options.useProxy ? fetchWithProxy : undefined,
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model),
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
      console.error('BurnCloud models fetch error:', err)
      // 返回BurnCloud支持的常见模型作为备选
      return [
        'claude-sonnet-4-20250514',
        'claude-3-7-sonnet-20250219',
        'claude-3-5-sonnet-20241022',
        'gpt-4o',
        'gpt-4o-mini',
        'o1',
        'gpt-4.5-preview',
        'o1-mini',
        'gpt-image-1',
        'gemini-2.5-pro-preview-05-06',
        'gemini-2.0',
        'deepseek-r1',
        'deepseek-v3',
      ]
    })
  }
} 