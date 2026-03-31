import type { Message, MessageFile, MessageLink } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { analyzeTokenRequirements } from '../analyzer'
import { PRIORITY } from '../computation-queue'

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    contentParts: [{ type: 'text', text: 'Hello world' }],
    ...overrides,
  }
}

function createFile(overrides: Partial<MessageFile> = {}): MessageFile {
  return {
    id: 'file-1',
    name: 'test.txt',
    fileType: 'text/plain',
    storageKey: 'storage-key-1',
    lineCount: 100,
    byteLength: 1000,
    ...overrides,
  }
}

function createLink(overrides: Partial<MessageLink> = {}): MessageLink {
  return {
    id: 'link-1',
    url: 'https://example.com',
    title: 'Example',
    storageKey: 'storage-key-link-1',
    lineCount: 50,
    byteLength: 500,
    ...overrides,
  }
}

describe('analyzeTokenRequirements', () => {
  describe('empty input', () => {
    it('returns zeros when no messages provided', () => {
      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.currentInputTokens).toBe(0)
      expect(result.contextTokens).toBe(0)
      expect(result.pendingTasks).toHaveLength(0)
      expect(result.breakdown).toEqual({
        currentInput: { text: 0, attachments: 0 },
        context: { text: 0, attachments: 0 },
      })
    })
  })

  describe('message text analysis', () => {
    // Note: For constructedMessage (current input), tokens are ALWAYS calculated inline.
    // This is because constructedMessage only exists in React state, not in the store,
    // so async task execution would fail. Cache is ignored for current input.
    // 'Hello world' = 2 tokens (tiktoken), ~7 tokens (deepseek)

    it('calculates tokens inline for current input (ignores cache)', () => {
      const message = createMessage({
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
        updatedAt: 500,
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      // 'Hello world' = 2 tokens (tiktoken), cache value 100 is ignored
      expect(result.currentInputTokens).toBe(2)
      expect(result.pendingTasks).toHaveLength(0)
    })

    it('calculates tokens inline for current input without cache', () => {
      const message = createMessage({ id: 'msg-no-cache' })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      // 'Hello world' = 2 tokens, no pending task for text
      expect(result.currentInputTokens).toBe(2)
      expect(result.pendingTasks).toHaveLength(0)
    })

    it('uses correct tokenizer for current input calculation', () => {
      const message = createMessage({
        tokenCountMap: { default: 100, deepseek: 80 },
        tokenCalculatedAt: { default: 1000, deepseek: 1000 },
      })

      const defaultResult = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      const deepseekResult = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'deepseek',
        modelSupportToolUseForFile: false,
      })

      // 'Hello world' = 2 tokens (tiktoken), 7 tokens (deepseek)
      expect(defaultResult.currentInputTokens).toBe(2)
      expect(deepseekResult.currentInputTokens).toBe(7)
    })

    it('returns cached token count for context messages when valid', () => {
      const contextMsg = createMessage({
        id: 'context',
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
        updatedAt: 500,
      })

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: [contextMsg],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.contextTokens).toBe(100)
      expect(result.pendingTasks).toHaveLength(0)
    })

    it('returns 0 and creates task for context message when cache is stale', () => {
      const contextMsg = createMessage({
        id: 'msg-stale',
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 500 },
        updatedAt: 1000,
      })

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: [contextMsg],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.contextTokens).toBe(0)
      expect(result.pendingTasks).toHaveLength(1)
      expect(result.pendingTasks[0]).toMatchObject({
        type: 'message-text',
        messageId: 'msg-stale',
        tokenizerType: 'default',
        priority: PRIORITY.CONTEXT_TEXT,
      })
    })
  })

  describe('attachment analysis', () => {
    it('returns cached token count for files when valid', () => {
      const file = createFile({
        tokenCountMap: { default: 50 },
      })
      const message = createMessage({
        files: [file],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      // text: 2 (calculated inline), attachments: 50 (cached)
      expect(result.currentInputTokens).toBe(52)
      expect(result.breakdown.currentInput.text).toBe(2)
      expect(result.breakdown.currentInput.attachments).toBe(50)
      expect(result.pendingTasks).toHaveLength(0)
    })

    it('returns cached token count for links when valid', () => {
      const link = createLink({
        tokenCountMap: { default: 30 },
      })
      const message = createMessage({
        links: [link],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      // text: 2 (calculated inline), attachments: 30 (cached)
      expect(result.currentInputTokens).toBe(32)
      expect(result.breakdown.currentInput.attachments).toBe(30)
    })

    it('does not create task for current input attachment without cache', () => {
      const file = createFile({ id: 'file-no-cache' })
      const message = createMessage({
        id: 'msg-with-file',
        files: [file],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.breakdown.currentInput.attachments).toBe(0)
      expect(result.pendingTasks).toHaveLength(0)
    })

    it('skips attachments without storageKey', () => {
      const file = createFile({ storageKey: undefined })
      const message = createMessage({
        files: [file],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.pendingTasks).toHaveLength(0)
      expect(result.breakdown.currentInput.attachments).toBe(0)
    })
  })

  describe('preview mode for large files', () => {
    it('uses full mode when modelSupportToolUseForFile is false', () => {
      const file = createFile({
        id: 'large-file',
        lineCount: 1000,
      })
      const message = createMessage({
        id: 'msg-large',
        files: [file],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: [message],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.pendingTasks[0]).toMatchObject({
        contentMode: 'full',
      })
    })

    it('uses preview mode for large files when modelSupportToolUseForFile is true', () => {
      const file = createFile({
        id: 'large-file',
        lineCount: 1000,
      })
      const message = createMessage({
        id: 'msg-large',
        files: [file],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: [message],
        tokenizerType: 'default',
        modelSupportToolUseForFile: true,
      })

      expect(result.pendingTasks[0]).toMatchObject({
        contentMode: 'preview',
      })
    })

    it('uses full mode for small files even when modelSupportToolUseForFile is true', () => {
      const file = createFile({
        id: 'small-file',
        lineCount: 100,
      })
      const message = createMessage({
        id: 'msg-small',
        files: [file],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: [message],
        tokenizerType: 'default',
        modelSupportToolUseForFile: true,
      })

      expect(result.pendingTasks[0]).toMatchObject({
        contentMode: 'full',
      })
    })

    it('uses correct cache key for preview mode', () => {
      const file = createFile({
        lineCount: 1000,
        tokenCountMap: { default_preview: 20 },
      })
      const message = createMessage({
        files: [file],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: true,
      })

      expect(result.breakdown.currentInput.attachments).toBe(20)
      expect(result.pendingTasks).toHaveLength(0)
    })
  })

  describe('context messages', () => {
    it('analyzes context messages separately from current input', () => {
      const currentInput = createMessage({
        id: 'current',
        tokenCountMap: { default: 50 },
        tokenCalculatedAt: { default: 1000 },
      })
      const contextMsg = createMessage({
        id: 'context',
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: currentInput,
        contextMessages: [contextMsg],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      // currentInput: 2 (calculated inline), context: 100 (cached)
      expect(result.currentInputTokens).toBe(2)
      expect(result.contextTokens).toBe(100)
      expect(result.breakdown.currentInput.text).toBe(2)
      expect(result.breakdown.context.text).toBe(100)
    })

    it('sums tokens from multiple context messages', () => {
      const contextMsgs = [
        createMessage({ id: 'ctx-1', tokenCountMap: { default: 100 }, tokenCalculatedAt: { default: 1000 } }),
        createMessage({ id: 'ctx-2', tokenCountMap: { default: 200 }, tokenCalculatedAt: { default: 1000 } }),
        createMessage({ id: 'ctx-3', tokenCountMap: { default: 300 }, tokenCalculatedAt: { default: 1000 } }),
      ]

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: contextMsgs,
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.contextTokens).toBe(600)
    })

    it('creates tasks for context messages with stale cache', () => {
      const contextMsgs = [
        createMessage({ id: 'ctx-1', tokenCountMap: { default: 100 }, tokenCalculatedAt: { default: 1000 } }),
        createMessage({
          id: 'ctx-2',
          tokenCountMap: { default: 200 },
          tokenCalculatedAt: { default: 500 },
          updatedAt: 1000,
        }),
      ]

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: contextMsgs,
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.contextTokens).toBe(100)
      expect(result.pendingTasks).toHaveLength(1)
      expect(result.pendingTasks[0]).toMatchObject({
        messageId: 'ctx-2',
        priority: PRIORITY.CONTEXT_TEXT + 0, // ctx-2 is newest (index 1 of 2), reversed priority = 0
      })
    })
  })

  describe('priority assignment', () => {
    it('does not create text task for current input (calculated inline)', () => {
      const message = createMessage({ id: 'current' })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.pendingTasks).toHaveLength(0)
      expect(result.currentInputTokens).toBe(2)
    })

    it('does not enqueue attachment work for current input attachments', () => {
      const file = createFile()
      const message = createMessage({
        id: 'current',
        files: [file],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.pendingTasks).toHaveLength(0)
      expect(result.breakdown.currentInput.attachments).toBe(0)
    })

    it('assigns CONTEXT_TEXT + reversed index priority for context text (newest first)', () => {
      const contextMsgs = [
        createMessage({ id: 'ctx-0' }), // oldest, index 0, reversed = 2
        createMessage({ id: 'ctx-1' }), // index 1, reversed = 1
        createMessage({ id: 'ctx-2' }), // newest, index 2, reversed = 0
      ]

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: contextMsgs,
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      expect(result.pendingTasks[0].priority).toBe(PRIORITY.CONTEXT_TEXT + 2)
      expect(result.pendingTasks[1].priority).toBe(PRIORITY.CONTEXT_TEXT + 1)
      expect(result.pendingTasks[2].priority).toBe(PRIORITY.CONTEXT_TEXT + 0)
    })

    it('assigns CONTEXT_ATTACHMENT + reversed index priority for context attachments (newest first)', () => {
      const contextMsgs = [
        createMessage({
          id: 'ctx-0',
          files: [createFile({ id: 'f0' })],
          tokenCountMap: { default: 10 },
          tokenCalculatedAt: { default: 1000 },
        }),
        createMessage({
          id: 'ctx-1',
          files: [createFile({ id: 'f1' })],
          tokenCountMap: { default: 10 },
          tokenCalculatedAt: { default: 1000 },
        }),
      ]

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: contextMsgs,
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      const attachmentTasks = result.pendingTasks.filter((t) => t.type === 'attachment')
      expect(attachmentTasks[0].priority).toBe(PRIORITY.CONTEXT_ATTACHMENT + 1) // ctx-0 oldest
      expect(attachmentTasks[1].priority).toBe(PRIORITY.CONTEXT_ATTACHMENT + 0) // ctx-1 newest
    })
  })

  describe('mixed scenarios', () => {
    it('handles message with both files and links', () => {
      const file = createFile({ id: 'file-1', tokenCountMap: { default: 30 } })
      const link = createLink({ id: 'link-1', tokenCountMap: { default: 20 } })
      const message = createMessage({
        files: [file],
        links: [link],
        tokenCountMap: { default: 10 },
        tokenCalculatedAt: { default: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      // text: 2 (inline), attachments: 50 (30 + 20)
      expect(result.currentInputTokens).toBe(52)
      expect(result.breakdown.currentInput.text).toBe(2)
      expect(result.breakdown.currentInput.attachments).toBe(50)
    })

    it('handles complex scenario with current input and context', () => {
      const currentInput = createMessage({
        id: 'current',
        files: [createFile({ id: 'cf1', tokenCountMap: { default: 20 } })],
        tokenCountMap: { default: 30 },
        tokenCalculatedAt: { default: 1000 },
      })

      const contextMsgs = [
        createMessage({
          id: 'ctx-0',
          files: [createFile({ id: 'ctxf0' })],
          tokenCountMap: { default: 100 },
          tokenCalculatedAt: { default: 1000 },
        }),
        createMessage({
          id: 'ctx-1',
          links: [createLink({ id: 'ctxl1', tokenCountMap: { default: 40 } })],
          tokenCountMap: { default: 200 },
          tokenCalculatedAt: { default: 1000 },
        }),
      ]

      const result = analyzeTokenRequirements({
        constructedMessage: currentInput,
        contextMessages: contextMsgs,
        tokenizerType: 'default',
        modelSupportToolUseForFile: false,
      })

      // currentInput: text 2 (inline) + attachment 20 = 22
      // context: (100 + 0) + (200 + 40) = 340
      expect(result.currentInputTokens).toBe(22)
      expect(result.contextTokens).toBe(340)
      expect(result.pendingTasks).toHaveLength(1)
      expect(result.pendingTasks[0]).toMatchObject({
        type: 'attachment',
        attachmentId: 'ctxf0',
      })
    })
  })

  describe('deepseek tokenizer', () => {
    it('uses deepseek tokenizer for current input calculation', () => {
      const message = createMessage({
        tokenCountMap: { default: 100, deepseek: 80 },
        tokenCalculatedAt: { default: 1000, deepseek: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'deepseek',
        modelSupportToolUseForFile: false,
      })

      // 'Hello world' with deepseek tokenizer = 7 tokens
      expect(result.currentInputTokens).toBe(7)
    })

    it('uses deepseek cache key for context messages', () => {
      const contextMsg = createMessage({
        id: 'context',
        tokenCountMap: { default: 100, deepseek: 80 },
        tokenCalculatedAt: { default: 1000, deepseek: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: [contextMsg],
        tokenizerType: 'deepseek',
        modelSupportToolUseForFile: false,
      })

      expect(result.contextTokens).toBe(80)
      expect(result.pendingTasks).toHaveLength(0)
    })

    it('creates task for context message without deepseek cache', () => {
      const contextMsg = createMessage({ id: 'msg-ds' })

      const result = analyzeTokenRequirements({
        constructedMessage: undefined,
        contextMessages: [contextMsg],
        tokenizerType: 'deepseek',
        modelSupportToolUseForFile: false,
      })

      expect(result.pendingTasks[0]).toMatchObject({
        tokenizerType: 'deepseek',
      })
    })

    it('uses deepseek_preview cache key for large files', () => {
      const file = createFile({
        lineCount: 1000,
        tokenCountMap: { deepseek_preview: 15 },
      })
      const message = createMessage({
        files: [file],
        tokenCountMap: { deepseek: 10 },
        tokenCalculatedAt: { deepseek: 1000 },
      })

      const result = analyzeTokenRequirements({
        constructedMessage: message,
        contextMessages: [],
        tokenizerType: 'deepseek',
        modelSupportToolUseForFile: true,
      })

      expect(result.breakdown.currentInput.attachments).toBe(15)
      expect(result.pendingTasks).toHaveLength(0)
    })
  })
})
