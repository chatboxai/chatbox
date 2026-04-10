/**
 * BDD integration tests for tool-use conversation history.
 *
 * Verifies that multi-turn tool-use conversations work correctly with Claude API
 * using the AI SDK directly. Tests the exact ModelMessage format that
 * convertToModelMessages produces after the fix.
 *
 * 运行方式：
 * 1. 创建 .env 文件，添加 TEST_CLAUDE_API_KEY=your_claude_api_key
 * 2. pnpm test:model-provider
 */
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, type ModelMessage, type ToolCallPart, type ToolResultPart } from 'ai'
import { describe, expect, it } from 'vitest'

const CLAUDE_API_KEY = process.env.TEST_CLAUDE_API_KEY || ''
const TEST_MODEL = 'claude-haiku-4-5'

function claude() {
  return createAnthropic({
    apiKey: CLAUDE_API_KEY,
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
  }).languageModel(TEST_MODEL)
}

const calculatorTool = {
  calculator: {
    description: 'A simple calculator',
    parameters: { type: 'object' as const, properties: { expression: { type: 'string' as const } }, required: ['expression'] },
  },
}

/**
 * Single tool-call turn then follow-up:
 *   user → assistant(tool-call) → tool(result) → assistant(text) → user
 */
function buildSingleToolHistory(): ModelMessage[] {
  return [
    { role: 'system', content: 'You are a helpful assistant. Answer concisely.' },
    { role: 'user', content: [{ type: 'text', text: 'What is 2+2?' }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_001', toolName: 'calculator', input: { expression: '2+2' } } satisfies ToolCallPart,
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'call_001', toolName: 'calculator', output: { type: 'json', value: { result: 4 } } } satisfies ToolResultPart,
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'The answer is 4.' }] },
    { role: 'user', content: [{ type: 'text', text: 'Now what is 3+3?' }] },
  ]
}

/**
 * Multiple parallel tool calls in one assistant turn:
 *   user → assistant(tool-call x2) → tool(result x2) → assistant(text) → user
 */
function buildMultiToolHistory(): ModelMessage[] {
  return [
    { role: 'system', content: 'You are a helpful assistant. Answer concisely.' },
    { role: 'user', content: [{ type: 'text', text: 'What is 2+2 and 3+3?' }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_010', toolName: 'calculator', input: { expression: '2+2' } } satisfies ToolCallPart,
        { type: 'tool-call', toolCallId: 'call_011', toolName: 'calculator', input: { expression: '3+3' } } satisfies ToolCallPart,
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'call_010', toolName: 'calculator', output: { type: 'json', value: { result: 4 } } } satisfies ToolResultPart,
        { type: 'tool-result', toolCallId: 'call_011', toolName: 'calculator', output: { type: 'json', value: { result: 6 } } } satisfies ToolResultPart,
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: '2+2=4 and 3+3=6.' }] },
    { role: 'user', content: [{ type: 'text', text: 'What about 10+10?' }] },
  ]
}

/**
 * Mixed text + tool-call in one assistant message:
 *   user → assistant(text + tool-call) → tool(result) → assistant(text) → user
 */
function buildMixedContentHistory(): ModelMessage[] {
  return [
    { role: 'system', content: 'You are a helpful assistant. Answer concisely.' },
    { role: 'user', content: [{ type: 'text', text: 'What is 5+5?' }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me calculate that.' },
        { type: 'tool-call', toolCallId: 'call_020', toolName: 'calculator', input: { expression: '5+5' } } satisfies ToolCallPart,
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'call_020', toolName: 'calculator', output: { type: 'json', value: { result: 10 } } } satisfies ToolResultPart,
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: '5+5=10.' }] },
    { role: 'user', content: [{ type: 'text', text: 'And 7+7?' }] },
  ]
}

/**
 * Failed tool call with error-text output:
 *   user → assistant(tool-call) → tool(error-text) → assistant(text) → user
 */
function buildErrorToolHistory(): ModelMessage[] {
  return [
    { role: 'system', content: 'You are a helpful assistant. Answer concisely.' },
    { role: 'user', content: [{ type: 'text', text: 'Calculate 1/0' }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_030', toolName: 'calculator', input: { expression: '1/0' } } satisfies ToolCallPart,
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'call_030', toolName: 'calculator', output: { type: 'error-text', value: 'Division by zero error' } },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'The calculation failed due to division by zero.' }] },
    { role: 'user', content: [{ type: 'text', text: 'OK, then calculate 1+1 instead.' }] },
  ]
}

/**
 * Assistant message with only tool-call, no text (the original bug trigger):
 *   user → assistant(tool-call ONLY, no text) → tool(result) → user
 *
 * Before the fix, the empty assistant content caused "text content blocks must be non-empty".
 */
function buildToolCallOnlyHistory(): ModelMessage[] {
  return [
    { role: 'system', content: 'You are a helpful assistant. Answer concisely.' },
    { role: 'user', content: [{ type: 'text', text: 'What is 9+9?' }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_040', toolName: 'calculator', input: { expression: '9+9' } } satisfies ToolCallPart,
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'call_040', toolName: 'calculator', output: { type: 'json', value: { result: 18 } } } satisfies ToolResultPart,
      ],
    },
    { role: 'user', content: [{ type: 'text', text: 'Double that result.' }] },
  ]
}

describe.runIf(CLAUDE_API_KEY)('Claude tool-use conversation history', () => {
  describe('Given a conversation with a single completed tool call', () => {
    it('should continue the conversation after tool-use history', async () => {
      const result = await generateText({ model: claude(), messages: buildSingleToolHistory(), maxTokens: 256 })

      expect(result.text).toContain('6')
      expect(result.finishReason).toBe('stop')
    }, 30_000)
  })

  describe('Given a conversation with multiple parallel tool calls', () => {
    it('should handle multi-tool history and respond', async () => {
      const result = await generateText({ model: claude(), messages: buildMultiToolHistory(), maxTokens: 256 })

      expect(result.text).toContain('20')
      expect(result.finishReason).toBe('stop')
    }, 30_000)
  })

  describe('Given an assistant message mixing text with tool calls', () => {
    it('should accept mixed content without error', async () => {
      const result = await generateText({ model: claude(), messages: buildMixedContentHistory(), maxTokens: 256 })

      expect(result.text).toContain('14')
      expect(result.finishReason).toBe('stop')
    }, 30_000)
  })

  describe('Given a failed tool call with error-text in history', () => {
    it('should accept error-text results and continue', async () => {
      const result = await generateText({ model: claude(), messages: buildErrorToolHistory(), maxTokens: 256 })

      expect(result.text).toContain('2')
      expect(result.finishReason).toBe('stop')
    }, 30_000)
  })

  describe('Given an assistant message with ONLY tool-call (no text)', () => {
    it('should not fail with "text content blocks must be non-empty"', async () => {
      const result = await generateText({ model: claude(), messages: buildToolCallOnlyHistory(), maxTokens: 256 })

      expect(result.text).toBeTruthy()
      expect(result.finishReason).toBe('stop')
    }, 30_000)
  })
})
