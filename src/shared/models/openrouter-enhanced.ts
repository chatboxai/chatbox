import { createOpenAI } from '@ai-sdk/openai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import type { ProviderModelInfo } from '../types'
import type { ModelDependencies } from '../types/adapters'
import AbstractAISDKModel from './abstract-ai-sdk'
import type { CallChatCompletionOptions } from './types'
import { createFetchWithProxy, fetchRemoteModels } from './utils/fetch-proxy'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxTokens?: number
  stream?: boolean
}

export default class OpenRouterEnhanced extends AbstractAISDKModel {
  public name = 'OpenRouter Enhanced'
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
    this.options = options
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider() {
    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      fetch: createFetchWithProxy(this.dependencies),
      headers: {
        'HTTP-Referer': 'https://chatbox.ai',
        'X-Title': 'Chatbox AI',
      },
    })
  }

  async callChatCompletion(options: CallChatCompletionOptions) {
    const provider = this.getProvider()
    const model = provider(this.options.model.modelId)

    const wrappedModel = wrapLanguageModel(model, {
      middleware: [extractReasoningMiddleware()],
    })

    return this.callChatCompletionWithProvider(wrappedModel, options)
  }

  async generateImage(prompt: string) {
    const provider = this.getProvider()
    const model = provider('dall-e-3')

    return model.generateImage({
      prompt,
      size: '1024x1024',
      quality: 'standard',
      n: 1,
    })
  }

  async listModels() {
    try {
      const models = await fetchRemoteModels(
        'https://openrouter.ai/api/v1/models',
        {
          headers: {
            'Authorization': `Bearer ${this.options.apiKey}`,
            'HTTP-Referer': 'https://chatbox.ai',
            'X-Title': 'Chatbox AI',
          },
        },
        this.dependencies
      )

      return models.map((model: any) => ({
        modelId: model.id,
        nickname: model.name,
        capabilities: this.getModelCapabilities(model.id),
        contextWindow: model.context_length || 128_000,
        pricing: {
          input: model.pricing?.prompt || 0,
          output: model.pricing?.completion || 0,
        },
        provider: model.provider || 'OpenRouter',
        description: model.description || '',
        tags: model.tags || [],
      }))
    } catch (error) {
      console.error('Failed to fetch OpenRouter models:', error)
      return this.getDefaultModels()
    }
  }

  private getModelCapabilities(modelId: string): string[] {
    const capabilities: string[] = []
    
    // Vision capabilities
    if (modelId.includes('vision') || modelId.includes('gpt-4v') || modelId.includes('claude-3') || modelId.includes('gemini-pro-vision')) {
      capabilities.push('vision')
    }
    
    // Tool use capabilities
    if (modelId.includes('gpt-4') || modelId.includes('claude-3') || modelId.includes('gemini-pro') || modelId.includes('o1')) {
      capabilities.push('tool_use')
    }
    
    // Reasoning capabilities
    if (modelId.includes('o1') || modelId.includes('claude-3.5') || modelId.includes('gpt-4')) {
      capabilities.push('reasoning')
    }
    
    // Code capabilities
    if (modelId.includes('code') || modelId.includes('claude-3') || modelId.includes('gemini-pro')) {
      capabilities.push('code')
    }
    
    // Multimodal capabilities
    if (modelId.includes('gpt-4') || modelId.includes('claude-3') || modelId.includes('gemini-pro')) {
      capabilities.push('multimodal')
    }

    return capabilities
  }

  private getDefaultModels() {
    return [
      {
        modelId: 'openai/gpt-4o',
        nickname: 'GPT-4o',
        capabilities: ['vision', 'tool_use', 'reasoning', 'multimodal'],
        contextWindow: 128_000,
        pricing: { input: 0.005, output: 0.015 },
        provider: 'OpenAI',
        description: 'Most advanced GPT-4 model with vision capabilities',
        tags: ['latest', 'vision', 'reasoning'],
      },
      {
        modelId: 'openai/gpt-4o-mini',
        nickname: 'GPT-4o Mini',
        capabilities: ['vision', 'tool_use', 'reasoning', 'multimodal'],
        contextWindow: 128_000,
        pricing: { input: 0.00015, output: 0.0006 },
        provider: 'OpenAI',
        description: 'Faster, cheaper GPT-4o model',
        tags: ['fast', 'cheap', 'vision'],
      },
      {
        modelId: 'anthropic/claude-3.5-sonnet',
        nickname: 'Claude 3.5 Sonnet',
        capabilities: ['vision', 'tool_use', 'reasoning', 'code'],
        contextWindow: 200_000,
        pricing: { input: 0.003, output: 0.015 },
        provider: 'Anthropic',
        description: 'Most capable Claude model with excellent reasoning',
        tags: ['reasoning', 'code', 'vision'],
      },
      {
        modelId: 'google/gemini-pro-1.5',
        nickname: 'Gemini Pro 1.5',
        capabilities: ['vision', 'tool_use', 'reasoning', 'multimodal'],
        contextWindow: 2_000_000,
        pricing: { input: 0.000375, output: 0.0015 },
        provider: 'Google',
        description: 'Google\'s most advanced model with massive context',
        tags: ['large-context', 'vision', 'multimodal'],
      },
      {
        modelId: 'meta-llama/llama-3.1-70b-instruct',
        nickname: 'Llama 3.1 70B',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 128_000,
        pricing: { input: 0.0009, output: 0.0009 },
        provider: 'Meta',
        description: 'Meta\'s most capable open-source model',
        tags: ['open-source', 'reasoning'],
      },
      {
        modelId: 'mistralai/mixtral-8x7b-instruct',
        nickname: 'Mixtral 8x7B',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 32_000,
        pricing: { input: 0.00027, output: 0.00027 },
        provider: 'Mistral',
        description: 'High-quality mixture of experts model',
        tags: ['mixture-of-experts', 'fast'],
      },
      {
        modelId: 'openai/dall-e-3',
        nickname: 'DALL-E 3',
        capabilities: ['image_generation'],
        contextWindow: 0,
        pricing: { input: 0.04, output: 0 },
        provider: 'OpenAI',
        description: 'Latest image generation model',
        tags: ['image-generation', 'art'],
      },
    ]
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://chatbox.ai',
          'X-Title': 'Chatbox AI',
        },
      })
      return response.ok
    } catch (error) {
      return false
    }
  }

  async getUsageStats() {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: {
          'Authorization': `Bearer ${this.options.apiKey}`,
          'HTTP-Referer': 'https://chatbox.ai',
          'X-Title': 'Chatbox AI',
        },
      })
      
      if (response.ok) {
        const data = await response.json()
        return {
          credits: data.data?.credits || 0,
          usage: data.data?.usage || {},
          limits: data.data?.limits || {},
        }
      }
    } catch (error) {
      console.error('Failed to fetch usage stats:', error)
    }
    
    return null
  }
}