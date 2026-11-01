import { jsonSchema, type ModelMessage, type ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import { createModelMessageTokenCounter } from './mid-run-compaction'
import { estimateRequestOverheadTokens, estimateToolDefinitionTokens } from './request-overhead'

const countText = (text: string) => text.length
const countMessage = createModelMessageTokenCounter(countText)

const tools = {
  read_file: {
    description: 'Read a file',
    inputSchema: jsonSchema({ type: 'object', properties: { path: { type: 'string' } } }),
  },
} as unknown as ToolSet

function sessionSystem(text: string): Message {
  return { id: 'system', role: 'system', contentParts: [{ type: 'text', text }] }
}

describe('request overhead', () => {
  it('counts each tool as its name, description and input schema', async () => {
    const expected = JSON.stringify({
      name: 'read_file',
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    }).length
    await expect(estimateToolDefinitionTokens(tools, countText)).resolves.toBe(expected)
  })

  it('separates tool definitions from the system instructions the session history does not account for', async () => {
    const requestMessages: ModelMessage[] = [
      { role: 'system', content: 'You are helpful.\n\nAgent instructions' },
      { role: 'user', content: 'task' },
    ]
    const toolTokens = await estimateToolDefinitionTokens(tools, countText)
    const requestSystem = countMessage(requestMessages[0])

    await expect(
      estimateRequestOverheadTokens({
        tools,
        requestMessages,
        historyMessages: [sessionSystem('You are helpful.')],
        countText,
        countMessage,
      })
    ).resolves.toEqual({ toolTokens, extraSystemTokens: requestSystem - 'You are helpful.'.length })
  })

  it('never lets a session system prompt the request omits reduce the overhead below the tools', async () => {
    await expect(
      estimateRequestOverheadTokens({
        tools,
        requestMessages: [{ role: 'user', content: 'task' }],
        historyMessages: [sessionSystem('A long session prompt that agent mode replaces')],
        countText,
        countMessage,
      })
    ).resolves.toEqual({ toolTokens: await estimateToolDefinitionTokens(tools, countText), extraSystemTokens: 0 })
  })
})
