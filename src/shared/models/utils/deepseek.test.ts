import { describe, expect, it } from 'vitest'
import type { MessageContentParts } from '../../types'
import {
  isDeepSeekReasoningEffortModel,
  isDeepSeekReasoningModel,
  isDeepSeekWeakToolUse,
  normalizeDeepSeekCompletedResponse,
  normalizeDeepSeekReasoningEffort,
} from './deepseek'

describe('isDeepSeekWeakToolUse', () => {
  const scopes = ['agent', 'web-browsing', 'read-file'] as const

  // Models that should be blocked for scoped tool use
  const weakModels = [
    // DeepSeek API
    'deepseek-chat',
    'deepseek-reasoner',
    // Generic / OpenAI-compatible
    'deepseek-v3',
    'deepseek-v3.1',
    'deepseek-v3.2',
    'deepseek-v3_2',
    'deepseek-r1',
    // VolcEngine (with date suffix)
    'deepseek-v3-250324',
    'deepseek-r1-250528',
    // SiliconFlow (with prefix)
    'deepseek-ai/DeepSeek-V3',
    'deepseek-ai/DeepSeek-V3.1',
    'deepseek-ai/DeepSeek-V3.2',
    'deepseek-ai/DeepSeek-V3.2-Exp',
    'deepseek-ai/DeepSeek-R1',
    // OpenRouter (with free suffix)
    'deepseek/deepseek-r1:free',
    'deepseek/deepseek-v3-base:free',
    'deepseek/deepseek-chat-v3-0324',
    'deepseek/deepseek-chat-v3.1',
    'deepseek/deepseek-v3.1-terminus',
    'deepseek/deepseek-v3.2',
    'deepseek/deepseek-v3.2-speciale',
  ]

  // Models that should NOT be blocked (improved tool use)
  const strongModels = [
    'deepseek-ai/DeepSeek-V4',
    'deepseek-ai/DeepSeek-V4.1',
    'deepseek/deepseek-v4',
    'deepseek/deepseek-v4.1',
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
    'deepseek-r1-distill-llama-70b',
    'deepseek-ai/deepseek-vl2',
  ]

  for (const model of weakModels) {
    for (const scope of scopes) {
      it(`blocks ${model} for ${scope}`, () => {
        expect(isDeepSeekWeakToolUse(model, scope)).toBe(true)
      })
    }
  }

  for (const model of strongModels) {
    for (const scope of scopes) {
      it(`allows ${model} for ${scope}`, () => {
        expect(isDeepSeekWeakToolUse(model, scope)).toBe(false)
      })
    }
  }

  it('returns false when no scope is provided', () => {
    expect(isDeepSeekWeakToolUse('deepseek-chat')).toBe(false)
  })

  it('returns false for non-scoped tool use (knowledge-base)', () => {
    expect(isDeepSeekWeakToolUse('deepseek-chat', 'knowledge-base')).toBe(false)
  })
})

describe('isDeepSeekReasoningModel', () => {
  // Reasoning/thinking-capable model ids per DeepSeek docs (V4-Flash/V4-Pro support a
  // thinking toggle; deepseek-reasoner is the legacy thinking alias) and provider variants.
  const reasoningModels = [
    'deepseek-flash',
    'deepseek/deepseek-flash',
    'deepseek-ai/DeepSeek-Flash',
    'deepseek-reasoner',
    'deepseek-r1',
    'deepseek-v3.2',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'deepseek-v4',
    'deepseek-v4.1',
    'deepseek-v4-250528',
    'deepseek-ai/DeepSeek-V4',
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-r1:free',
  ]

  // Non-reasoning ids: deepseek-chat is the legacy non-thinking alias; VL is a different family.
  const nonReasoningModels = ['deepseek-chat', 'deepseek-ai/deepseek-vl2', 'gpt-5.1', 'deepseek-flashlight']

  for (const model of reasoningModels) {
    it(`detects ${model} as a reasoning model`, () => {
      expect(isDeepSeekReasoningModel(model)).toBe(true)
    })
  }

  for (const model of nonReasoningModels) {
    it(`does not flag ${model} as a reasoning model`, () => {
      expect(isDeepSeekReasoningModel(model)).toBe(false)
    })
  }
})

describe('DeepSeek Flash reasoning effort', () => {
  it.each(['deepseek-flash', 'deepseek/deepseek-flash', 'deepseek-ai/DeepSeek-Flash', 'deepseek-v4.1-flash'])(
    'preserves supported effort values for %s',
    (modelId) => {
      expect(isDeepSeekReasoningEffortModel(modelId)).toBe(true)
      for (const effort of ['low', 'high', 'max', 'xhigh']) {
        expect(normalizeDeepSeekReasoningEffort(modelId, effort)).toBe(effort)
      }
      expect(normalizeDeepSeekReasoningEffort(modelId, 'medium')).toBeUndefined()
    }
  )

  it.each(['deepseek-flashlight', 'other-deepseek-flash', 'deepseek-chat', 'deepseek-v3.2'])(
    'does not enable effort for %s',
    (modelId) => {
      expect(isDeepSeekReasoningEffortModel(modelId)).toBe(false)
      expect(normalizeDeepSeekReasoningEffort(modelId, 'high')).toBeUndefined()
    }
  )
})

describe('normalizeDeepSeekCompletedResponse', () => {
  it('recovers a normally completed DeepSeek answer emitted only as reasoning', () => {
    const parts: MessageContentParts = [
      { type: 'reasoning', text: 'The answer was placed in the wrong channel.', startTime: 100, duration: 500 },
    ]

    expect(normalizeDeepSeekCompletedResponse(parts, 'stop', 'deepseek/deepseek-v4-pro')).toEqual([
      { type: 'text', text: 'The answer was placed in the wrong channel.' },
    ])
  })

  it('supports DeepSeek model ids used by OpenAI-compatible providers', () => {
    const parts: MessageContentParts = [{ type: 'reasoning', text: 'Recovered answer' }]

    expect(normalizeDeepSeekCompletedResponse(parts, 'stop', 'deepseek-v4-flash')).toEqual([
      { type: 'text', text: 'Recovered answer' },
    ])
  })

  it('does not promote length-limited reasoning', () => {
    const parts: MessageContentParts = [{ type: 'reasoning', text: 'Unfinished reasoning' }]

    expect(normalizeDeepSeekCompletedResponse(parts, 'length', 'deepseek-v4-pro')).toBe(parts)
  })

  it('does not change a normal reasoning and answer response', () => {
    const parts: MessageContentParts = [
      { type: 'reasoning', text: 'Reasoning' },
      { type: 'text', text: 'Final answer' },
    ]

    expect(normalizeDeepSeekCompletedResponse(parts, 'stop', 'deepseek-v4-pro')).toBe(parts)
  })

  it('does not change tool workflows or other model families', () => {
    const toolParts: MessageContentParts = [
      { type: 'reasoning', text: 'Preparing a tool call' },
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'tool-1',
        toolName: 'search',
        args: {},
        result: {},
      },
    ]
    const otherModelParts: MessageContentParts = [{ type: 'reasoning', text: 'Private reasoning' }]

    expect(normalizeDeepSeekCompletedResponse(toolParts, 'stop', 'deepseek-v4-pro')).toBe(toolParts)
    expect(normalizeDeepSeekCompletedResponse(otherModelParts, 'stop', 'qwen3.5')).toBe(otherModelParts)
  })
})
