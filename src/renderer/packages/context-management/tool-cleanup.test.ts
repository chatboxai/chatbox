import type { Message, MessageContentParts } from '@shared/types'
import { MessageRoleEnum } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { cleanToolCalls } from './tool-cleanup'

function createMessage(
  role: (typeof MessageRoleEnum)[keyof typeof MessageRoleEnum],
  contentParts: MessageContentParts = []
): Message {
  return {
    id: `msg-${Math.random().toString(36).substr(2, 9)}`,
    role,
    contentParts,
  }
}

function createTextPart(text: string) {
  return { type: 'text' as const, text }
}

function createToolCallPart(toolName: string, state: 'call' | 'result' | 'error' = 'result') {
  return {
    type: 'tool-call' as const,
    state,
    toolCallId: `call-${Math.random().toString(36).substr(2, 9)}`,
    toolName,
    args: { query: 'test' },
    result: state === 'result' ? { data: 'test result' } : undefined,
  }
}

function createAppPart(lifecycle: 'launching' | 'ready' | 'active' | 'complete' | 'error' | 'stale') {
  return {
    type: 'app' as const,
    appId: 'story-builder',
    appName: 'Story Builder',
    appInstanceId: `app-${Math.random().toString(36).substr(2, 9)}`,
    lifecycle,
    summary: `Story Builder lifecycle: ${lifecycle}`,
  }
}

