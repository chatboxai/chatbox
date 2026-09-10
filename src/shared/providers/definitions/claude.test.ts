import { describe, expect, it } from 'vitest'
import type { ModelDependencies } from '../../types/adapters'
import type { CreateModelConfig } from '../types'
import { claudeProvider } from './claude'
import type Claude from './models/claude'

function createModel(claudePromptCacheTTL?: '5m' | '1h'): Claude {
  return claudeProvider.createModel({
    settings: {
      provider: 'claude',
      modelId: 'claude-sonnet-4-5',
      claudePromptCacheTTL,
    },
    dependencies: { platformType: 'desktop' } as ModelDependencies,
    providerSetting: { apiKey: 'test-key' },
    formattedApiHost: 'https://api.anthropic.com/v1',
    model: { modelId: 'claude-sonnet-4-5' },
    effectiveApiKey: 'test-key',
  } as CreateModelConfig) as Claude
}

describe('Claude provider', () => {
  it('passes an explicit prompt cache TTL to the model', () => {
    expect(createModel('1h').options.promptCacheTTL).toBe('1h')
  })

  it('leaves prompt cache TTL unset for automatic behavior', () => {
    expect(createModel().options.promptCacheTTL).toBeUndefined()
  })
})
