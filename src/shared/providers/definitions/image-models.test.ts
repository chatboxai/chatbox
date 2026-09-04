import { describe, expect, it } from 'vitest'
import { getImageModelFamily, getOpenAIImageSizeForRatio, getRatioOptionsForModel } from './image-models'

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
