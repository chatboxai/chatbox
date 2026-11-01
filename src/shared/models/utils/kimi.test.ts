import { describe, expect, it } from 'vitest'
import { isKimiFixedSamplingModel } from './kimi'

describe('isKimiFixedSamplingModel', () => {
  const fixedModels = [
    'kimi-k3',
    'kimi-k2.5',
    'kimi-k2.6',
    'kimi-k2.7-code',
    'kimi-k2.7-code-highspeed',
    'kimi-k2-thinking',
    'kimi-k2-0905',
    'kimi-k2-turbo-preview',
    'moonshotai/kimi-k3',
    'moonshotai/Kimi-K2.6',
    'moonshotai/Kimi-K2.7-Code',
    '~moonshotai/kimi-latest',
  ]

  const freeModels = ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'gpt-4o', 'deepseek-chat', 'kimi']

  for (const modelId of fixedModels) {
    it(`pins sampling for ${modelId}`, () => {
      expect(isKimiFixedSamplingModel(modelId)).toBe(true)
    })
  }

  for (const modelId of freeModels) {
    it(`leaves sampling free for ${modelId}`, () => {
      expect(isKimiFixedSamplingModel(modelId)).toBe(false)
    })
  }

  it.each(['ollama', 'lm-studio'])('leaves sampling free for the %s local provider', (providerId) => {
    expect(isKimiFixedSamplingModel('kimi-k2:1t', providerId)).toBe(false)
  })
})
