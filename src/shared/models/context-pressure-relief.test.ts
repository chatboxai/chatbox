import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { createMidRunToolResultRelief } from './context-pressure-relief'

function userMessage(text: string): ModelMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistantToolCall(id: string): ModelMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: id, toolName: 'search', input: { q: id } }],
  }
}

function toolResult(id: string, size: number): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: id,
        toolName: 'search',
        output: { type: 'text', value: 'r'.repeat(size) },
      },
    ],
  }
}

function toolError(id: string): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: id,
        toolName: 'search',
        output: { type: 'error-text', value: 'failed'.repeat(200) },
      },
    ],
  }
}

function outputOf(message: ModelMessage): { type: string; value?: unknown } {
  const content = message.content as Array<{ type: string; output: { type: string; value?: unknown } }>
  return content[0].output
}

describe('createMidRunToolResultRelief', () => {
  it('returns undefined while below the activation threshold', () => {
    const relief = createMidRunToolResultRelief({ thresholdTokens: 1_000_000 })
    const messages = [userMessage('hi'), assistantToolCall('t1'), toolResult('t1', 5000)]

    expect(relief(messages)).toBeUndefined()
  })

  it('stubs old tool results but keeps the most recent ones and all calls', () => {
    // ~4 chars/token: three 40k-char results ≈ 30k tokens. Threshold 25k
    // (activation 22.5k): stubbing the oldest result (saving ≈10k) brings the
    // estimate under activation, so the protected pair survives intact.
    const relief = createMidRunToolResultRelief({ thresholdTokens: 25_000 })
    const messages = [
      userMessage('task'),
      assistantToolCall('t1'),
      toolResult('t1', 40_000),
      assistantToolCall('t2'),
      toolResult('t2', 40_000),
      assistantToolCall('t3'),
      toolResult('t3', 40_000),
    ]

    const relieved = relief(messages)
    expect(relieved).toBeDefined()
    const result = relieved as ModelMessage[]

    // Oldest result stubbed, last two kept
    expect(outputOf(result[2]).value).toContain('cleared')
    expect(outputOf(result[4]).value).toBe('r'.repeat(40_000))
    expect(outputOf(result[6]).value).toBe('r'.repeat(40_000))
    // Assistant tool calls untouched
    expect(result[1]).toBe(messages[1])
    expect(result[3]).toBe(messages[3])
  })

  it('holds the watermark while post-relief pressure stays below threshold', () => {
    // raw ≈ 30k tokens; activation = 32k × 0.9 = 28.8k. The first ratchet stubs
    // t1 (saving ≈10k), bringing the effective estimate to ≈20k — below
    // activation — so following steps reuse the same stable prefix instead of
    // stubbing one more result per step (which would bust the provider cache).
    const relief = createMidRunToolResultRelief({ thresholdTokens: 32_000 })
    const base = [
      userMessage('task'),
      assistantToolCall('t1'),
      toolResult('t1', 40_000),
      assistantToolCall('t2'),
      toolResult('t2', 40_000),
      assistantToolCall('t3'),
      toolResult('t3', 40_000),
    ]
    const first = relief(base)
    expect(first).toBeDefined()
    expect(outputOf((first as ModelMessage[])[2]).value).toContain('cleared')
    expect(outputOf((first as ModelMessage[])[4]).value).toBe('r'.repeat(40_000))

    const grown = [...base, assistantToolCall('t4'), toolResult('t4', 400)]
    const second = relief(grown)
    expect(second).toBeDefined()
    const result = second as ModelMessage[]
    expect(outputOf(result[2]).value).toContain('cleared')
    expect(outputOf(result[4]).value).toBe('r'.repeat(40_000))
    expect(outputOf(result[6]).value).toBe('r'.repeat(40_000))
  })

  it('advances the watermark and shrinks protection while pressure stays over threshold', () => {
    // threshold 10k: even after stubbing everything but the newest result the
    // estimate stays high, so the ratchet walks forward to the floor of 1 —
    // only the newest tool result (what the model just asked for) survives.
    const relief = createMidRunToolResultRelief({ thresholdTokens: 10_000 })
    const base = [
      userMessage('task'),
      assistantToolCall('t1'),
      toolResult('t1', 40_000),
      assistantToolCall('t2'),
      toolResult('t2', 40_000),
      assistantToolCall('t3'),
      toolResult('t3', 40_000),
    ]
    relief(base)

    const grown = [...base, assistantToolCall('t4'), toolResult('t4', 40_000)]
    const second = relief(grown) as ModelMessage[]
    expect(outputOf(second[2]).value).toContain('cleared')
    expect(outputOf(second[4]).value).toContain('cleared')
    expect(outputOf(second[6]).value).toContain('cleared')
    // Floor: the newest tool result stays intact
    expect(outputOf(second[8]).value).toBe('r'.repeat(40_000))
  })

  it('shrinks the protected tail when the newest results alone pin the payload over threshold', () => {
    // Two giant recent results (~50k tokens each) with keepRecent=2: nothing
    // older to stub, so protection must shrink — the second-newest result gets
    // stubbed while the newest (what the model just asked for) stays intact.
    const relief = createMidRunToolResultRelief({ thresholdTokens: 10_000 })
    const messages = [
      userMessage('task'),
      assistantToolCall('t1'),
      toolResult('t1', 200_000),
      assistantToolCall('t2'),
      toolResult('t2', 200_000),
    ]

    const relieved = relief(messages)
    expect(relieved).toBeDefined()
    const result = relieved as ModelMessage[]
    expect(outputOf(result[2]).value).toContain('cleared')
    expect(outputOf(result[4]).value).toBe('r'.repeat(200_000))
  })

  it('never stubs the newest tool result even under extreme pressure', () => {
    const relief = createMidRunToolResultRelief({ thresholdTokens: 100 })
    const messages = [userMessage('task'), assistantToolCall('t1'), toolResult('t1', 400_000)]

    // A single giant result cannot be relieved: the model needs the result it
    // just requested, so the relief layer leaves it alone.
    expect(relief(messages)).toBeUndefined()
  })

  it('never rewrites error outputs', () => {
    const relief = createMidRunToolResultRelief({ thresholdTokens: 100 })
    const messages = [
      userMessage('task'),
      assistantToolCall('t1'),
      toolError('t1'),
      assistantToolCall('t2'),
      toolResult('t2', 40_000),
      assistantToolCall('t3'),
      toolResult('t3', 40_000),
      assistantToolCall('t4'),
      toolResult('t4', 40_000),
    ]

    const relieved = relief(messages)
    expect(relieved).toBeDefined()
    expect(outputOf((relieved as ModelMessage[])[2]).type).toBe('error-text')
  })
})
