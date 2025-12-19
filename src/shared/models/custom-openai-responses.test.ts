import { describe, expect, it, vi, beforeEach } from 'vitest'
import CustomOpenAIResponses from './custom-openai-responses'
import type { ModelDependencies } from '../types/adapters'
import type { ProviderModelInfo } from '../types/settings'
import { normalizeOpenAIResponsesHostAndPath } from '../utils/llm_utils'
import { fetchRemoteModels } from './openai-compatible'

// Mock the dependencies
vi.mock('../utils/llm_utils')
vi.mock('./openai-compatible')
vi.mock('./utils/fetch-proxy', () => ({
  createFetchWithProxy: vi.fn(() => vi.fn()),
}))

// Mock the AI SDK imports
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    responses: vi.fn().mockReturnValue('mock-responses-model'),
  })),
}))

vi.mock('ai', () => ({
  extractReasoningMiddleware: vi.fn(() => 'mock-reasoning-middleware'),
  wrapLanguageModel: vi.fn((config) => ({
    model: config.model,
    middleware: config.middleware,
    wrapped: true,
  })),
  streamText: vi.fn(() => Promise.resolve({})),
}))

describe('CustomOpenAIResponses', () => {
  const mockDependencies: ModelDependencies = {
    request: {
      fetchWithOptions: vi.fn(),
      apiRequest: vi.fn(),
    } as any,
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    } as any,
    sentry: {
      captureException: vi.fn(),
      addBreadcrumb: vi.fn(),
      withScope: vi.fn((callback) => callback({ setTag: vi.fn(), setExtra: vi.fn() })),
    } as any,
    getRemoteConfig: vi.fn(),
  }

  const mockModel: ProviderModelInfo = {
    modelId: 'gpt-4o-mini',
    nickname: 'GPT-4o Mini',
    type: 'chat',
    capabilities: ['vision'],
    contextWindow: 128000,
    maxOutput: 16384,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mocks
    vi.mocked(normalizeOpenAIResponsesHostAndPath).mockReturnValue({
      apiHost: 'https://api.openai.com/v1',
      apiPath: '/responses',
    })

    vi.mocked(fetchRemoteModels).mockResolvedValue([
      { modelId: 'gpt-4o-mini', type: 'chat' as const },
      { modelId: 'gpt-4o', type: 'chat' as const },
    ])
  })

  describe('constructor', () => {
    it('should normalize api host and path on initialization', () => {
      const options = {
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com',
        apiPath: '',
        model: mockModel,
        temperature: 0.7,
        useProxy: false,
      }

      new CustomOpenAIResponses(options, mockDependencies)

      expect(normalizeOpenAIResponsesHostAndPath).toHaveBeenCalledWith(options)
    })

    it('should update options with normalized values', () => {
      const options = {
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com',
        apiPath: '',
        model: mockModel,
        temperature: 0.7,
        useProxy: false,
      }

      const instance = new CustomOpenAIResponses(options, mockDependencies)

      expect(instance.options.apiHost).toBe('https://api.openai.com/v1')
      expect(instance.options.apiPath).toBe('/responses')
    })
  })

  describe('core functionality', () => {
    it('should create instance with correct options', () => {
      const options = {
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com/v1',
        apiPath: '/responses',
        model: mockModel,
        temperature: 0.7,
        useProxy: false,
      }

      const instance = new CustomOpenAIResponses(options, mockDependencies)

      expect(instance).toBeDefined()
      expect(instance.name).toBe('Custom OpenAI Responses')
      expect(instance.options.apiHost).toBe('https://api.openai.com/v1')
      expect(instance.options.apiPath).toBe('/responses')
    })

    it('should fetch remote models with correct parameters', async () => {
      const options = {
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com/v1',
        apiPath: '/responses',
        model: mockModel,
        temperature: 0.7,
        useProxy: false,
      }

      const instance = new CustomOpenAIResponses(options, mockDependencies)
      const models = await instance.listModels()

      expect(fetchRemoteModels).toHaveBeenCalledWith(
        {
          apiHost: 'https://api.openai.com/v1',
          apiKey: 'test-key',
          useProxy: false,
        },
        mockDependencies
      )

      expect(models).toEqual([
        { modelId: 'gpt-4o-mini', type: 'chat' },
        { modelId: 'gpt-4o', type: 'chat' },
      ])
    })

    it('should support text embedding', () => {
      expect(CustomOpenAIResponses.isSupportTextEmbedding()).toBe(true)
    })
  })

  describe('provider-specific behavior', () => {
    it('should handle different API hosts correctly', () => {
      // Test OpenRouter
      vi.mocked(normalizeOpenAIResponsesHostAndPath).mockReturnValue({
        apiHost: 'https://openrouter.ai/api/v1',
        apiPath: '/responses',
      })

      const openRouterOptions = {
        apiKey: 'test-key',
        apiHost: 'https://openrouter.ai/api/v1',
        apiPath: '/responses',
        model: mockModel,
        temperature: 0.7,
        useProxy: false,
      }

      const openRouterInstance = new CustomOpenAIResponses(openRouterOptions, mockDependencies)
      expect(openRouterInstance.options.apiHost).toBe('https://openrouter.ai/api/v1')

      // Test AiHubMix
      vi.mocked(normalizeOpenAIResponsesHostAndPath).mockReturnValue({
        apiHost: 'https://aihubmix.com/v1',
        apiPath: '/responses',
      })

      const aiHubMixOptions = {
        apiKey: 'test-key',
        apiHost: 'https://aihubmix.com/v1',
        apiPath: '/responses',
        model: mockModel,
        temperature: 0.7,
        useProxy: false,
      }

      const aiHubMixInstance = new CustomOpenAIResponses(aiHubMixOptions, mockDependencies)
      expect(aiHubMixInstance.options.apiHost).toBe('https://aihubmix.com/v1')
    })
  })

  describe('integration behavior', () => {
    it('should properly integrate all components for a complete flow', async () => {
      const options = {
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com/v1',
        apiPath: '/responses',
        model: mockModel,
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 2048,
        stream: true,
        useProxy: false,
      }

      const instance = new CustomOpenAIResponses(options, mockDependencies)

      // Test 1: Verify normalization happened
      expect(normalizeOpenAIResponsesHostAndPath).toHaveBeenCalledWith(options)
      expect(instance.options.apiHost).toBe('https://api.openai.com/v1')
      expect(instance.options.apiPath).toBe('/responses')

      // Test 2: Verify model listing works
      const models = await instance.listModels()
      expect(models).toEqual([
        { modelId: 'gpt-4o-mini', type: 'chat' },
        { modelId: 'gpt-4o', type: 'chat' },
      ])

      // Test 3: Verify static capabilities
      expect(CustomOpenAIResponses.isSupportTextEmbedding()).toBe(true)

      // Test 4: Verify instance properties
      expect(instance.name).toBe('Custom OpenAI Responses')
      expect(instance.options.model).toBe(mockModel)
    })
  })
})
