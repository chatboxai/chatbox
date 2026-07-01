import { beforeEach, describe, expect, it } from 'vitest'
import { enrichModelFromRegistry, setRuntimeRegistry } from './enrich'
import type { ModelRegistryData } from './types'

const registry: ModelRegistryData = {
  test: {
    'known-model': {
      modelId: 'known-model',
      name: 'Known Model',
      type: 'chat',
      capabilities: ['vision', 'tool_use'],
      contextWindow: 200_000,
      maxOutput: 32_000,
    },
  },
}

describe('enrichModelFromRegistry', () => {
  beforeEach(() => {
    setRuntimeRegistry(registry)
  })

  it('fills missing metadata from the registry by default', () => {
    const model = enrichModelFromRegistry({ modelId: 'known-model' }, 'test')

    expect(model.capabilities).toEqual(['vision', 'tool_use'])
    expect(model.contextWindow).toBe(200_000)
    expect(model.maxOutput).toBe(32_000)
  })

  it('overwrites existing metadata by default', () => {
    const model = enrichModelFromRegistry(
      {
        modelId: 'known-model',
        capabilities: [],
        contextWindow: 100,
        maxOutput: 10,
      },
      'test'
    )

    expect(model.capabilities).toEqual(['vision', 'tool_use'])
    expect(model.contextWindow).toBe(200_000)
    expect(model.maxOutput).toBe(32_000)
  })

  it('keeps explicit user capabilities when marked as an override', () => {
    const model = enrichModelFromRegistry(
      {
        modelId: 'known-model',
        capabilities: [],
        capabilitiesOverride: true,
        contextWindow: 100,
        maxOutput: 10,
      },
      'test'
    )

    expect(model.capabilities).toEqual([])
    expect(model.contextWindow).toBe(200_000)
    expect(model.maxOutput).toBe(32_000)
  })

  it('does not treat saved capabilities as an override without the override marker', () => {
    const model = enrichModelFromRegistry(
      {
        modelId: 'known-model',
        capabilities: [],
        capabilitiesOverride: false,
      },
      'test'
    )

    expect(model.capabilities).toEqual(['vision', 'tool_use'])
  })
})
