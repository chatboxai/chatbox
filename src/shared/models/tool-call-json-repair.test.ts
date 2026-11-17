import type { LanguageModelV4ToolCall } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import { repairToolCallJsonInput } from './tool-call-json-repair'

function toolCall(input: string): LanguageModelV4ToolCall {
  return {
    type: 'tool-call',
    toolCallId: 'tc1',
    toolName: 'code_execution',
    input,
  }
}

describe('repairToolCallJsonInput', () => {
  it('repairs partial JSON input without mutating the original tool call', async () => {
    const original = toolCall('{"code":"console.log(1)",')
    const repaired = await repairToolCallJsonInput(original)

    expect(original.input).toBe('{"code":"console.log(1)",')
    expect(repaired).toMatchObject({
      toolCallId: 'tc1',
      toolName: 'code_execution',
      input: '{"code":"console.log(1)"}',
    })
  })

  it('repairs JSON wrapped in a markdown code fence', async () => {
    const repaired = await repairToolCallJsonInput(toolCall('```json\n{"code":"console.log(1)",}\n```'))

    expect(repaired?.input).toBe('{"code":"console.log(1)"}')
  })

  it('extracts JSON object from surrounding text', async () => {
    const repaired = await repairToolCallJsonInput(toolCall('Use this: {"code":"console.log(1)"} thanks'))

    expect(repaired?.input).toBe('{"code":"console.log(1)"}')
  })

  it('returns null when the input cannot be repaired into an object', async () => {
    await expect(repairToolCallJsonInput(toolCall('not json'))).resolves.toBeNull()
  })
})
