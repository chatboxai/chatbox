import { describe, expect, it } from 'vitest'
import { deepseekProvider } from './deepseek'

describe('deepseekProvider', () => {
  it('uses the current V4 models as curated defaults', () => {
    expect(deepseekProvider.curatedModelIds).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(deepseekProvider.defaultSettings?.models).toEqual([
      {
        modelId: 'deepseek-v4-flash',
        nickname: 'DeepSeek V4 Flash',
        contextWindow: 1_000_000,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        contextWindow: 1_000_000,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      { modelId: 'deepseek-asr', nickname: 'DeepSeek ASR', type: 'transcription' },
    ])
  })
})
