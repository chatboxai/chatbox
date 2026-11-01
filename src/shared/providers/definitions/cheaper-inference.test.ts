import { describe, expect, it } from 'vitest'
import { cheaperInferenceProvider } from './cheaper-inference'
import {
  CHEAPER_INFERENCE_API_HOST,
  type CheaperInferenceCatalogEntry,
  mapCheaperInferenceCatalog,
} from './models/cheaper-inference'

describe('cheaperInferenceProvider', () => {
  it('points at the gateway and browsable pages', () => {
    expect(cheaperInferenceProvider.defaultSettings?.apiHost).toBe(CHEAPER_INFERENCE_API_HOST)
    expect(cheaperInferenceProvider.urls).toEqual({
      website: 'https://www.cheaperinference.com/',
      apiKey: 'https://www.cheaperinference.com/dashboard/keys',
      docs: 'https://www.cheaperinference.com/docs',
      models: 'https://www.cheaperinference.com/markets',
    })
  })

  it('backs every curated id with a default model entry', () => {
    const defaults = new Set(cheaperInferenceProvider.defaultSettings?.models?.map((model) => model.modelId))
    for (const modelId of cheaperInferenceProvider.curatedModelIds ?? []) {
      expect(defaults).toContain(modelId)
    }
  })
})

describe('mapCheaperInferenceCatalog', () => {
  const catalog: CheaperInferenceCatalogEntry[] = [
    {
      id: 'claude-haiku-4.5',
      type: 'text',
      endpoint: '/v1/chat/completions',
      context_length: 200_000,
      max_output_tokens: 64_000,
      capabilities: { vision: true, reasoning: false },
    },
    {
      id: 'claude-opus-4.6',
      type: 'text',
      endpoint: '/v1/chat/completions',
      context_length: 1_000_000,
      max_output_tokens: 128_000,
      capabilities: { vision: false, reasoning: true },
    },
    {
      id: 'nano-banana',
      type: 'image',
      endpoint: '/v1/images/generations',
      capabilities: { vision: false, reasoning: false },
    },
    {
      id: 'seedance-2.0',
      type: 'video',
      endpoint: '/v1/videos/generations',
    },
  ]

  it('keeps only models the chat completions endpoint can answer', () => {
    expect(mapCheaperInferenceCatalog(catalog).map((model) => model.modelId)).toEqual([
      'claude-haiku-4.5',
      'claude-opus-4.6',
    ])
  })

  it('reads limits and capabilities from the catalog entry', () => {
    expect(mapCheaperInferenceCatalog(catalog)).toEqual([
      {
        modelId: 'claude-haiku-4.5',
        type: 'chat',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'claude-opus-4.6',
        type: 'chat',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
    ])
  })

  it('skips entries without an id and tolerates missing optional fields', () => {
    expect(mapCheaperInferenceCatalog([{}, { id: 'gpt-oss-120b' }])).toEqual([
      { modelId: 'gpt-oss-120b', type: 'chat', capabilities: ['tool_use'] },
    ])
  })
})
