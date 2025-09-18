import { ModelProviderEnum, type ProviderModelInfo, type ProviderSettings } from '../types'

export interface AIIntegrationConfig {
  providers: ModelProviderEnum[]
  defaultProvider: ModelProviderEnum
  defaultModel: string
  features: {
    chat: boolean
    imageGeneration: boolean
    codeGeneration: boolean
    reasoning: boolean
    vision: boolean
  }
  limits: {
    maxTokens: number
    maxImages: number
    rateLimit: number
  }
}

export const DEFAULT_AI_CONFIG: AIIntegrationConfig = {
  providers: [ModelProviderEnum.OpenRouter],
  defaultProvider: ModelProviderEnum.OpenRouter,
  defaultModel: 'openai/gpt-4o',
  features: {
    chat: true,
    imageGeneration: true,
    codeGeneration: true,
    reasoning: true,
    vision: true,
  },
  limits: {
    maxTokens: 4000,
    maxImages: 4,
    rateLimit: 100, // requests per minute
  },
}

export class AIIntegrationUtils {
  static validateProviderSettings(provider: ModelProviderEnum, settings: ProviderSettings): boolean {
    switch (provider) {
      case ModelProviderEnum.OpenRouter:
        return !!(settings.apiKey && settings.apiKey.startsWith('sk-or-'))
      default:
        return false
    }
  }

  static getProviderDisplayName(provider: ModelProviderEnum): string {
    switch (provider) {
      case ModelProviderEnum.OpenRouter:
        return 'OpenRouter'
      default:
        return 'Unknown Provider'
    }
  }

  static getModelDisplayName(model: ProviderModelInfo): string {
    return model.nickname || model.modelId
  }

  static getModelCapabilities(model: ProviderModelInfo): string[] {
    return model.capabilities || []
  }

  static canGenerateImages(model: ProviderModelInfo): boolean {
    return model.capabilities?.includes('image_generation') || false
  }

  static canProcessVision(model: ProviderModelInfo): boolean {
    return model.capabilities?.includes('vision') || false
  }

  static canUseTools(model: ProviderModelInfo): boolean {
    return model.capabilities?.includes('tool_use') || false
  }

  static canReason(model: ProviderModelInfo): boolean {
    return model.capabilities?.includes('reasoning') || false
  }

  static estimateCost(model: ProviderModelInfo, inputTokens: number, outputTokens: number): number {
    if (!model.pricing) return 0
    
    const inputCost = (inputTokens / 1000) * (model.pricing.input || 0)
    const outputCost = (outputTokens / 1000) * (model.pricing.output || 0)
    
    return inputCost + outputCost
  }

  static getRecommendedModelForTask(task: string, availableModels: ProviderModelInfo[]): ProviderModelInfo | null {
    const taskLower = task.toLowerCase()
    
    // Image generation
    if (taskLower.includes('image') || taskLower.includes('generate') || taskLower.includes('create')) {
      return availableModels.find(m => this.canGenerateImages(m)) || null
    }
    
    // Vision tasks
    if (taskLower.includes('analyze') || taskLower.includes('describe') || taskLower.includes('see')) {
      return availableModels.find(m => this.canProcessVision(m)) || null
    }
    
    // Code tasks
    if (taskLower.includes('code') || taskLower.includes('program') || taskLower.includes('function')) {
      return availableModels.find(m => m.capabilities?.includes('code')) || null
    }
    
    // Reasoning tasks
    if (taskLower.includes('reason') || taskLower.includes('analyze') || taskLower.includes('think')) {
      return availableModels.find(m => this.canReason(m)) || null
    }
    
    // Default to most capable model
    return availableModels.find(m => this.canReason(m)) || availableModels[0] || null
  }

  static formatModelInfo(model: ProviderModelInfo): string {
    const name = this.getModelDisplayName(model)
    const provider = model.provider || 'Unknown'
    const capabilities = this.getModelCapabilities(model).join(', ')
    
    return `${name} (${provider}) - ${capabilities}`
  }

  static getModelPerformanceMetrics(model: ProviderModelInfo): {
    speed: 'fast' | 'medium' | 'slow'
    quality: 'high' | 'medium' | 'low'
    cost: 'low' | 'medium' | 'high'
  } {
    const modelId = model.modelId.toLowerCase()
    
    // Speed estimation based on model size
    let speed: 'fast' | 'medium' | 'slow' = 'medium'
    if (modelId.includes('mini') || modelId.includes('7b') || modelId.includes('8b')) {
      speed = 'fast'
    } else if (modelId.includes('70b') || modelId.includes('large') || modelId.includes('o1')) {
      speed = 'slow'
    }
    
    // Quality estimation based on model capabilities
    let quality: 'high' | 'medium' | 'low' = 'medium'
    if (modelId.includes('gpt-4') || modelId.includes('claude-3.5') || modelId.includes('o1')) {
      quality = 'high'
    } else if (modelId.includes('gpt-3.5') || modelId.includes('claude-3-haiku')) {
      quality = 'low'
    }
    
    // Cost estimation based on pricing
    let cost: 'low' | 'medium' | 'high' = 'medium'
    if (model.pricing) {
      const avgPrice = ((model.pricing.input || 0) + (model.pricing.output || 0)) / 2
      if (avgPrice < 0.001) {
        cost = 'low'
      } else if (avgPrice > 0.01) {
        cost = 'high'
      }
    }
    
    return { speed, quality, cost }
  }

  static createModelComparison(models: ProviderModelInfo[]): Array<{
    model: ProviderModelInfo
    metrics: ReturnType<typeof this.getModelPerformanceMetrics>
    bestFor: string[]
  }> {
    return models.map(model => {
      const metrics = this.getModelPerformanceMetrics(model)
      const bestFor: string[] = []
      
      if (this.canGenerateImages(model)) {
        bestFor.push('Image Generation')
      }
      if (this.canProcessVision(model)) {
        bestFor.push('Vision Tasks')
      }
      if (this.canUseTools(model)) {
        bestFor.push('Tool Usage')
      }
      if (this.canReason(model)) {
        bestFor.push('Complex Reasoning')
      }
      if (model.capabilities?.includes('code')) {
        bestFor.push('Code Generation')
      }
      
      return { model, metrics, bestFor }
    })
  }

  static generateModelRecommendation(
    task: string,
    budget: number,
    availableModels: ProviderModelInfo[]
  ): {
    recommended: ProviderModelInfo
    alternatives: ProviderModelInfo[]
    reasoning: string
  } {
    const taskLower = task.toLowerCase()
    const suitableModels = availableModels.filter(model => {
      // Filter by budget if pricing is available
      if (model.pricing && budget > 0) {
        const avgPrice = ((model.pricing.input || 0) + (model.pricing.output || 0)) / 2
        if (avgPrice > budget / 1000) { // Assuming budget is per 1K tokens
          return false
        }
      }
      return true
    })
    
    const recommended = this.getRecommendedModelForTask(task, suitableModels)
    const alternatives = suitableModels.filter(m => m.modelId !== recommended?.modelId).slice(0, 3)
    
    let reasoning = 'Based on task requirements and available models'
    if (recommended) {
      const capabilities = this.getModelCapabilities(recommended)
      reasoning = `Recommended for ${capabilities.join(', ')} capabilities`
    }
    
    return {
      recommended: recommended || suitableModels[0],
      alternatives,
      reasoning,
    }
  }
}

export default AIIntegrationUtils