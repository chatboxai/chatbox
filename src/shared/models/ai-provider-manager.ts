import { ModelProviderEnum, type ProviderModelInfo, type ProviderSettings } from '../types'
import { SystemProviders } from '../defaults'
import OpenRouterEnhanced from './openrouter-enhanced'
import { createModelDependencies } from '../adapters'

export interface AIProviderManagerOptions {
  onModelChange?: (model: ProviderModelInfo) => void
  onProviderChange?: (provider: ModelProviderEnum) => void
  onError?: (error: Error) => void
}

export class AIProviderManager {
  private currentProvider: ModelProviderEnum = ModelProviderEnum.OpenRouter
  private currentModel: ProviderModelInfo | null = null
  private providers: Map<ModelProviderEnum, any> = new Map()
  private options: AIProviderManagerOptions

  constructor(options: AIProviderManagerOptions = {}) {
    this.options = options
    this.initializeProviders()
  }

  private initializeProviders() {
    // Initialize OpenRouter as the primary provider
    const openRouterProvider = SystemProviders.find(p => p.id === ModelProviderEnum.OpenRouter)
    if (openRouterProvider) {
      this.providers.set(ModelProviderEnum.OpenRouter, openRouterProvider)
    }
  }

  async setProvider(provider: ModelProviderEnum, settings: ProviderSettings) {
    try {
      this.currentProvider = provider
      this.options.onProviderChange?.(provider)

      // Initialize the provider with settings
      await this.initializeProvider(provider, settings)
      
      return true
    } catch (error) {
      this.options.onError?.(error as Error)
      return false
    }
  }

  private async initializeProvider(provider: ModelProviderEnum, settings: ProviderSettings) {
    const dependencies = createModelDependencies()
    
    switch (provider) {
      case ModelProviderEnum.OpenRouter:
        const openRouterModel = settings.models?.[0] || this.getDefaultModel()
        const openRouter = new OpenRouterEnhanced({
          apiKey: settings.apiKey || '',
          model: openRouterModel,
          temperature: 0.7,
          topP: 0.9,
          maxTokens: 4000,
          stream: true,
        }, dependencies)
        
        this.providers.set(provider, openRouter)
        break
        
      default:
        throw new Error(`Provider ${provider} not supported`)
    }
  }

  async setModel(modelId: string) {
    try {
      const provider = this.providers.get(this.currentProvider)
      if (!provider) {
        throw new Error('No provider initialized')
      }

      const model = await this.findModel(modelId)
      if (!model) {
        throw new Error(`Model ${modelId} not found`)
      }

      this.currentModel = model
      this.options.onModelChange?.(model)
      
      return true
    } catch (error) {
      this.options.onError?.(error as Error)
      return false
    }
  }

  private async findModel(modelId: string): Promise<ProviderModelInfo | null> {
    const provider = SystemProviders.find(p => p.id === this.currentProvider)
    if (!provider) return null

    return provider.models?.find(m => m.modelId === modelId) || null
  }

  async getAvailableModels(): Promise<ProviderModelInfo[]> {
    const provider = this.providers.get(this.currentProvider)
    if (!provider) return []

    try {
      if (provider.listModels) {
        return await provider.listModels()
      }
    } catch (error) {
      console.error('Failed to fetch models:', error)
    }

    // Fallback to default models
    const systemProvider = SystemProviders.find(p => p.id === this.currentProvider)
    return systemProvider?.models || []
  }

  async generateResponse(prompt: string, options: any = {}) {
    const provider = this.providers.get(this.currentProvider)
    if (!provider) {
      throw new Error('No provider initialized')
    }

    try {
      return await provider.callChatCompletion({
        messages: [{ role: 'user', content: prompt }],
        ...options,
      })
    } catch (error) {
      this.options.onError?.(error as Error)
      throw error
    }
  }

  async generateImage(prompt: string) {
    const provider = this.providers.get(this.currentProvider)
    if (!provider || !provider.generateImage) {
      throw new Error('Image generation not supported by current provider')
    }

    try {
      return await provider.generateImage(prompt)
    } catch (error) {
      this.options.onError?.(error as Error)
      throw error
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    const provider = this.providers.get(this.currentProvider)
    if (!provider || !provider.validateApiKey) {
      return false
    }

    try {
      return await provider.validateApiKey(apiKey)
    } catch (error) {
      return false
    }
  }

  async getUsageStats() {
    const provider = this.providers.get(this.currentProvider)
    if (!provider || !provider.getUsageStats) {
      return null
    }

    try {
      return await provider.getUsageStats()
    } catch (error) {
      console.error('Failed to get usage stats:', error)
      return null
    }
  }

  getCurrentProvider(): ModelProviderEnum {
    return this.currentProvider
  }

  getCurrentModel(): ProviderModelInfo | null {
    return this.currentModel
  }

  getSupportedProviders(): ModelProviderEnum[] {
    return [ModelProviderEnum.OpenRouter]
  }

  private getDefaultModel(): ProviderModelInfo {
    return {
      modelId: 'openai/gpt-4o',
      capabilities: ['vision', 'tool_use', 'reasoning', 'multimodal'],
      contextWindow: 128_000,
    }
  }

  // Model recommendation system
  async getRecommendedModel(task: string, budget?: number): Promise<ProviderModelInfo | null> {
    const models = await this.getAvailableModels()
    
    // Simple recommendation logic based on task type
    const taskLower = task.toLowerCase()
    
    if (taskLower.includes('image') || taskLower.includes('visual')) {
      return models.find(m => m.capabilities.includes('vision')) || null
    }
    
    if (taskLower.includes('code') || taskLower.includes('programming')) {
      return models.find(m => m.capabilities.includes('code')) || null
    }
    
    if (taskLower.includes('reasoning') || taskLower.includes('analysis')) {
      return models.find(m => m.capabilities.includes('reasoning')) || null
    }
    
    // Default to most capable model
    return models.find(m => m.capabilities.includes('reasoning')) || models[0] || null
  }

  // Performance monitoring
  private performanceMetrics = new Map<string, any>()

  recordPerformance(modelId: string, metrics: any) {
    this.performanceMetrics.set(modelId, {
      ...metrics,
      timestamp: Date.now(),
    })
  }

  getPerformanceMetrics(modelId?: string) {
    if (modelId) {
      return this.performanceMetrics.get(modelId)
    }
    return Object.fromEntries(this.performanceMetrics)
  }
}