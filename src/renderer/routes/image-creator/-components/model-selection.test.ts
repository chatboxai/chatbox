import { describe, expect, it } from 'vitest'
import type { ImageModelGroup } from '@/hooks/useImageModelGroups'
import { getImageModelRatioOptions, resolveImageModelSelection, resolveImageRatioSelection } from './model-selection'

const groups: ImageModelGroup[] = [
  {
    label: 'OpenAI',
    providerId: 'openai',
    models: [{ modelId: 'gpt-image-2', displayName: 'GPT Image 2' }],
  },
]

describe('resolveImageModelSelection', () => {
  it('clears the selection when no image models remain', () => {
    expect(resolveImageModelSelection([], 'openai', 'gpt-image-2')).toBeNull()
  })

  it('keeps a selection that is still available', () => {
    expect(resolveImageModelSelection(groups, 'openai', 'gpt-image-2')).toEqual({
      provider: 'openai',
      model: 'gpt-image-2',
    })
  })

  it('falls back to the first available model when the selection disappears', () => {
    expect(resolveImageModelSelection(groups, 'missing-provider', 'missing-model')).toEqual({
      provider: 'openai',
      model: 'gpt-image-2',
    })
  })
})

describe('getImageModelRatioOptions', () => {
  it('uses the existing model-family options when capabilities are unknown', () => {
    expect(getImageModelRatioOptions('gpt-image-2')).toEqual(['auto', '1:1', '3:2', '2:3'])
  })

  it('only offers auto when the dynamic model does not support aspect ratios', () => {
    expect(
      getImageModelRatioOptions('meta/muse-image', {
        aspectRatio: null,
        inputReferences: null,
      })
    ).toEqual(['auto'])
  })

  it('offers the ratios declared by the dynamic model without duplicating auto', () => {
    expect(
      getImageModelRatioOptions('recraft/recraft-v4-styles-vector', {
        aspectRatio: { values: ['auto', '16:9', '9:16'] },
        inputReferences: { min: 1, max: 1 },
      })
    ).toEqual(['auto', '16:9', '9:16'])
  })
})

describe('resolveImageRatioSelection', () => {
  it('resets a ratio that becomes invalid after capabilities refresh', () => {
    expect(resolveImageRatioSelection('3:2', ['auto', '16:9', '9:16'])).toBe('auto')
  })

  it('keeps a ratio that remains supported', () => {
    expect(resolveImageRatioSelection('16:9', ['auto', '16:9', '9:16'])).toBe('16:9')
  })
})
