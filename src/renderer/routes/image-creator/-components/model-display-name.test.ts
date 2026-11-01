import { ModelProviderEnum, type ProviderInfo } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { ImageModelGroup } from '@/hooks/useImageModelGroups'
import {
  getHistoryImageModelDisplayName,
  type ImageModelDisplayNameContext,
  getImageModelDisplayName,
} from './model-display-name'

const context: ImageModelDisplayNameContext = {
  imageModelGroups: [
    {
      label: 'OpenAI',
      providerId: ModelProviderEnum.OpenAI,
      models: [{ modelId: 'gpt-image-1', displayName: 'GPT Image 1' }],
    } as ImageModelGroup,
  ],
  providers: [{ id: ModelProviderEnum.OpenAI, name: 'OpenAI' } as ProviderInfo],
}

describe('getImageModelDisplayName', () => {
  it('prefixes the provider label', () => {
    expect(getImageModelDisplayName({ provider: ModelProviderEnum.OpenAI, modelId: 'gpt-image-1' }, context)).toBe(
      'OpenAI - GPT Image 1'
    )
  })

  it('omits the provider for Chatbox AI', () => {
    expect(getImageModelDisplayName({ provider: ModelProviderEnum.ChatboxAI, modelId: 'gpt-image-2' }, context)).toBe(
      'gpt-image-2'
    )
  })

  it('falls back to a bare label when the model is unknown', () => {
    expect(getImageModelDisplayName({ provider: '', modelId: '' }, context)).toBe('Image')
  })
})

describe('getHistoryImageModelDisplayName', () => {
  it('names a legacy record by its shipped display name', () => {
    expect(
      getHistoryImageModelDisplayName({ provider: ModelProviderEnum.ChatboxAI, modelId: 'chatboxai-paint' }, context)
    ).toBe('Chatbox AI Paint')
  })

  it('keeps naming a legacy record that shipped without a model id', () => {
    expect(getHistoryImageModelDisplayName({ provider: ModelProviderEnum.ChatboxAI, modelId: '' }, context)).toBe(
      'GPT Image'
    )
  })

  it('falls back to a bare label when the record names no provider', () => {
    expect(getHistoryImageModelDisplayName({ provider: '', modelId: '' }, context)).toBe('Image')
  })
})
