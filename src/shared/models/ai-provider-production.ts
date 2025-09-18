import { ModelProviderEnum, type ProviderModelInfo, type ProviderSettings } from '../types'
import { SystemProviders } from '../defaults'
import OpenRouterProduction from './openrouter-production'
import { createModelDependencies } from '../adapters'

export interface AIProviderManagerOptions {
  onModelChange?: (model: ProviderModelInfo) => void
  onProviderChange?: (provider: ModelProviderEnum) => void
  onError?: (error: Error) => void
  onPerformanceUpdate?: (metrics: any) => void
}

export interface PerformanceMetrics {
  modelId: string
  duration: number
  tokens: number
  timestamp: string
  success: boolean
  error?: string
}

export class AIProviderProduction {
  private currentProvider: ModelProviderEnum = ModelProviderEnum.OpenRouter
  private currentModel: ProviderModelInfo | null = null
  private providers: Map<ModelProviderEnum, any> = new Map()
  private options: AIProviderManagerOptions
  private performanceHistory: PerformanceMetrics[] = []
  private maxHistorySize = 1000

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

  async setProvider(provider: ModelProviderEnum, settings: ProviderSettings): Promise<boolean> {
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
        const openRouter = new OpenRouterProduction({
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

  async setModel(modelId: string): Promise<boolean> {
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
        const models = await provider.listModels()
        return models
      }
    } catch (error) {
      console.error('Failed to fetch models:', error)
    }

    // Fallback to default models
    const systemProvider = SystemProviders.find(p => p.id === this.currentProvider)
    return systemProvider?.models || []
  }

  async generateResponse(prompt: string, options: any = {}): Promise<any> {
    const provider = this.providers.get(this.currentProvider)
    if (!provider) {
      throw new Error('No provider initialized')
    }

    const startTime = Date.now()
    let success = true
    let error: string | undefined

    try {
      const result = await provider.callChatCompletion({
        messages: [{ role: 'user', content: prompt }],
        ...options,
      })

      const duration = Date.now() - startTime
      const tokens = this.estimateTokens(prompt + (result.text || ''))

      this.recordPerformance({
        modelId: this.currentModel?.modelId || 'unknown',
        duration,
        tokens,
        timestamp: new Date().toISOString(),
        success: true,
      })

      return result
    } catch (err) {
      success = false
      error = err instanceof Error ? err.message : 'Unknown error'
      
      const duration = Date.now() - startTime
      this.recordPerformance({
        modelId: this.currentModel?.modelId || 'unknown',
        duration,
        tokens: 0,
        timestamp: new Date().toISOString(),
        success: false,
        error,
      })

      this.options.onError?.(err as Error)
      throw err
    }
  }

  async generateImage(prompt: string): Promise<any> {
    const provider = this.providers.get(this.currentProvider)
    if (!provider || !provider.generateImage) {
      throw new Error('Image generation not supported by current provider')
    }

    const startTime = Date.now()
    let success = true
    let error: string | undefined

    try {
      const result = await provider.generateImage(prompt)
      
      const duration = Date.now() - startTime
      this.recordPerformance({
        modelId: 'dall-e-3',
        duration,
        tokens: this.estimateTokens(prompt),
        timestamp: new Date().toISOString(),
        success: true,
      })

      return result
    } catch (err) {
      success = false
      error = err instanceof Error ? err.message : 'Unknown error'
      
      const duration = Date.now() - startTime
      this.recordPerformance({
        modelId: 'dall-e-3',
        duration,
        tokens: 0,
        timestamp: new Date().toISOString(),
        success: false,
        error,
      })

      this.options.onError?.(err as Error)
      throw err
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

  async getUsageStats(): Promise<any> {
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
  private recordPerformance(metrics: PerformanceMetrics): void {
    this.performanceHistory.push(metrics)
    
    // Keep only the last maxHistorySize entries
    if (this.performanceHistory.length > this.maxHistorySize) {
      this.performanceHistory.splice(0, this.performanceHistory.length - this.maxHistorySize)
    }

    // Notify listeners
    this.options.onPerformanceUpdate?.(metrics)
  }

  getPerformanceMetrics(modelId?: string): PerformanceMetrics[] {
    if (modelId) {
      return this.performanceHistory.filter(m => m.modelId === modelId)
    }
    return [...this.performanceHistory]
  }

  getPerformanceSummary(): {
    totalRequests: number
    successRate: number
    averageResponseTime: number
    totalTokens: number
    models: Record<string, any>
  } {
    const totalRequests = this.performanceHistory.length
    const successfulRequests = this.performanceHistory.filter(m => m.success).length
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0
    const averageResponseTime = totalRequests > 0 
      ? this.performanceHistory.reduce((sum, m) => sum + m.duration, 0) / totalRequests 
      : 0
    const totalTokens = this.performanceHistory.reduce((sum, m) => sum + m.tokens, 0)

    const models: Record<string, any> = {}
    this.performanceHistory.forEach(metric => {
      if (!models[metric.modelId]) {
        models[metric.modelId] = {
          requests: 0,
          successfulRequests: 0,
          totalDuration: 0,
          totalTokens: 0,
        }
      }
      
      models[metric.modelId].requests++
      if (metric.success) {
        models[metric.modelId].successfulRequests++
      }
      models[metric.modelId].totalDuration += metric.duration
      models[metric.modelId].totalTokens += metric.tokens
    })

    return {
      totalRequests,
      successRate,
      averageResponseTime,
      totalTokens,
      models,
    }
  }

  clearPerformanceHistory(): void {
    this.performanceHistory = []
  }

  private estimateTokens(text: string): number {
    // Simple token estimation (rough approximation)
    return Math.ceil(text.length / 4) // Rough estimate: 4 characters per token
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy'
    details: any
  }> {
    try {
      const provider = this.providers.get(this.currentProvider)
      if (!provider) {
        return {
          status: 'unhealthy',
          details: { error: 'No provider initialized' }
        }
      }

      // Test API connectivity
      const isValid = await this.validateApiKey(this.currentProvider === ModelProviderEnum.OpenRouter ? 'test' : '')
      if (!isValid) {
        return {
          status: 'degraded',
          details: { error: 'API key validation failed' }
        }
      }

      // Check recent performance
      const recentMetrics = this.performanceHistory.slice(-10)
      const recentSuccessRate = recentMetrics.length > 0 
        ? (recentMetrics.filter(m => m.success).length / recentMetrics.length) * 100 
        : 100

      if (recentSuccessRate < 80) {
        return {
          status: 'degraded',
          details: { 
            recentSuccessRate,
            recentErrors: recentMetrics.filter(m => !m.success).length
          }
        }
      }

      return {
        status: 'healthy',
        details: {
          provider: this.currentProvider,
          model: this.currentModel?.modelId,
          recentSuccessRate,
          totalRequests: this.performanceHistory.length
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      }
    }
  }
}