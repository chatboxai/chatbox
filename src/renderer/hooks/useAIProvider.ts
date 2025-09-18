import { useState, useEffect, useCallback } from 'react'
import { AIProviderManager } from 'src/shared/models/ai-provider-manager'
import { ModelProviderEnum, type ProviderModelInfo, type ProviderSettings } from 'src/shared/types'

export interface UseAIProviderOptions {
  initialProvider?: ModelProviderEnum
  initialApiKey?: string
  autoConnect?: boolean
}

export interface UseAIProviderReturn {
  // State
  currentProvider: ModelProviderEnum
  currentModel: ProviderModelInfo | null
  availableModels: ProviderModelInfo[]
  isConnected: boolean
  isLoading: boolean
  error: string | null
  usageStats: any
  
  // Actions
  setProvider: (provider: ModelProviderEnum, settings: ProviderSettings) => Promise<boolean>
  setModel: (modelId: string) => Promise<boolean>
  generateResponse: (prompt: string, options?: any) => Promise<any>
  generateImage: (prompt: string) => Promise<any>
  validateApiKey: (apiKey: string) => Promise<boolean>
  refreshModels: () => Promise<void>
  refreshUsageStats: () => Promise<void>
  
  // Utilities
  getRecommendedModel: (task: string, budget?: number) => Promise<ProviderModelInfo | null>
  clearError: () => void
}

export const useAIProvider = (options: UseAIProviderOptions = {}): UseAIProviderReturn => {
  const {
    initialProvider = ModelProviderEnum.OpenRouter,
    initialApiKey = '',
    autoConnect = false,
  } = options

  const [providerManager] = useState(() => new AIProviderManager({
    onProviderChange: (provider) => setCurrentProvider(provider),
    onModelChange: (model) => setCurrentModel(model),
    onError: (error) => setError(error.message),
  }))

  const [currentProvider, setCurrentProvider] = useState<ModelProviderEnum>(initialProvider)
  const [currentModel, setCurrentModel] = useState<ProviderModelInfo | null>(null)
  const [availableModels, setAvailableModels] = useState<ProviderModelInfo[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usageStats, setUsageStats] = useState<any>(null)

  // Initialize provider manager
  useEffect(() => {
    if (autoConnect && initialApiKey) {
      connectProvider(initialProvider, { apiKey: initialApiKey, models: [] })
    }
  }, [autoConnect, initialApiKey, initialProvider])

  const connectProvider = useCallback(async (provider: ModelProviderEnum, settings: ProviderSettings) => {
    setIsLoading(true)
    setError(null)

    try {
      const success = await providerManager.setProvider(provider, settings)
      if (success) {
        setIsConnected(true)
        await refreshModels()
        await refreshUsageStats()
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

  const getRecommendedModel = useCallback(async (task: string, budget?: number) => {
    try {
      return await providerManager.getRecommendedModel(task, budget)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get recommended model')
      return null
    }
  }, [providerManager])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    // State
    currentProvider,
    currentModel,
    availableModels,
    isConnected,
    isLoading,
    error,
    usageStats,
    
    // Actions
    setProvider,
    setModel,
    generateResponse,
    generateImage,
    validateApiKey,
    refreshModels,
    refreshUsageStats,
    
    // Utilities
    getRecommendedModel,
    clearError,
  }
}

export default useAIProvider