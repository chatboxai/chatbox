import { afterEach, describe, expect, it } from 'vitest'
import { getRegistryModelMeta, setRuntimeRegistry } from './enrich'

describe('getRegistryModelMeta', () => {
  afterEach(() => {
    setRuntimeRegistry(null)
  })

  it('returns the legacy Haiku output cap when the live catalog omitted it', () => {
    setRuntimeRegistry({ claude: {} })
    expect(getRegistryModelMeta('claude', 'claude-3-haiku-20240307')?.maxOutput).toBe(4096)
  })

  it('returns DeepSeek vision metadata when the cached catalog predates the model', () => {
    setRuntimeRegistry({
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

    expect(getRegistryModelMeta('deepseek', 'deepseek-v4-flash-vision-exp')?.capabilities).toContain('vision')
  })

  it('adds vision capability when a stale catalog already lists the model without it', () => {
    setRuntimeRegistry({
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

    expect(getRegistryModelMeta('deepseek', 'deepseek-v4-flash-vision-exp')?.capabilities).toContain('vision')
  })
})
