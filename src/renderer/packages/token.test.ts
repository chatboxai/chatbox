import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../../shared/types'
import { MessageRoleEnum } from '../../shared/types/session'
import {
  estimateTokens,
  estimateTokensFromMessages,
  estimateTokensFromMessagesForSendPayload,
  getAttachmentTokenCacheKey,
  getTokenCacheKey,
  getTokenCountForModel,
  isDeepSeekModel,
  sliceTextByTokenLimit,
  sumCachedTokensFromMessages,
} from './token'
import {
  estimateDraftTokensImmediately,
  LONG_DRAFT_TOKENIZATION_THRESHOLD,
  seedExactDraftTokens,
} from './token-estimation/draft-tokenization'

vi.mock('./token-estimation/tokenizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./token-estimation/tokenizer')>()
  return { ...actual, estimateTokens: vi.fn(actual.estimateTokens) }
})

// Helper to create test messages
function createMessage(overrides: Partial<Message> & { text?: string } = {}): Message {
  const { text, ...rest } = overrides
  return {
    id: `msg-${Math.random().toString(36).substr(2, 9)}`,
    role: MessageRoleEnum.User,
    contentParts: text ? [{ type: 'text', text }] : [],
    ...rest,
  }
}

// Model fixtures for testing
const deepSeekModel = { provider: 'deepseek', modelId: 'deepseek-chat' }
const openAIModel = { provider: 'openai', modelId: 'gpt-4o' }
const claudeModel = { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' }

describe('isDeepSeekModel', () => {
  it('should return true for DeepSeek models', () => {
    expect(isDeepSeekModel(deepSeekModel)).toBe(true)
    expect(isDeepSeekModel({ provider: 'custom', modelId: 'deepseek-coder' })).toBe(true)
    expect(isDeepSeekModel({ provider: 'any', modelId: 'DEEPSEEK-V3' })).toBe(true)
  })

  it('should return false for non-DeepSeek models', () => {
    expect(isDeepSeekModel(openAIModel)).toBe(false)
    expect(isDeepSeekModel(claudeModel)).toBe(false)
    expect(isDeepSeekModel({ provider: 'mistral', modelId: 'mistral-large' })).toBe(false)
  })

  it('should return false for undefined or null', () => {
    expect(isDeepSeekModel(undefined)).toBe(false)
    expect(isDeepSeekModel(null)).toBe(false)
  })

  it('should return false for models with undefined modelId', () => {
    expect(isDeepSeekModel({ provider: 'test', modelId: '' })).toBe(false)
  })
})

describe('getTokenCacheKey', () => {
  it('should return deepseek for DeepSeek models', () => {
    expect(getTokenCacheKey(deepSeekModel)).toBe('deepseek')
    expect(getTokenCacheKey({ provider: 'custom', modelId: 'deepseek-coder' })).toBe('deepseek')
  })

  it('should return default for non-DeepSeek models', () => {
    expect(getTokenCacheKey(openAIModel)).toBe('default')
    expect(getTokenCacheKey(claudeModel)).toBe('default')
    expect(getTokenCacheKey(undefined)).toBe('default')
    expect(getTokenCacheKey(null)).toBe('default')
  })
})

describe('getTokenCountForModel', () => {
  it('should return correct token count for DeepSeek models', () => {
    const item = {
      tokenCountMap: {
        default: 100,
        deepseek: 80,
      },
    }
    expect(getTokenCountForModel(item, deepSeekModel)).toBe(80)
  })

  it('should return correct token count for non-DeepSeek models', () => {
    const item = {
      tokenCountMap: {
        default: 100,
        deepseek: 80,
      },
    }
    expect(getTokenCountForModel(item, openAIModel)).toBe(100)
  })

  it('should return 0 when tokenCountMap is undefined', () => {
    expect(getTokenCountForModel({}, openAIModel)).toBe(0)
    expect(getTokenCountForModel({}, deepSeekModel)).toBe(0)
  })

  it('should return 0 when specific cache key is missing', () => {
    const item = {
      tokenCountMap: {
        default: 100,
      },
    }
    expect(getTokenCountForModel(item, deepSeekModel)).toBe(0)
  })
})

describe('sumCachedTokensFromMessages', () => {
  it('should return 0 for empty messages array', () => {
    expect(sumCachedTokensFromMessages([])).toBe(0)
    expect(sumCachedTokensFromMessages([], deepSeekModel)).toBe(0)
  })

  it('should return 0 when messages have no cache', () => {
    const messages = [createMessage({ text: 'Hello' }), createMessage({ text: 'World' })]
    // 2 messages × 4 overhead (3 tokensPerMessage + 1 role token) = 8
    expect(sumCachedTokensFromMessages(messages)).toBe(8)
  })

  it('should return sum of tokenCount values', () => {
    const messages = [
      createMessage({ text: 'Hello', tokenCount: 10 }),
      createMessage({ text: 'World', tokenCount: 15 }),
    ]
    // 10 + 15 + (2 messages × 4 overhead) = 25 + 8 = 33
    expect(sumCachedTokensFromMessages(messages)).toBe(33)
  })

  it('should return sum from default cache key in tokenCountMap', () => {
    const messages = [
      createMessage({
        text: 'Hello',
        tokenCountMap: { default: 20, deepseek: 16 },
      }),
      createMessage({
        text: 'World',
        tokenCountMap: { default: 30, deepseek: 24 },
      }),
    ]
    // 20 + 30 + (2 messages × 4 overhead) = 50 + 8 = 58
    expect(sumCachedTokensFromMessages(messages, openAIModel)).toBe(58)
  })

  it('should return sum from deepseek cache key in tokenCountMap', () => {
    const messages = [
      createMessage({
        text: 'Hello',
        tokenCountMap: { default: 20, deepseek: 16 },
      }),
      createMessage({
        text: 'World',
        tokenCountMap: { default: 30, deepseek: 24 },
      }),
    ]
    // 16 + 24 + (2 messages × 5 overhead: 3 tokensPerMessage + 2 DeepSeek role "user" tokens) = 40 + 10 = 50
    expect(sumCachedTokensFromMessages(messages, deepSeekModel)).toBe(50)
  })

  it('should handle mixed scenario with some messages having cache and some not', () => {
    const messages = [
      createMessage({ text: 'Hello', tokenCount: 10 }),
      createMessage({ text: 'World' }),
      createMessage({
        text: 'Test',
        tokenCountMap: { default: 25, deepseek: 20 },
      }),
    ]
    // 10 + 0 + 25 + (3 messages × 4 overhead) = 35 + 12 = 47
    expect(sumCachedTokensFromMessages(messages, openAIModel)).toBe(47)
  })

  it('should include file tokenCountMap values', () => {
    const messages = [
      createMessage({
        text: 'Check this file',
        tokenCount: 10,
        files: [
          {
            id: 'file1',
            name: 'document.txt',
            fileType: 'text/plain',
            tokenCountMap: { default: 500, deepseek: 400 },
          },
        ],
      }),
    ]
    // 10 + 500 + (1 message × 4 overhead) = 510 + 4 = 514
    expect(sumCachedTokensFromMessages(messages, openAIModel)).toBe(514)
  })

  it('should include link tokenCountMap values', () => {
    const messages = [
      createMessage({
        text: 'Check this link',
        tokenCount: 10,
        links: [
          {
            id: 'link1',
            url: 'https://example.com',
            title: 'Example',
            tokenCountMap: { default: 300, deepseek: 250 },
          },
        ],
      }),
    ]
    // 10 + 300 + (1 message × 4 overhead) = 310 + 4 = 314
    expect(sumCachedTokensFromMessages(messages, openAIModel)).toBe(314)
  })

  it('should skip empty messages', () => {
    const messages = [createMessage({ text: '', tokenCount: 10 }), createMessage({ text: 'Hello', tokenCount: 20 })]
    // Empty message skipped, only 20 + (1 message × 4 overhead) = 20 + 4 = 24
    expect(sumCachedTokensFromMessages(messages)).toBe(24)
  })

  it('should use DeepSeek cache key for files when model is DeepSeek', () => {
    const messages = [
      createMessage({
        text: 'Check this',
        files: [
          {
            id: 'file1',
            name: 'doc.txt',
            fileType: 'text/plain',
            tokenCountMap: { default: 500, deepseek: 400 },
          },
        ],
      }),
    ]
    const defaultTokens = sumCachedTokensFromMessages(messages, openAIModel)
    const deepSeekTokens = sumCachedTokensFromMessages(messages, deepSeekModel)
    // 500 + (1 message × 4 overhead) = 504
    expect(defaultTokens).toBe(504)
    // 400 + 3 (tokensPerMessage) + 2 (DeepSeek role "user" tokens) = 405
    expect(deepSeekTokens).toBe(405)
  })

  it('should use DeepSeek cache key for links when model is DeepSeek', () => {
    const messages = [
      createMessage({
        text: 'Check this',
        links: [
          {
            id: 'link1',
            url: 'https://example.com',
            title: 'Example',
            tokenCountMap: { default: 300, deepseek: 250 },
          },
        ],
      }),
    ]
    const defaultTokens = sumCachedTokensFromMessages(messages, openAIModel)
    const deepSeekTokens = sumCachedTokensFromMessages(messages, deepSeekModel)
    // 300 + (1 message × 4 overhead) = 304
    expect(defaultTokens).toBe(304)
    // 250 + 3 (tokensPerMessage) + 2 (DeepSeek role "user" tokens) = 255
    expect(deepSeekTokens).toBe(255)
  })

  it('should handle messages with multiple files and links', () => {
    const messages = [
      createMessage({
        text: 'Multiple attachments',
        tokenCount: 10,
        files: [
          {
            id: 'f1',
            name: 'a.txt',
            fileType: 'text/plain',
            tokenCountMap: { default: 100, deepseek: 80 },
          },
          {
            id: 'f2',
            name: 'b.txt',
            fileType: 'text/plain',
            tokenCountMap: { default: 150, deepseek: 120 },
          },
        ],
        links: [
          {
            id: 'l1',
            url: 'https://a.com',
            title: 'A',
            tokenCountMap: { default: 200, deepseek: 160 },
          },
        ],
      }),
    ]
    // 10 + 100 + 150 + 200 + (1 message × 4 overhead) = 460 + 4 = 464
    expect(sumCachedTokensFromMessages(messages, openAIModel)).toBe(464)
    // 10 + 80 + 120 + 160 + 3 (tokensPerMessage) + 2 (DeepSeek role "user" tokens) = 370 + 5 = 375
    expect(sumCachedTokensFromMessages(messages, deepSeekModel)).toBe(375)
  })

  it('should prefer tokenCountMap over tokenCount', () => {
    const messages = [
      createMessage({
        text: 'Hello',
        tokenCount: 10,
        tokenCountMap: { default: 20, deepseek: 16 },
      }),
    ]
    // 20 + (1 message × 4 overhead) = 24
    expect(sumCachedTokensFromMessages(messages, openAIModel)).toBe(24)
    // 16 + 3 (tokensPerMessage) + 2 (DeepSeek role "user" tokens) = 21
    expect(sumCachedTokensFromMessages(messages, deepSeekModel)).toBe(21)
  })

  it('should fall back to tokenCount when tokenCountMap cache key is missing', () => {
    const messages = [
      createMessage({
        text: 'Hello',
        tokenCount: 10,
        tokenCountMap: { default: 20 },
      }),
    ]
    // Falls back to tokenCount: 10 + 3 (tokensPerMessage) + 2 (DeepSeek role "user" tokens) = 15
    expect(sumCachedTokensFromMessages(messages, deepSeekModel)).toBe(15)
  })
})

describe('estimateTokens', () => {
  describe('default tokenizer (cl100k_base)', () => {
    it('should estimate tokens for English text', () => {
      const text = 'Hello, world!'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
      // "Hello, world!" is typically 4 tokens with cl100k_base
      expect(tokens).toBeLessThan(10)
    })

    it('should estimate tokens for longer English text', () => {
      const text = 'The quick brown fox jumps over the lazy dog.'
      const tokens = estimateTokens(text)
      // This sentence is typically around 10 tokens
      expect(tokens).toBeGreaterThan(5)
      expect(tokens).toBeLessThan(20)
    })

    it('should estimate tokens for Chinese text', () => {
      const text = '你好世界'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
      // Chinese characters typically use more tokens per character
      expect(tokens).toBeLessThan(20)
    })

    it('should estimate tokens for mixed English and Chinese text', () => {
      const text = 'Hello 你好 World 世界'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(30)
    })

    it('should handle empty string', () => {
      const tokens = estimateTokens('')
      expect(tokens).toBe(0)
    })

    it('should handle special characters', () => {
      const text = '!@#$%^&*()_+-={}[]|:;<>?,./'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should handle newlines and whitespace', () => {
      const text = 'Line 1\nLine 2\n\nLine 4'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should handle unicode emojis', () => {
      const text = 'Hello! 😀🎉🚀'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should handle large content', () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(100)
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(500)
    })

    it('should handle non-string input by converting to JSON', () => {
      const obj = { key: 'value', number: 123 }
      // @ts-expect-error - Testing runtime behavior with non-string input
      const tokens = estimateTokens(obj)
      expect(tokens).toBeGreaterThan(0)
    })
  })

  describe('DeepSeek tokenizer', () => {
    it('should use DeepSeek tokenizer for DeepSeek models', () => {
      const text = 'Hello, world!'
      const tokensDeepSeek = estimateTokens(text, deepSeekModel)
      expect(tokensDeepSeek).toBeGreaterThan(0)
      expect(typeof tokensDeepSeek).toBe('number')
    })

    it('should handle Chinese text with DeepSeek tokenizer', () => {
      const text = '你好世界'
      const tokens = estimateTokens(text, deepSeekModel)
      // Chinese chars are ~0.6 tokens each in DeepSeek
      // 4 chars * 0.6 = 2.4, ceil = 3
      expect(tokens).toBe(3)
    })

    it('should handle English text with DeepSeek tokenizer', () => {
      const text = 'Hello'
      const tokens = estimateTokens(text, deepSeekModel)
      expect(tokens).toBeGreaterThan(0)
      expect(typeof tokens).toBe('number')
    })

    it('should handle spaces correctly in DeepSeek tokenizer', () => {
      const text = 'a b c'
      const tokens = estimateTokens(text, deepSeekModel)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should collapse consecutive spaces in DeepSeek tokenizer', () => {
      const textWithConsecutiveSpaces = 'a  b'
      const textWithSingleSpaces = 'a b'
      const tokensConsecutive = estimateTokens(textWithConsecutiveSpaces, deepSeekModel)
      const tokensSingle = estimateTokens(textWithSingleSpaces, deepSeekModel)
      expect(tokensConsecutive).toBeLessThanOrEqual(tokensSingle + 1)
    })

    it('should handle mixed content in DeepSeek tokenizer', () => {
      const text = 'Hello 你好 123'
      const tokens = estimateTokens(text, deepSeekModel)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should handle special characters in DeepSeek tokenizer', () => {
      const text = '!@#$%'
      const tokens = estimateTokens(text, deepSeekModel)
      // Each symbol is 0.3 tokens: 5 * 0.3 = 1.5, ceil = 2
      expect(tokens).toBe(2)
    })

    it('should return minimum of 1 for empty input in DeepSeek tokenizer', () => {
      // Empty string still returns 1 (minimum)
      const tokens = estimateTokens('', deepSeekModel)
      expect(tokens).toBe(1)
    })
  })
})

describe('estimateTokensFromMessages', () => {
  it('should return 0 for empty message array', () => {
    expect(estimateTokensFromMessages([])).toBe(0)
  })

  it('should estimate tokens for single text message', () => {
    const messages = [createMessage({ text: 'Hello, how are you?' })]
    const tokens = estimateTokensFromMessages(messages)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should estimate tokens for multiple messages', () => {
    const messages = [
      createMessage({ text: 'Hello!', role: MessageRoleEnum.User }),
      createMessage({ text: 'Hi there! How can I help you today?', role: MessageRoleEnum.Assistant }),
    ]
    const tokens = estimateTokensFromMessages(messages)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should include tokensPerMessage overhead (3 tokens per message)', () => {
    const singleMessage = [createMessage({ text: 'Hi' })]
    const twoMessages = [createMessage({ text: 'Hi' }), createMessage({ text: 'Hi' })]

    const tokensSingle = estimateTokensFromMessages(singleMessage)
    const tokensDouble = estimateTokensFromMessages(twoMessages)

    // Each message adds 3 tokens overhead, so double should add ~3 more
    expect(tokensDouble - tokensSingle).toBeGreaterThanOrEqual(3)
  })

  it('should add tokens for message name if present', () => {
    const withoutName = [createMessage({ text: 'Hello' })]
    const withName = [createMessage({ text: 'Hello', name: 'user123' })]

    const tokensWithoutName = estimateTokensFromMessages(withoutName)
    const tokensWithName = estimateTokensFromMessages(withName)

    // Name adds token count + 1 extra token
    expect(tokensWithName).toBeGreaterThan(tokensWithoutName)
  })

  it('should skip empty messages', () => {
    const emptyMessage = createMessage({ text: '' })
    const nonEmptyMessage = createMessage({ text: 'Hello' })

    const tokensWithEmpty = estimateTokensFromMessages([emptyMessage, nonEmptyMessage])
    const tokensOnlyNonEmpty = estimateTokensFromMessages([nonEmptyMessage])

    // Empty message should be skipped, so token counts should be equal
    expect(tokensWithEmpty).toBe(tokensOnlyNonEmpty)
  })

  it('should include tokens from files', () => {
    const messageWithFile = createMessage({
      text: 'Check this file',
      files: [
        {
          id: 'file1',
          name: 'document.txt',
          fileType: 'text/plain',
          tokenCountMap: { default: 500, deepseek: 400 },
        },
      ],
    })
    const messageWithoutFile = createMessage({ text: 'Check this file' })

    const tokensWithFile = estimateTokensFromMessages([messageWithFile])
    const tokensWithoutFile = estimateTokensFromMessages([messageWithoutFile])

    expect(tokensWithFile).toBe(tokensWithoutFile + 500)
  })

  it('should include tokens from links', () => {
    const messageWithLink = createMessage({
      text: 'Check this link',
      links: [
        {
          id: 'link1',
          url: 'https://example.com',
          title: 'Example',
          tokenCountMap: { default: 300, deepseek: 250 },
        },
      ],
    })
    const messageWithoutLink = createMessage({ text: 'Check this link' })

    const tokensWithLink = estimateTokensFromMessages([messageWithLink])
    const tokensWithoutLink = estimateTokensFromMessages([messageWithoutLink])

    expect(tokensWithLink).toBe(tokensWithoutLink + 300)
  })

  it('should use DeepSeek token counts for files when model is DeepSeek', () => {
    const messageWithFile = createMessage({
      text: 'Check this',
      files: [
        {
          id: 'file1',
          name: 'doc.txt',
          fileType: 'text/plain',
          tokenCountMap: { default: 500, deepseek: 400 },
        },
      ],
    })

    const tokensDefault = estimateTokensFromMessages([messageWithFile], 'input')
    const tokensDeepSeek = estimateTokensFromMessages([messageWithFile], 'input', deepSeekModel)

    // DeepSeek should use 400 instead of 500
    expect(tokensDefault).toBeGreaterThan(tokensDeepSeek)
  })

  it('should handle messages with multiple files and links', () => {
    const message = createMessage({
      text: 'Multiple attachments',
      files: [
        { id: 'f1', name: 'a.txt', fileType: 'text/plain', tokenCountMap: { default: 100, deepseek: 80 } },
        { id: 'f2', name: 'b.txt', fileType: 'text/plain', tokenCountMap: { default: 150, deepseek: 120 } },
      ],
      links: [{ id: 'l1', url: 'https://a.com', title: 'A', tokenCountMap: { default: 200, deepseek: 160 } }],
    })

    const baseMessage = createMessage({ text: 'Multiple attachments' })
    const baseTokens = estimateTokensFromMessages([baseMessage])
    const withAttachments = estimateTokensFromMessages([message])

    // Should add 100 + 150 + 200 = 450 tokens for attachments
    expect(withAttachments).toBe(baseTokens + 450)
  })

  it('should handle system messages', () => {
    const systemMessage = createMessage({
      text: 'You are a helpful assistant.',
      role: MessageRoleEnum.System,
    })
    const tokens = estimateTokensFromMessages([systemMessage])
    expect(tokens).toBeGreaterThan(0)
  })

  it('should handle assistant messages', () => {
    const assistantMessage = createMessage({
      text: 'I am here to help you.',
      role: MessageRoleEnum.Assistant,
    })
    const tokens = estimateTokensFromMessages([assistantMessage])
    expect(tokens).toBeGreaterThan(0)
  })

  it('should handle reasoning content in output mode', () => {
    const messageWithReasoning = createMessage({
      contentParts: [
        { type: 'reasoning', text: 'Let me think about this...' },
        { type: 'text', text: 'The answer is 42.' },
      ],
    })

    const tokensOutput = estimateTokensFromMessages([messageWithReasoning], 'output')
    const tokensInput = estimateTokensFromMessages([messageWithReasoning], 'input')

    // Output mode includes reasoning, input mode does not
    expect(tokensOutput).toBeGreaterThan(tokensInput)
  })

  it('should handle messages with image parts', () => {
    const messageWithImage = createMessage({
      contentParts: [
        { type: 'text', text: 'Look at this:' },
        { type: 'image', storageKey: 'image123' },
      ],
    })
    const tokens = estimateTokensFromMessages([messageWithImage])
    expect(tokens).toBeGreaterThan(0)
  })

  it('should handle messages with tool-call parts', () => {
    const messageWithToolCall = createMessage({
      contentParts: [
        { type: 'text', text: 'Searching...' },
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'tc1',
          toolName: 'web_search',
          args: { query: 'test' },
          result: { items: [] },
        },
      ],
    })
    const tokens = estimateTokensFromMessages([messageWithToolCall])
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('sliceTextByTokenLimit', () => {
  it('should return empty string for empty input', () => {
    expect(sliceTextByTokenLimit('', 100)).toBe('')
  })

  it('should return full text when under limit', () => {
    const text = 'Hello'
    const result = sliceTextByTokenLimit(text, 100)
    expect(result).toBe(text)
  })

  it('should slice text when over limit', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(50)
    const result = sliceTextByTokenLimit(text, 50)
    expect(result.length).toBeLessThan(text.length)
    expect(estimateTokens(result)).toBeLessThanOrEqual(50)
  })

  it('should respect token limit boundary', () => {
    const text = 'a'.repeat(1000)
    const limit = 10
    const result = sliceTextByTokenLimit(text, limit)
    expect(estimateTokens(result)).toBeLessThanOrEqual(limit)
  })

  it('should use DeepSeek tokenizer when model is DeepSeek', () => {
    const text = 'Hello 你好 '.repeat(100)
    const resultDefault = sliceTextByTokenLimit(text, 50)
    const resultDeepSeek = sliceTextByTokenLimit(text, 50, deepSeekModel)

    expect(resultDefault.length).toBeLessThanOrEqual(text.length)
    expect(resultDeepSeek.length).toBeLessThanOrEqual(text.length)
  })

  it('should handle Chinese text', () => {
    const text = '这是一段很长的中文文本用于测试分词功能'.repeat(20)
    const result = sliceTextByTokenLimit(text, 100)
    expect(result.length).toBeLessThanOrEqual(text.length)
  })

  it('should handle mixed content', () => {
    const text = 'Hello World '.repeat(50)
    const result = sliceTextByTokenLimit(text, 100)
    expect(result.length).toBeLessThanOrEqual(text.length)
  })

  it('should handle limit of 0', () => {
    const text = 'Hello'
    const result = sliceTextByTokenLimit(text, 0)
    expect(result).toBe('')
  })

  it('should handle very small limits', () => {
    const text = 'Hello world!'
    const result = sliceTextByTokenLimit(text, 1)
    // Should return as much as fits within 1 token
    expect(result.length).toBeLessThanOrEqual(text.length)
  })
})

describe('getAttachmentTokenCacheKey', () => {
  it('should return default for non-DeepSeek without preview', () => {
    expect(getAttachmentTokenCacheKey({ model: openAIModel, preferPreview: false })).toBe('default')
  })

  it('should return deepseek for DeepSeek without preview', () => {
    expect(getAttachmentTokenCacheKey({ model: deepSeekModel, preferPreview: false })).toBe('deepseek')
  })

  it('should return default_preview for non-DeepSeek with preview', () => {
    expect(getAttachmentTokenCacheKey({ model: openAIModel, preferPreview: true })).toBe('default_preview')
  })

  it('should return deepseek_preview for DeepSeek with preview', () => {
    expect(getAttachmentTokenCacheKey({ model: deepSeekModel, preferPreview: true })).toBe('deepseek_preview')
  })

  it('should return default when model is undefined without preview', () => {
    expect(getAttachmentTokenCacheKey({ model: undefined, preferPreview: false })).toBe('default')
  })

  it('should return default_preview when model is undefined with preview', () => {
    expect(getAttachmentTokenCacheKey({ model: undefined, preferPreview: true })).toBe('default_preview')
  })
})

describe('estimateTokensFromMessagesForSendPayload', () => {
  it('should return 0 for empty message array', () => {
    expect(estimateTokensFromMessagesForSendPayload([])).toBe(0)
  })

  it('should estimate tokens for single text message', () => {
    const messages = [createMessage({ text: 'Hello, how are you?' })]
    const tokens = estimateTokensFromMessagesForSendPayload(messages)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should skip attachments without storageKey', () => {
    const messageWithFile = createMessage({
      text: 'Check this',
      files: [
        {
          id: 'file1',
          name: 'doc.txt',
          fileType: 'text/plain',
          tokenCountMap: { default: 500, deepseek: 400 },
        },
      ],
    })
    const messageWithoutFile = createMessage({ text: 'Check this' })

    const tokensWithFile = estimateTokensFromMessagesForSendPayload([messageWithFile])
    const tokensWithoutFile = estimateTokensFromMessagesForSendPayload([messageWithoutFile])

    expect(tokensWithFile).toBe(tokensWithoutFile)
  })

  it('should include wrapper tokens for files with storageKey', () => {
    const messageWithFile = createMessage({
      text: 'Check this',
      files: [
        {
          id: 'file1',
          name: 'doc.txt',
          fileType: 'text/plain',
          storageKey: 'storage-key-123',
          tokenCountMap: { default: 100, deepseek: 80 },
          lineCount: 50,
          byteLength: 1000,
        },
      ],
    })
    const messageWithoutFile = createMessage({ text: 'Check this' })

    const tokensWithFile = estimateTokensFromMessagesForSendPayload([messageWithFile])
    const tokensWithoutFile = estimateTokensFromMessagesForSendPayload([messageWithoutFile])

    expect(tokensWithFile).toBeGreaterThan(tokensWithoutFile + 100)
  })

  describe('preview mode selection', () => {
    const smallFile = {
      id: 'small',
      name: 'small.txt',
      fileType: 'text/plain',
      storageKey: 'storage-small',
      tokenCountMap: { default: 100, deepseek: 80, default_preview: 20, deepseek_preview: 16 },
      lineCount: 50,
      byteLength: 500,
    }

    const largeFile = {
      id: 'large',
      name: 'large.txt',
      fileType: 'text/plain',
      storageKey: 'storage-large',
      tokenCountMap: { default: 1000, deepseek: 800, default_preview: 200, deepseek_preview: 160 },
      lineCount: 501,
      byteLength: 50000,
    }

    it('should use full tokens for small file (<=500 lines) regardless of tool support', () => {
      const message = createMessage({ text: 'Check', files: [smallFile] })

      const tokensNoTool = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: false })
      const tokensWithTool = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: true })

      expect(tokensNoTool).toBe(tokensWithTool)
    })

    it('should use full tokens for large file when model does NOT support tool use', () => {
      const message = createMessage({ text: 'Check', files: [largeFile] })

      const tokensNoTool = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: false })

      expect(tokensNoTool).toBeGreaterThan(1000)
    })

    it('should use preview tokens for large file when model supports tool use', () => {
      const message = createMessage({ text: 'Check', files: [largeFile] })

      const tokensNoTool = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: false })
      const tokensWithTool = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: true })

      expect(tokensWithTool).toBeLessThan(tokensNoTool)
    })

    it('should use DeepSeek preview tokens for DeepSeek model with large file and tool support', () => {
      const message = createMessage({ text: 'Check', files: [largeFile] })

      const tokensOpenAI = estimateTokensFromMessagesForSendPayload([message], {
        model: openAIModel,
        modelSupportToolUseForFile: true,
      })
      const tokensDeepSeek = estimateTokensFromMessagesForSendPayload([message], {
        model: deepSeekModel,
        modelSupportToolUseForFile: true,
      })

      expect(tokensDeepSeek).not.toBe(tokensOpenAI)
    })
  })

  describe('links handling', () => {
    it('should apply same preview/full logic to links', () => {
      const smallLink = {
        id: 'link1',
        url: 'https://example.com',
        title: 'Example',
        storageKey: 'storage-link',
        tokenCountMap: { default: 100, deepseek: 80, default_preview: 20, deepseek_preview: 16 },
        lineCount: 50,
        byteLength: 500,
      }

      const largeLink = {
        id: 'link2',
        url: 'https://example.com/large',
        title: 'Large Page',
        storageKey: 'storage-link-large',
        tokenCountMap: { default: 1000, deepseek: 800, default_preview: 200, deepseek_preview: 160 },
        lineCount: 501,
        byteLength: 50000,
      }

      const msgSmall = createMessage({ text: 'Check', links: [smallLink] })
      const msgLarge = createMessage({ text: 'Check', links: [largeLink] })

      const smallNoTool = estimateTokensFromMessagesForSendPayload([msgSmall], { modelSupportToolUseForFile: false })
      const smallWithTool = estimateTokensFromMessagesForSendPayload([msgSmall], { modelSupportToolUseForFile: true })

      expect(smallNoTool).toBe(smallWithTool)

      const largeNoTool = estimateTokensFromMessagesForSendPayload([msgLarge], { modelSupportToolUseForFile: false })
      const largeWithTool = estimateTokensFromMessagesForSendPayload([msgLarge], { modelSupportToolUseForFile: true })

      expect(largeWithTool).toBeLessThan(largeNoTool)
    })
  })

  describe('missing metadata fallback', () => {
    it('should use safety margin when lineCount is missing', () => {
      const fileNoLineCount = {
        id: 'file1',
        name: 'doc.txt',
        fileType: 'text/plain',
        storageKey: 'storage-key',
        tokenCountMap: { default: 100 },
      }

      const message = createMessage({ text: 'Check', files: [fileNoLineCount] })
      const tokens = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: true })

      expect(tokens).toBeGreaterThan(150)
    })

    it('should fall back to full token count when preview key is missing', () => {
      const fileNoPreviewKey = {
        id: 'file1',
        name: 'doc.txt',
        fileType: 'text/plain',
        storageKey: 'storage-key',
        tokenCountMap: { default: 500 },
        lineCount: 501,
        byteLength: 10000,
      }

      const message = createMessage({ text: 'Check', files: [fileNoPreviewKey] })
      const tokens = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: true })

      expect(tokens).toBeGreaterThan(500)
    })
  })

  describe('boundary conditions', () => {
    it('should treat exactly 500 lines as small file (full tokens)', () => {
      const file500Lines = {
        id: 'file',
        name: 'doc.txt',
        fileType: 'text/plain',
        storageKey: 'storage-key',
        tokenCountMap: { default: 500, default_preview: 100 },
        lineCount: 500,
        byteLength: 5000,
      }

      const message = createMessage({ text: 'Check', files: [file500Lines] })
      const tokensNoTool = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: false })
      const tokensWithTool = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: true })

      expect(tokensNoTool).toBe(tokensWithTool)
    })

    it('should treat 501 lines as large file (preview tokens when tool supported)', () => {
      const file501Lines = {
        id: 'file',
        name: 'doc.txt',
        fileType: 'text/plain',
        storageKey: 'storage-key',
        tokenCountMap: { default: 500, default_preview: 100 },
        lineCount: 501,
        byteLength: 5010,
      }

      const message = createMessage({ text: 'Check', files: [file501Lines] })
      const tokensNoTool = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: false })
      const tokensWithTool = estimateTokensFromMessagesForSendPayload([message], { modelSupportToolUseForFile: true })

      expect(tokensWithTool).toBeLessThan(tokensNoTool)
    })
  })

  describe('multiple attachments', () => {
    it('should use incrementing attachment indices', () => {
      const file1 = {
        id: 'file1',
        name: 'a.txt',
        fileType: 'text/plain',
        storageKey: 'storage-1',
        tokenCountMap: { default: 100 },
        lineCount: 50,
        byteLength: 500,
      }
      const file2 = {
        id: 'file2',
        name: 'b.txt',
        fileType: 'text/plain',
        storageKey: 'storage-2',
        tokenCountMap: { default: 100 },
        lineCount: 50,
        byteLength: 500,
      }
      const link1 = {
        id: 'link1',
        url: 'https://example.com',
        title: 'Example',
        storageKey: 'storage-link',
        tokenCountMap: { default: 100 },
        lineCount: 50,
        byteLength: 500,
      }

      const message = createMessage({ text: 'Check', files: [file1, file2], links: [link1] })
      const tokens = estimateTokensFromMessagesForSendPayload([message])

      expect(tokens).toBeGreaterThan(300)
    })
  })
})

