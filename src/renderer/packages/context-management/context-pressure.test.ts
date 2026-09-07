import type { Message } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMPACTION_THRESHOLD, OUTPUT_RESERVE_TOKENS } from './compaction-detector'
import { assessContextPressure, TOOL_RESULT_STUB_PRESSURE_RATIO } from './context-pressure'

vi.mock('../model-registry', () => ({
  getModelContextWindowSync: vi.fn((modelId: string) => (modelId === 'known-model' ? 128_000 : null)),
}))

function messageWithToolResult(id: string, resultChars: number): Message {
  return {
    id,
    role: 'assistant',
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: `tc-${id}`,
        toolName: 'search',
        args: {},
        result: 'r'.repeat(resultChars),
      },
    ],
  }
}

describe('assessContextPressure', () => {
  const threshold = Math.floor((128_000 - OUTPUT_RESERVE_TOKENS) * DEFAULT_COMPACTION_THRESHOLD)

  it('keeps everything below the stub ratio', () => {
    const result = assessContextPressure({
      contextMessages: [messageWithToolResult('m1', 1000)],
      providerId: 'openai',
      modelId: 'known-model',
    })

    expect(result.thresholdTokens).toBe(threshold)
    expect(result.toolCleanupMode).toBe('none')
  })

  it('activates stubbing at the pressure ratio, driven by tool-call weight', () => {
    // Tool tokens ≈ chars/4; push past ratio × threshold with a huge result.
    const charsNeeded = Math.ceil(threshold * TOOL_RESULT_STUB_PRESSURE_RATIO * 4) + 4000
    const result = assessContextPressure({
      contextMessages: [messageWithToolResult('m1', charsNeeded)],
      providerId: 'openai',
      modelId: 'known-model',
    })

    expect(result.toolCleanupMode).toBe('stub-old-results')
    expect(result.contextTokens).toBeGreaterThan(Math.floor(threshold * TOOL_RESULT_STUB_PRESSURE_RATIO))
  })

  it('returns none with a null threshold when no model is known', () => {
    const result = assessContextPressure({
      contextMessages: [messageWithToolResult('m1', 1_000_000)],
    })

    expect(result.thresholdTokens).toBeNull()
    expect(result.toolCleanupMode).toBe('none')
  })
})
