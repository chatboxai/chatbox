import { describe, expect, it } from 'vitest'
import type { ProviderModelInfo } from '../types'
import { mergeProviderModelCapabilities } from './model-config'

describe('mergeProviderModelCapabilities', () => {
  const defaultModel: ProviderModelInfo = {
    modelId: 'deepseek-v4-flash',
    nickname: 'DeepSeek V4 Flash',
    capabilities: ['reasoning', 'tool_use'],
    contextWindow: 1_000_000,
    maxOutput: 384_000,
  }

  it('fills capability metadata missing from an older persisted model record', () => {
    expect(
      mergeProviderModelCapabilities(
        {
          modelId: 'deepseek-v4-flash',
          type: 'chat',
          contextWindow: 128_000,
        },
        defaultModel
      )
    ).toEqual({
      modelId: 'deepseek-v4-flash',
      type: 'chat',
      capabilities: ['reasoning', 'tool_use'],
      contextWindow: 128_000,
    })
  })

  it('preserves explicit user capability overrides', () => {
    const storedModel: ProviderModelInfo = {
      modelId: 'deepseek-v4-flash',
      capabilities: [],
      contextWindow: 128_000,
    }

    expect(mergeProviderModelCapabilities(storedModel, defaultModel)).toBe(storedModel)
  })

  it('leaves custom models without built-in defaults unchanged', () => {
    const customModel: ProviderModelInfo = { modelId: 'custom-model', capabilities: ['tool_use'] }

    expect(mergeProviderModelCapabilities(customModel, undefined)).toBe(customModel)
  })
})
