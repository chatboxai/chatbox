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

interface OpenRouterModel {
  id: string
  name: string
  description?: string
  context_length: number
  pricing: {
    prompt: number
    completion: number
  }
  provider: {
    id: string
    name: string
  }
  tags?: string[]
}

interface OpenRouterResponse {
  data: OpenRouterModel[]
}

interface UsageStats {
  credits: number
  usage: Record<string, any>
  limits: Record<string, any>
}

export default class OpenRouterProduction extends AbstractAISDKModel {
  public name = 'OpenRouter Production'
  public options: Options
  private apiBaseUrl = 'https://openrouter.ai/api/v1'
  private cache: Map<string, any> = new Map()
  private cacheTimeout = 5 * 60 * 1000 // 5 minutes

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
      baseURL: this.apiBaseUrl,
      fetch: createFetchWithProxy(this.dependencies),
      headers: {
        'HTTP-Referer': 'https://chatbox.ai',
        'X-Title': 'Chatbox AI',
        'Content-Type': 'application/json',
      },
    })
  }

  async callChatCompletion(options: CallChatCompletionOptions) {
    const startTime = Date.now()
    
    try {
      const provider = this.getProvider()
      const model = provider(this.options.model.modelId)

      const wrappedModel = wrapLanguageModel(model, {
        middleware: [extractReasoningMiddleware()],
      })

      const result = await this.callChatCompletionWithProvider(wrappedModel, options)
      
      // Record performance metrics
      const duration = Date.now() - startTime
      this.recordPerformance(this.options.model.modelId, {
        duration,
        tokens: this.estimateTokens(options.messages),
        timestamp: new Date().toISOString(),
      })

      return result
    } catch (error) {
      // Record error metrics
      this.recordError(this.options.model.modelId, error)
      throw error
    }
  }

  async generateImage(prompt: string) {
    try {
      const provider = this.getProvider()
      const model = provider('dall-e-3')

      const result = await model.generateImage({
        prompt,
        size: '1024x1024',
        quality: 'standard',
        n: 1,
      })

      return result
    } catch (error) {
      this.recordError('dall-e-3', error)
      throw error
    }
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const cacheKey = 'models'
    const cached = this.getCachedData(cacheKey)
    
    if (cached) {
      return cached
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.options.apiKey}`,
          'HTTP-Referer': 'https://chatbox.ai',
          'X-Title': 'Chatbox AI',
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`)
      }

      const data: OpenRouterResponse = await response.json()
      const models = data.data.map((model: OpenRouterModel) => ({
        modelId: model.id,
        nickname: model.name,
        capabilities: this.getModelCapabilities(model.id),
        contextWindow: model.context_length,
        pricing: {
          input: model.pricing.prompt,
          output: model.pricing.completion,
        },
        provider: model.provider.name,
        description: model.description || '',
        tags: model.tags || [],
      }))

      this.setCachedData(cacheKey, models)
      return models
    } catch (error) {
      console.error('Failed to fetch OpenRouter models:', error)
      // Return cached data if available, otherwise fallback to default models
      const cached = this.getCachedData(cacheKey)
      if (cached) return cached
      return this.getDefaultModels()
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://chatbox.ai',
          'X-Title': 'Chatbox AI',
          'Content-Type': 'application/json',
        },
      })
      
      return response.ok
    } catch (error) {
      console.error('API key validation failed:', error)
      return false
    }
  }

  async getUsageStats(): Promise<UsageStats | null> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/auth/key`, {
        headers: {
          'Authorization': `Bearer ${this.options.apiKey}`,
          'HTTP-Referer': 'https://chatbox.ai',
          'X-Title': 'Chatbox AI',
          'Content-Type': 'application/json',
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

  private getModelCapabilities(modelId: string): string[] {
    const capabilities: string[] = []
    
    // Vision capabilities
    if (modelId.includes('vision') || modelId.includes('gpt-4v') || 
        modelId.includes('claude-3') || modelId.includes('gemini-pro-vision') ||
        modelId.includes('gpt-4o')) {
      capabilities.push('vision')
    }
    
    // Tool use capabilities
    if (modelId.includes('gpt-4') || modelId.includes('claude-3') || 
        modelId.includes('gemini-pro') || modelId.includes('o1') ||
        modelId.includes('llama-3.1')) {
      capabilities.push('tool_use')
    }
    
    // Reasoning capabilities
    if (modelId.includes('o1') || modelId.includes('claude-3.5') || 
        modelId.includes('gpt-4') || modelId.includes('llama-3.1-70b')) {
      capabilities.push('reasoning')
    }
    
    // Code capabilities
    if (modelId.includes('code') || modelId.includes('claude-3') || 
        modelId.includes('gemini-pro') || modelId.includes('llama-3.1')) {
      capabilities.push('code')
    }
    
    // Multimodal capabilities
    if (modelId.includes('gpt-4') || modelId.includes('claude-3') || 
        modelId.includes('gemini-pro')) {
      capabilities.push('multimodal')
    }

    // Image generation capabilities
    if (modelId.includes('dall-e') || modelId.includes('midjourney') || 
        modelId.includes('stable-diffusion')) {
      capabilities.push('image_generation')
    }

    return capabilities
  }

  private getDefaultModels(): ProviderModelInfo[] {
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

  private getCachedData(key: string): any {
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data
    }
    return null
  }

  private setCachedData(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    })
  }

  private estimateTokens(messages: any[]): number {
    // Simple token estimation (rough approximation)
    const text = messages.map(m => m.content || '').join(' ')
    return Math.ceil(text.length / 4) // Rough estimate: 4 characters per token
  }

  private recordPerformance(modelId: string, metrics: any): void {
    // Store performance metrics for analytics
    const key = `performance_${modelId}`
    const existing = this.cache.get(key) || []
    existing.push(metrics)
    
    // Keep only last 100 entries
    if (existing.length > 100) {
      existing.splice(0, existing.length - 100)
    }
    
    this.cache.set(key, existing)
  }

  private recordError(modelId: string, error: any): void {
    // Store error metrics for debugging
    const key = `errors_${modelId}`
    const existing = this.cache.get(key) || []
    existing.push({
      error: error.message || error,
      timestamp: new Date().toISOString(),
    })
    
    // Keep only last 50 entries
    if (existing.length > 50) {
      existing.splice(0, existing.length - 50)
    }
    
    this.cache.set(key, existing)
  }

  getPerformanceMetrics(modelId?: string): any {
    if (modelId) {
      return this.cache.get(`performance_${modelId}`) || []
    }
    
    const metrics: any = {}
    for (const [key, value] of this.cache.entries()) {
      if (key.startsWith('performance_')) {
        const model = key.replace('performance_', '')
        metrics[model] = value
      }
    }
    return metrics
  }

  getErrorMetrics(modelId?: string): any {
    if (modelId) {
      return this.cache.get(`errors_${modelId}`) || []
    }
    
    const errors: any = {}
    for (const [key, value] of this.cache.entries()) {
      if (key.startsWith('errors_')) {
        const model = key.replace('errors_', '')
        errors[model] = value
      }
    }
    return errors
  }

  clearCache(): void {
    this.cache.clear()
  }
}