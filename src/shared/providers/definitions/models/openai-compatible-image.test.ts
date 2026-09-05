import type { ProviderModelInfo } from 'src/shared/types'
import type { ModelDependencies } from 'src/shared/types/adapters'
import type { SentryScope } from 'src/shared/utils/sentry_adapter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CustomOpenAI from './custom-openai'
import CustomOpenAIResponses from './custom-openai-responses'
import { getOpenAIImageGenerationOptions } from './openai-compatible-image'
import OpenRouter from './openrouter'

const aiMocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    experimental_generateImage: aiMocks.generateImage,
  }
})

const imageMocks = vi.hoisted(() => {
  const imageModel = { modelId: 'image-model' }
  const image = vi.fn(() => imageModel)
  const createOpenAI = vi.fn(() => ({ image }))
  return { createOpenAI, image, imageModel }
})

const openRouterMocks = vi.hoisted(() => {
  const imageModel = { modelId: 'openrouter-image-model' }
  const imageModelFactory = vi.fn(() => imageModel)
  const languageModel = vi.fn()
  const createOpenRouter = vi.fn(
    (_options: { apiKey: string; headers: Record<string, string>; fetch: typeof globalThis.fetch }) => ({
      imageModel: imageModelFactory,
      languageModel,
    })
  )
  return { createOpenRouter, imageModel, imageModelFactory }
})

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: imageMocks.createOpenAI,
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({
    languageModel: vi.fn(),
  })),
}))

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: openRouterMocks.createOpenRouter,
}))

class TestCustomOpenAI extends CustomOpenAI {
  public exposeImageModel() {
    return this.getImageModel()
  }
}

class TestCustomOpenAIResponses extends CustomOpenAIResponses {
  public exposeImageModel() {
    return this.getImageModel()
  }
}

class TestOpenRouter extends OpenRouter {
  public exposeImageModel() {
    return this.getImageModel()
  }
}

function createDependencies(): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn(),
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback({ setTag: vi.fn(), setExtra: vi.fn() })),
      captureException: vi.fn(),
    },
    getRemoteConfig: vi.fn().mockReturnValue({ setting_chatboxai_first: false }),
  }
}

