import { describe, expect, it } from 'vitest'
import { deepseekProvider } from './deepseek'

describe('deepseekProvider', () => {
  it('uses the current DeepSeek models as curated defaults', () => {
    expect(deepseekProvider.curatedModelIds).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
    expect(deepseekProvider.defaultSettings?.models).toEqual([
      {
        modelId: 'deepseek-flash',
        nickname: 'DeepSeek Flash',
        capabilities: ['reasoning', 'tool_use', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 384_000,
      },
      {
        modelId: 'deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        contextWindow: 1_000_000,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
    ])
  })
})
