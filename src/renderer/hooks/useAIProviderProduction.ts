import { useState, useEffect, useCallback, useRef } from 'react'
import { AIProviderProduction } from 'src/shared/models/ai-provider-production'
import { ModelProviderEnum, type ProviderModelInfo, type ProviderSettings } from 'src/shared/types'

export interface UseAIProviderProductionOptions {
  initialProvider?: ModelProviderEnum
  initialApiKey?: string
  autoConnect?: boolean
  enablePerformanceTracking?: boolean
}

export interface UseAIProviderProductionReturn {
  // State
  currentProvider: ModelProviderEnum
  currentModel: ProviderModelInfo | null
  availableModels: ProviderModelInfo[]
  isConnected: boolean
  isLoading: boolean
  error: string | null
  usageStats: any
  performanceMetrics: any
  healthStatus: 'healthy' | 'degraded' | 'unhealthy'
  
  // Actions
  setProvider: (provider: ModelProviderEnum, settings: ProviderSettings) => Promise<boolean>
  setModel: (modelId: string) => Promise<boolean>
  generateResponse: (prompt: string, options?: any) => Promise<any>
  generateImage: (prompt: string) => Promise<any>
  validateApiKey: (apiKey: string) => Promise<boolean>
  refreshModels: () => Promise<void>
  refreshUsageStats: () => Promise<void>
  healthCheck: () => Promise<void>
  
  // Utilities
  getRecommendedModel: (task: string, budget?: number) => Promise<ProviderModelInfo | null>
  getPerformanceSummary: () => any
  clearError: () => void
  clearPerformanceHistory: () => void
}

export const useAIProviderProduction = (options: UseAIProviderProductionOptions = {}): UseAIProviderProductionReturn => {
  const {
    initialProvider = ModelProviderEnum.OpenRouter,
    initialApiKey = '',
    autoConnect = false,
    enablePerformanceTracking = true,
  } = options

  const [providerManager] = useState(() => new AIProviderProduction({
    onProviderChange: (provider) => setCurrentProvider(provider),
    onModelChange: (model) => setCurrentModel(model),
    onError: (error) => setError(error.message),
    onPerformanceUpdate: (metrics) => {
      if (enablePerformanceTracking) {
        setPerformanceMetrics(prev => [...prev, metrics])
      }
    },
  }))

  const [currentProvider, setCurrentProvider] = useState<ModelProviderEnum>(initialProvider)
  const [currentModel, setCurrentModel] = useState<ProviderModelInfo | null>(null)
  const [availableModels, setAvailableModels] = useState<ProviderModelInfo[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usageStats, setUsageStats] = useState<any>(null)
  const [performanceMetrics, setPerformanceMetrics] = useState<any[]>([])
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'degraded' | 'unhealthy'>('unhealthy')

  const healthCheckInterval = useRef<NodeJS.Timeout | null>(null)

  // Initialize provider manager
  useEffect(() => {
    if (autoConnect && initialApiKey) {
      connectProvider(initialProvider, { apiKey: initialApiKey, models: [] })
    }
  }, [autoConnect, initialApiKey, initialProvider])

  // Health check interval
  useEffect(() => {
    if (isConnected && enablePerformanceTracking) {
      healthCheckInterval.current = setInterval(async () => {
        await performHealthCheck()
      }, 30000) // Check every 30 seconds

      return () => {
        if (healthCheckInterval.current) {
          clearInterval(healthCheckInterval.current)
        }
      }
    }
  }, [isConnected, enablePerformanceTracking])

  const connectProvider = useCallback(async (provider: ModelProviderEnum, settings: ProviderSettings) => {
    setIsLoading(true)
    setError(null)

    try {
      const success = await providerManager.setProvider(provider, settings)
      if (success) {
        setIsConnected(true)
        await refreshModels()
        await refreshUsageStats()
        await performHealthCheck()
      }
      return success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect provider')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [providerManager])

  const setProvider = useCallback(async (provider: ModelProviderEnum, settings: ProviderSettings) => {
    return await connectProvider(provider, settings)
  }, [connectProvider])

  const setModel = useCallback(async (modelId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const success = await providerManager.setModel(modelId)
      return success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set model')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [providerManager])

  const generateResponse = useCallback(async (prompt: string, options: any = {}) => {
    if (!isConnected) {
      throw new Error('No provider connected')
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await providerManager.generateResponse(prompt, options)
      return response
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate response'
      setError(errorMessage)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [providerManager, isConnected])

  const generateImage = useCallback(async (prompt: string) => {
    if (!isConnected) {
      throw new Error('No provider connected')
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await providerManager.generateImage(prompt)
      return response
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate image'
      setError(errorMessage)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [providerManager, isConnected])

  const validateApiKey = useCallback(async (apiKey: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const isValid = await providerManager.validateApiKey(apiKey)
      return isValid
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate API key')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [providerManager])

  const refreshModels = useCallback(async () => {
    try {
      const models = await providerManager.getAvailableModels()
      setAvailableModels(models)
      
      if (models.length > 0 && !currentModel) {
        setCurrentModel(models[0])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh models')
    }
  }, [providerManager, currentModel])

  const refreshUsageStats = useCallback(async () => {
    try {
      const stats = await providerManager.getUsageStats()
      setUsageStats(stats)
    } catch (err) {
      console.error('Failed to refresh usage stats:', err)
    }
  }, [providerManager])

  const performHealthCheck = useCallback(async () => {
    try {
      const health = await providerManager.healthCheck()
      setHealthStatus(health.status)
    } catch (err) {
      setHealthStatus('unhealthy')
    }
  }, [providerManager])

  const getRecommendedModel = useCallback(async (task: string, budget?: number) => {
    try {
      return await providerManager.getRecommendedModel(task, budget)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get recommended model')
      return null
    }
  }, [providerManager])

  const getPerformanceSummary = useCallback(() => {
    return providerManager.getPerformanceSummary()
  }, [providerManager])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const clearPerformanceHistory = useCallback(() => {
    providerManager.clearPerformanceHistory()
    setPerformanceMetrics([])
  }, [providerManager])

  return {
    // State
    currentProvider,
    currentModel,
    availableModels,
    isConnected,
    isLoading,
    error,
    usageStats,
    performanceMetrics,
    healthStatus,
    
    // Actions
    setProvider,
    setModel,
    generateResponse,
    generateImage,
    validateApiKey,
    refreshModels,
    refreshUsageStats,
    healthCheck: performHealthCheck,
    
    // Utilities
    getRecommendedModel,
    getPerformanceSummary,
    clearError,
    clearPerformanceHistory,
  }
}

export default useAIProviderProduction