describe('OpenAI-compatible image models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an image model for a custom OpenAI host', () => {
    const model: ProviderModelInfo = { modelId: 'flux-local', type: 'image' }
    const instance = new TestCustomOpenAI(
      {
        apiKey: 'custom-key',
        apiHost: 'https://example.test/v1',
        apiPath: '/chat/completions',
        model,
        useProxy: false,
      },
      createDependencies()
    )

    expect(instance.exposeImageModel()).toBe(imageMocks.imageModel)
    expect(imageMocks.createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'custom-key',
        baseURL: 'https://example.test/v1',
      })
    )
    expect(imageMocks.image).toHaveBeenCalledWith('flux-local')
  })

  it('creates an image model for custom OpenAI Responses hosts', () => {
    const instance = new TestCustomOpenAIResponses(
      {
        apiKey: 'responses-key',
        apiHost: 'https://proxy.test/v1',
        apiPath: '/responses',
        model: { modelId: 'gpt-image-1', type: 'image' },
        useProxy: false,
      },
      createDependencies()
    )

    expect(instance.exposeImageModel()).toBe(imageMocks.imageModel)
    expect(imageMocks.image).toHaveBeenCalledWith('gpt-image-1')
  })

  it('maps Image Creator aspect ratios to OpenAI image sizes', () => {
    expect(getOpenAIImageGenerationOptions('gpt-image-1', 'auto')).toEqual({})
    expect(getOpenAIImageGenerationOptions('gpt-image-1', '1:1')).toEqual({ size: '1024x1024' })
    expect(getOpenAIImageGenerationOptions('gpt-image-1', '3:2')).toEqual({ size: '1536x1024' })
    expect(getOpenAIImageGenerationOptions('gpt-image-1', '2:3')).toEqual({ size: '1024x1536' })
    expect(getOpenAIImageGenerationOptions('dall-e-3', '7:4')).toEqual({ size: '1792x1024' })
    expect(getOpenAIImageGenerationOptions('dall-e-3', '4:7')).toEqual({ size: '1024x1792' })
    expect(getOpenAIImageGenerationOptions('dall-e-2', '3:2')).toEqual({})
  })

  it('uses OpenAI image sizes for custom OpenAI-compatible generation', async () => {
    aiMocks.generateImage.mockResolvedValue({ images: [] })
    const instances = [
      new TestCustomOpenAI(
        {
          apiKey: 'custom-key',
          apiHost: 'https://example.test/v1',
          apiPath: '/chat/completions',
          model: { modelId: 'flux-local', type: 'image' },
          useProxy: false,
        },
        createDependencies()
      ),
      new TestCustomOpenAIResponses(
        {
          apiKey: 'responses-key',
          apiHost: 'https://proxy.test/v1',
          apiPath: '/responses',
          model: { modelId: 'gpt-image-1', type: 'image' },
          useProxy: false,
        },
        createDependencies()
      ),
    ]

    for (const instance of instances) {
      await instance.paint({ prompt: 'wide landscape', num: 1, aspectRatio: '3:2' })
    }

    expect(aiMocks.generateImage).toHaveBeenCalledTimes(2)
    for (const [options] of aiMocks.generateImage.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ size: '1536x1024' }))
      expect(options).not.toHaveProperty('aspectRatio')
    }
  })

  it('persists each custom OpenAI-compatible image before starting the next request', async () => {
    const instances = [
      new TestCustomOpenAI(
        {
          apiKey: 'custom-key',
          apiHost: 'https://example.test/v1',
          apiPath: '/chat/completions',
          model: { modelId: 'flux-local', type: 'image' },
          useProxy: false,
        },
        createDependencies()
      ),
      new TestCustomOpenAIResponses(
        {
          apiKey: 'responses-key',
          apiHost: 'https://proxy.test/v1',
          apiPath: '/responses',
          model: { modelId: 'gpt-image-1', type: 'image' },
          useProxy: false,
        },
        createDependencies()
      ),
    ]

    for (const instance of instances) {
      const callback = vi.fn()
      const secondError = new Error('second image failed')
      aiMocks.generateImage
        .mockResolvedValueOnce({ images: [{ mediaType: 'image/png', base64: 'first-image' }] })
        .mockRejectedValueOnce(secondError)

      await expect(instance.paint({ prompt: 'two images', num: 2 }, undefined, callback)).rejects.toBe(secondError)

      expect(aiMocks.generateImage).toHaveBeenCalledTimes(2)
      expect(aiMocks.generateImage).toHaveBeenNthCalledWith(1, expect.objectContaining({ n: 1 }))
      expect(aiMocks.generateImage).toHaveBeenNthCalledWith(2, expect.objectContaining({ n: 1 }))
      expect(callback).toHaveBeenCalledOnce()
      expect(callback).toHaveBeenCalledWith('data:image/png;base64,first-image')
      vi.clearAllMocks()
    }
  })

  it('creates an image model through the OpenRouter provider', () => {
    const dependencies = createDependencies()
    const instance = new TestOpenRouter(
      {
        apiKey: 'or-key',
        model: { modelId: 'google/gemini-3-pro-image', type: 'image' },
      },
      dependencies
    )

    expect(instance.exposeImageModel()).toBe(openRouterMocks.imageModel)
    expect(openRouterMocks.createOpenRouter).toHaveBeenCalledWith({
      apiKey: 'or-key',
      headers: {
        'HTTP-Referer': 'https://chatboxai.app',
        'X-Title': 'Chatbox AI',
      },
      fetch: expect.any(Function),
    })
    expect(openRouterMocks.imageModelFactory).toHaveBeenCalledWith('google/gemini-3-pro-image')
    expect(imageMocks.createOpenAI).not.toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'or-key',
        baseURL: 'https://openrouter.ai/api/v1',
      })
    )
  })

  it('passes OpenRouter reference images through the AI SDK image prompt', async () => {
    aiMocks.generateImage.mockResolvedValue({ images: [] })
    const instance = new TestOpenRouter(
      {
        apiKey: 'or-key',
        model: { modelId: 'google/gemini-3-pro-image', type: 'image' },
      },
      createDependencies()
    )

    await instance.paint({
      prompt: 'edit this image',
      images: [{ imageUrl: 'https://example.test/reference.png' }, { imageUrl: 'data:image/png;base64,AQID' }],
      num: 1,
      aspectRatio: '16:9',
    })

    expect(aiMocks.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: {
          text: 'edit this image',
          images: ['https://example.test/reference.png', 'data:image/png;base64,AQID'],
        },
        n: 1,
        aspectRatio: '16:9',
        maxRetries: 0,
      })
    )
  })

  it('persists each OpenRouter image before starting the next request', async () => {
    const instance = new TestOpenRouter(
      {
        apiKey: 'or-key',
        model: { modelId: 'google/gemini-3-pro-image', type: 'image' },
      },
      createDependencies()
    )
    const callback = vi.fn()
    const secondError = new Error('second image failed')
    aiMocks.generateImage
      .mockResolvedValueOnce({ images: [{ mediaType: 'image/png', base64: 'first-image' }] })
      .mockRejectedValueOnce(secondError)

    await expect(
      instance.paint({ prompt: 'two images', num: 2, aspectRatio: '16:9' }, undefined, callback)
    ).rejects.toBe(secondError)

    expect(aiMocks.generateImage).toHaveBeenCalledTimes(2)
    expect(aiMocks.generateImage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ n: 1, aspectRatio: '16:9', maxRetries: 0 })
    )
    expect(aiMocks.generateImage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ n: 1, aspectRatio: '16:9', maxRetries: 0 })
    )
    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('data:image/png;base64,first-image')
  })
})