describe('exact text counts carried on the message', () => {
  // Sentinel counts far above any real encode of the text prove the carried
  // value was used instead of a synchronous fallback encode.
  it('trusts the entry for the requested tokenizer only', () => {
    // Spaced words: an unbroken same-character run makes the fallback BPE
    // encode quadratic and the test timing-fragile.
    const text = 'draft word '.repeat(500)
    const message = { ...createMessage({ text }), tokenCountMap: { deepseek: 424242 } }

    expect(estimateTokensFromMessages([message], 'output', deepSeekModel)).toBeGreaterThan(424242)
    // The DeepSeek entry must not leak into default-tokenizer estimates.
    expect(estimateTokensFromMessages([message], 'output', openAIModel)).toBeLessThan(10000)
  })

  it('uses a seeded draft count across the send-path estimators', () => {
    const text = 'draft word '.repeat(500)
    const message = createMessage()
    message.contentParts = [
      { type: 'text', text },
      { type: 'image', storageKey: 'img-1' },
    ]
    const seeded = seedExactDraftTokens(message, {
      text: `${text}\n[image]`,
      tokenizerType: 'default',
      tokens: 555555,
    })

    expect(estimateTokensFromMessages([seeded], 'output')).toBeGreaterThan(555555)
    expect(estimateTokensFromMessagesForSendPayload([seeded])).toBeGreaterThan(555555)
  })

  it('leaves a drifted draft unseeded and falls back to a real estimate', () => {
    const text = 'draft word '.repeat(500)
    const message = createMessage({ text })
    const seeded = seedExactDraftTokens(message, {
      text: `${text} plus edits after the worker ran`,
      tokenizerType: 'default',
      tokens: 555555,
    })

    expect(seeded.tokenCountMap).toBeUndefined()
    expect(estimateTokensFromMessages([seeded], 'output')).toBeLessThan(10000)
  })
})

