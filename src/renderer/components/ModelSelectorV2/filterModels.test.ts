import { describe, expect, test } from 'vitest'
import { filterModelsForSelector } from './filterModels'

describe('filterModelsForSelector', () => {
  const models = [
    { modelId: 'chat-1', type: 'chat' as const },
    { modelId: 'embed-1', type: 'embedding' as const },
    { modelId: 'rerank-1', type: 'rerank' as const },
    { modelId: 'legacy-chat', type: undefined },
  ]

  test('keeps only chat models when no filter is provided', () => {
    expect(filterModelsForSelector(models)).toEqual([
      { modelId: 'chat-1', type: 'chat' },
      { modelId: 'legacy-chat', type: undefined },
    ])
  })

  test('allows embedding models when filter is provided', () => {
    expect(filterModelsForSelector(models, (model) => model.type === 'embedding')).toEqual([
      { modelId: 'embed-1', type: 'embedding' },
    ])
  })

  test('allows rerank models when filter is provided', () => {
    expect(filterModelsForSelector(models, (model) => model.type === 'rerank')).toEqual([
      { modelId: 'rerank-1', type: 'rerank' },
    ])
  })
})
