import { describe, expect, it } from 'vitest'
import { applyRegistryOverlays } from './legacy-overrides'
import { isNonChatMediaModel, transformFullResponse, transformModelEntry, transformProviderModels } from './transform'
import type { ModelsDevModelEntry } from './types'

function modelsDevEntry(
  id: string,
  overrides: Partial<ModelsDevModelEntry> & { modalities?: ModelsDevModelEntry['modalities'] } = {}
): ModelsDevModelEntry {
  return {
    id,
    name: id,
    family: 'gpt',
    reasoning: true,
    tool_call: true,
    structured_output: true,
    open_weights: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 128_000, output: 16_384 },
    cost: { input: 1, output: 10 },
    release_date: '2026-01-01',
    ...overrides,
  }
}

describe('transformModelEntry', () => {
  it.each(['gpt-5-chat-latest', 'gpt-5.1-chat-latest', 'openai/gpt-5.2-chat'])(
    'removes incorrect reasoning metadata from %s',
    (modelId) => {
      expect(transformModelEntry(modelsDevEntry(modelId)).capabilities).toEqual(['tool_use'])
    }
  )

  it('keeps reasoning metadata for actual GPT-5 reasoning models', () => {
    expect(transformModelEntry(modelsDevEntry('gpt-5.2')).capabilities).toEqual(['tool_use', 'reasoning'])
  })
})

describe('non-chat media filtering', () => {
  it.each<[string, { family: string; modalities: { input: string[]; output: string[] } }]>([
    ['grok-imagine-image-2.0', { family: 'grok', modalities: { input: ['text', 'image'], output: ['image', 'pdf'] } }],
    ['veo-3.1-generate-preview', { family: 'veo', modalities: { input: ['text'], output: ['video'] } }],
    ['lyria-3-pro-preview', { family: 'lyria', modalities: { input: ['text', 'image'], output: ['text', 'audio'] } }],
    ['gemini-2.5-flash-preview-tts', { family: 'gemini-flash', modalities: { input: ['text'], output: ['audio'] } }],
  ])('excludes %s from the chat registry', (modelId, overrides) => {
    const entry = modelsDevEntry(modelId, overrides)
    expect(isNonChatMediaModel(entry)).toBe(true)
    expect(transformProviderModels({ [modelId]: entry })).toEqual({})
  })

  it('keeps multimodal chat models that still emit text', () => {
    const entry = modelsDevEntry('gemini-3-pro-image', {
      family: 'gemini-pro',
      modalities: { input: ['text', 'image'], output: ['text', 'image'] },
    })
    expect(isNonChatMediaModel(entry)).toBe(false)
    expect(transformProviderModels({ [entry.id]: entry })[entry.id]?.type).toBe('chat')
  })
})

describe('legacy Claude overlays', () => {
  it('restores retired Claude 3 output caps when the live catalog dropped them', () => {
    const registry = applyRegistryOverlays({
      claude: {
        'claude-sonnet-5': {
          modelId: 'claude-sonnet-5',
          type: 'chat',
          capabilities: ['tool_use'],
          contextWindow: 1_000_000,
          maxOutput: 128_000,
        },
      },
    })

    expect(registry.claude['claude-3-haiku-20240307']?.maxOutput).toBe(4096)
    expect(registry.claude['claude-3-opus-20240229']?.maxOutput).toBe(4096)
    expect(registry.claude['claude-sonnet-5']?.maxOutput).toBe(128_000)
  })

  it('does not overwrite a live Claude 3 entry', () => {
    const registry = applyRegistryOverlays({
      claude: {
        'claude-3-haiku-20240307': {
          modelId: 'claude-3-haiku-20240307',
          type: 'chat',
          capabilities: ['tool_use'],
          contextWindow: 200_000,
          maxOutput: 8_192,
        },
      },
    })

    expect(registry.claude['claude-3-haiku-20240307']?.maxOutput).toBe(8192)
  })

  it('injects the overlay through the models.dev response transform', () => {
    const registry = transformFullResponse({
      anthropic: {
        id: 'anthropic',
        name: 'Anthropic',
        doc: 'https://docs.anthropic.com',
        models: {
          'claude-sonnet-5': modelsDevEntry('claude-sonnet-5', { family: 'claude-sonnet' }),
        },
      },
    })

    expect(registry.claude['claude-3-haiku-20240307']?.maxOutput).toBe(4096)
  })
})

describe('DeepSeek compatibility overlays', () => {
  it('adds the vision model when a cached catalog predates it', () => {
    const registry = applyRegistryOverlays({
      deepseek: {
        'deepseek-v4-flash': {
          modelId: 'deepseek-v4-flash',
          type: 'chat',
          capabilities: ['reasoning', 'tool_use'],
          contextWindow: 1_000_000,
          maxOutput: 384_000,
        },
      },
    })

    expect(registry.deepseek['deepseek-v4-flash-vision-exp']?.capabilities).toEqual(['tool_use', 'reasoning', 'vision'])
  })

  it('does not overwrite live metadata for the vision model', () => {
    const registry = applyRegistryOverlays({
      deepseek: {
        'deepseek-v4-flash-vision-exp': {
          modelId: 'deepseek-v4-flash-vision-exp',
          type: 'chat',
          capabilities: ['vision'],
          contextWindow: 2_000_000,
          maxOutput: 512_000,
        },
      },
    })

    expect(registry.deepseek['deepseek-v4-flash-vision-exp']?.capabilities).toEqual(['vision'])
    expect(registry.deepseek['deepseek-v4-flash-vision-exp']?.contextWindow).toBe(2_000_000)
  })

  it('adds vision capability when a stale catalog already lists the model without it', () => {
    const registry = applyRegistryOverlays({
      deepseek: {
        'deepseek-v4-flash-vision-exp': {
          modelId: 'deepseek-v4-flash-vision-exp',
          type: 'chat',
          capabilities: ['reasoning', 'tool_use'],
          contextWindow: 1_000_000,
          maxOutput: 384_000,
        },
      },
    })

    expect(registry.deepseek['deepseek-v4-flash-vision-exp']?.capabilities).toEqual(['reasoning', 'tool_use', 'vision'])
  })
})