describe('unseeded long text stays off the full encoder', () => {
  // A submit racing the debounce or the worker (or drifting past its result)
  // arrives with no carried count; the estimators must degrade to the bounded
  // sampling estimate, never to a full main-thread encode of the long text.
  const longText = 'draft word '.repeat(500)

  function fullEncodeCalls(): number {
    return vi.mocked(estimateTokens).mock.calls.filter(([text]) => text.length >= LONG_DRAFT_TOKENIZATION_THRESHOLD)
      .length
  }

  beforeEach(() => {
    vi.mocked(estimateTokens).mockClear()
  })

  it('samples the long text in estimateTokensFromMessages', () => {
    const message = createMessage({ text: longText })

    const total = estimateTokensFromMessages([message], 'output')

    expect(total).toBe(3 + estimateDraftTokensImmediately(longText, 'default') + estimateTokens('user'))
    expect(fullEncodeCalls()).toBe(0)
  })

  it('samples the long text in estimateTokensFromMessagesForSendPayload', () => {
    const message = createMessage({ text: longText })

    const total = estimateTokensFromMessagesForSendPayload([message])

    expect(total).toBe(3 + estimateDraftTokensImmediately(longText, 'default') + estimateTokens('user'))
    expect(fullEncodeCalls()).toBe(0)
  })

  it('samples with the tokenizer the model resolves to', () => {
    const message = createMessage({ text: longText })

    const total = estimateTokensFromMessages([message], 'output', deepSeekModel)

    expect(total).toBe(3 + estimateDraftTokensImmediately(longText, 'deepseek') + estimateTokens('user', deepSeekModel))
    expect(fullEncodeCalls()).toBe(0)
  })

  it('keeps short unseeded text on the exact encoder', () => {
    const shortText = 'short unseeded draft'
    const message = createMessage({ text: shortText })

    estimateTokensFromMessages([message], 'output')

    expect(vi.mocked(estimateTokens).mock.calls.some(([text]) => text === shortText)).toBe(true)
  })
})