describe('cleanToolCalls', () => {
  describe('basic functionality', () => {
    it('should return empty array for empty input', () => {
      const result = cleanToolCalls([])
      expect(result).toEqual([])
    })

    it('should return shallow copies when no messages need cleaning', () => {
      const messages = [
        createMessage('user', [createTextPart('Hello')]),
        createMessage('assistant', [createTextPart('Hi there')]),
      ]
      const result = cleanToolCalls(messages, 2)

      expect(result).toHaveLength(2)
      expect(result[0]).not.toBe(messages[0])
      expect(result[0]).toEqual(messages[0])
    })

    it('should not mutate original messages', () => {
      const toolCallPart = createToolCallPart('search')
      const originalParts = [createTextPart('Result:'), toolCallPart]
      const messages = [
        createMessage('user', [createTextPart('Search for X')]),
        createMessage('assistant', [...originalParts]),
        createMessage('user', [createTextPart('Thanks')]),
        createMessage('assistant', [createTextPart('Welcome')]),
        createMessage('user', [createTextPart('Another')]),
        createMessage('assistant', [createTextPart('Response')]),
      ]

      const originalFirstAssistantParts = [...messages[1].contentParts]
      cleanToolCalls(messages, 2)

      expect(messages[1].contentParts).toEqual(originalFirstAssistantParts)
    })
  })

  describe('round counting', () => {
    it('should keep all messages when keepRounds >= total rounds', () => {
      const messages = [
        createMessage('user', [createTextPart('Q1')]),
        createMessage('assistant', [createToolCallPart('tool1')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createToolCallPart('tool2')]),
      ]

      const result = cleanToolCalls(messages, 5)

      expect(result[1].contentParts).toHaveLength(1)
      expect(result[1].contentParts[0].type).toBe('tool-call')
      expect(result[3].contentParts).toHaveLength(1)
      expect(result[3].contentParts[0].type).toBe('tool-call')
    })

    it('should clean tool calls from messages before keepRounds', () => {
      const messages = [
        createMessage('user', [createTextPart('Q1')]),
        createMessage('assistant', [createTextPart('A1'), createToolCallPart('old_tool')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createTextPart('A2'), createToolCallPart('recent_tool')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].contentParts).toHaveLength(1)
      expect(result[1].contentParts[0].type).toBe('text')
      expect(result[3].contentParts).toHaveLength(2)
      expect(result[3].contentParts[1].type).toBe('tool-call')
    })

    it('should handle keepRounds = 0 (clean all tool calls)', () => {
      const messages = [
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [createToolCallPart('tool')]),
      ]

      const result = cleanToolCalls(messages, 0)

      expect(result[1].contentParts).toHaveLength(0)
    })

    it('should handle negative keepRounds as keep all', () => {
      const messages = [
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [createToolCallPart('tool')]),
      ]

      const result = cleanToolCalls(messages, -1)

      expect(result[1].contentParts).toHaveLength(1)
      expect(result[1].contentParts[0].type).toBe('tool-call')
    })
  })

  describe('message role handling', () => {
    it('should ignore system messages when counting rounds', () => {
      const messages = [
        createMessage('system', [createTextPart('System prompt')]),
        createMessage('user', [createTextPart('Q1')]),
        createMessage('assistant', [createToolCallPart('tool1')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createToolCallPart('tool2')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[2].contentParts).toHaveLength(0)
      expect(result[4].contentParts).toHaveLength(1)
      expect(result[4].contentParts[0].type).toBe('tool-call')
    })

    it('should ignore tool-role messages when counting rounds', () => {
      const messages = [
        createMessage('user', [createTextPart('Q1')]),
        createMessage('assistant', [createToolCallPart('tool1')]),
        createMessage('tool', [createTextPart('Tool response')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createToolCallPart('tool2')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].contentParts).toHaveLength(0)
      expect(result[4].contentParts).toHaveLength(1)
    })

    it('should handle consecutive user or assistant messages', () => {
      const messages = [
        createMessage('user', [createTextPart('Q1')]),
        createMessage('user', [createTextPart('Q1 continued')]),
        createMessage('assistant', [createToolCallPart('tool1')]),
        createMessage('assistant', [createToolCallPart('tool1b')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createToolCallPart('tool2')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[2].contentParts).toHaveLength(0)
      expect(result[3].contentParts).toHaveLength(0)
      expect(result[5].contentParts).toHaveLength(1)
    })
  })

  describe('content part filtering', () => {
    it('should preserve text parts while removing tool-call parts', () => {
      const messages = [
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [
          createTextPart('Let me search'),
          createToolCallPart('search'),
          createTextPart('Found it'),
        ]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createTextPart('OK')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].contentParts).toHaveLength(2)
      expect(result[1].contentParts.every((p) => p.type === 'text')).toBe(true)
    })

    it('should preserve image parts while removing tool-call parts', () => {
      const imagePart = { type: 'image' as const, storageKey: 'key-123' }
      const messages = [
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [imagePart, createToolCallPart('tool')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createTextPart('OK')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].contentParts).toHaveLength(1)
      expect(result[1].contentParts[0].type).toBe('image')
    })

    it('should preserve reasoning parts while removing tool-call parts', () => {
      const reasoningPart = { type: 'reasoning' as const, text: 'Thinking...', duration: 1000 }
      const messages = [
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [reasoningPart, createToolCallPart('tool')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createTextPart('OK')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].contentParts).toHaveLength(1)
      expect(result[1].contentParts[0].type).toBe('reasoning')
    })

    it('should preserve info parts while removing tool-call parts', () => {
      const infoPart = { type: 'info' as const, text: 'status.loading' }
      const messages = [
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [infoPart, createToolCallPart('tool')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createTextPart('OK')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].contentParts).toHaveLength(1)
      expect(result[1].contentParts[0].type).toBe('info')
    })

    it('should preserve app parts while removing tool-call parts', () => {
      const appPart = createAppPart('active')
      const messages = [
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [appPart, createToolCallPart('tool')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createTextPart('OK')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].contentParts).toHaveLength(1)
      expect(result[1].contentParts[0]).toMatchObject({
        type: 'app',
        appId: 'story-builder',
        lifecycle: 'active',
      })
    })

    it('should handle messages with empty contentParts', () => {
      const messages = [
        createMessage('user', []),
        createMessage('assistant', []),
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [createTextPart('A')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[0].contentParts).toHaveLength(0)
      expect(result[1].contentParts).toHaveLength(0)
    })

    it('should handle messages with only tool-call parts (results in empty)', () => {
      const messages = [
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [createToolCallPart('tool1'), createToolCallPart('tool2')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createTextPart('OK')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].contentParts).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('should handle single message', () => {
      const messages = [createMessage('user', [createTextPart('Hello')])]
      const result = cleanToolCalls(messages, 2)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(messages[0])
    })

    it('should handle only assistant messages (no complete rounds)', () => {
      const messages = [
        createMessage('assistant', [createToolCallPart('tool1')]),
        createMessage('assistant', [createToolCallPart('tool2')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[0].contentParts).toHaveLength(1)
      expect(result[1].contentParts).toHaveLength(1)
    })

    it('should handle only user messages (no complete rounds)', () => {
      const messages = [createMessage('user', [createTextPart('Q1')]), createMessage('user', [createTextPart('Q2')])]

      const result = cleanToolCalls(messages, 1)

      expect(result).toHaveLength(2)
    })

    it('should handle multiple tool-call states (call, result, error)', () => {
      const messages = [
        createMessage('user', [createTextPart('Q')]),
        createMessage('assistant', [
          createToolCallPart('tool', 'call'),
          createToolCallPart('tool', 'result'),
          createToolCallPart('tool', 'error'),
        ]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createTextPart('OK')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].contentParts).toHaveLength(0)
    })

    it('should use default keepRounds = 2 when not specified', () => {
      const messages = [
        createMessage('user', [createTextPart('Q1')]),
        createMessage('assistant', [createToolCallPart('tool1')]),
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createToolCallPart('tool2')]),
        createMessage('user', [createTextPart('Q3')]),
        createMessage('assistant', [createToolCallPart('tool3')]),
      ]

      const result = cleanToolCalls(messages)

      expect(result[1].contentParts).toHaveLength(0)
      expect(result[3].contentParts).toHaveLength(1)
      expect(result[5].contentParts).toHaveLength(1)
    })

    it('should preserve other message properties', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          role: MessageRoleEnum.User,
          contentParts: [createTextPart('Q')],
          model: 'gpt-4',
          timestamp: 1234567890,
        },
        {
          id: 'msg-2',
          role: MessageRoleEnum.Assistant,
          contentParts: [createToolCallPart('tool')],
          model: 'gpt-4',
          timestamp: 1234567891,
          usage: { inputTokens: 100, outputTokens: 50 },
        },
        createMessage('user', [createTextPart('Q2')]),
        createMessage('assistant', [createTextPart('OK')]),
      ]

      const result = cleanToolCalls(messages, 1)

      expect(result[1].id).toBe('msg-2')
      expect(result[1].model).toBe('gpt-4')
      expect(result[1].timestamp).toBe(1234567891)
      expect(result[1].usage).toEqual({ inputTokens: 100, outputTokens: 50 })
    })
  })
})
