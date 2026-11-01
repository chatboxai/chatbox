import { describe, expect, it } from 'vitest'
import {
  getImageModelFamily,
  getOpenAIImageSizeForRatio,
  getRatioOptionsForModel,
  validateImageGenerationRequest,
} from './image-models'

describe('image model families', () => {
  it('offers only sizes supported by DALL-E models', () => {
    expect(getImageModelFamily('dall-e-2')).toBe('dall-e-2')
    expect(getRatioOptionsForModel('dall-e-2')).toEqual(['auto', '1:1'])
    expect(getImageModelFamily('dall-e-3')).toBe('dall-e-3')
    expect(getRatioOptionsForModel('dall-e-3')).toEqual(['auto', '1:1', '7:4', '4:7'])
  })

  it('recognizes provider-prefixed DALL-E model ids', () => {
    expect(getImageModelFamily('openai/dall-e-3')).toBe('dall-e-3')
  })

  it('uses the same capability table for OpenAI request sizes', () => {
    expect(getOpenAIImageSizeForRatio('gpt-image-1', '3:2')).toBe('1536x1024')
    expect(getOpenAIImageSizeForRatio('dall-e-3', '7:4')).toBe('1792x1024')
    expect(getOpenAIImageSizeForRatio('dall-e-2', '3:2')).toBeUndefined()
    expect(getOpenAIImageSizeForRatio('gemini-3-pro-image', '16:9')).toBeUndefined()
  })
})

describe('image request capabilities', () => {
  it('rejects unsupported aspect ratios before generation', () => {
    expect(() =>
      validateImageGenerationRequest({
        modelId: 'seedream',
        capabilities: {
          aspectRatio: { values: ['1:1', '16:9'] },
          inputReferences: null,
        },
        aspectRatio: '4:3',
        referenceCount: 0,
      })
    ).toThrow('Choose Auto or one of: 1:1, 16:9')
  })

  it('rejects missing and excessive reference images', () => {
    const capabilities = {
      aspectRatio: null,
      inputReferences: { min: 1, max: 2 },
    }

    expect(() => validateImageGenerationRequest({ modelId: 'edit-model', capabilities, referenceCount: 0 })).toThrow(
      'requires at least 1 reference image'
    )
    expect(() => validateImageGenerationRequest({ modelId: 'edit-model', capabilities, referenceCount: 3 })).toThrow(
      'accepts at most 2 reference images'
    )
  })

  it('accepts supported requests and unknown fallback capabilities', () => {
    expect(() =>
      validateImageGenerationRequest({
        modelId: 'seedream',
        capabilities: {
          aspectRatio: { values: ['1:1', '16:9'] },
          inputReferences: { min: 0, max: 4 },
        },
        aspectRatio: '16:9',
        referenceCount: 2,
      })
    ).not.toThrow()
    expect(() =>
      validateImageGenerationRequest({
        modelId: 'manual-fallback',
        capabilities: undefined,
        aspectRatio: '4:3',
        referenceCount: 14,
      })
    ).not.toThrow()
  })
})
