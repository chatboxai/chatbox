import type { CompactionPoint, Message } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { buildContext } from './builder'
import type { AttachmentResolver } from './types'

function createMockResolver(contents: Map<string, string> = new Map()): AttachmentResolver {
  return {
    read: vi.fn().mockImplementation(async (key: string) => contents.get(key) ?? null),
  }
}

function createMessage(overrides: Partial<Message> & { id: string; role: Message['role'] }): Message {
  return {
    contentParts: [{ type: 'text', text: 'Test message' }],
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('buildContext', () => {
  describe('basic filtering', () => {
    it('should filter out generating messages', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'user', contentParts: [{ type: 'text', text: 'Hi' }] }),
        createMessage({ id: '2', role: 'assistant', contentParts: [], generating: true }),
      ]

      const result = await buildContext(messages, { attachmentResolver: createMockResolver() })

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('1')
    })

    it('should return empty array for empty messages', async () => {
      const result = await buildContext([], { attachmentResolver: createMockResolver() })

      expect(result).toEqual([])
    })

    it('should return empty array when all messages are generating', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'assistant', generating: true }),
        createMessage({ id: '2', role: 'assistant', generating: true }),
      ]

      const result = await buildContext(messages, { attachmentResolver: createMockResolver() })

      expect(result).toEqual([])
    })

    it('should preserve non-generating messages', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'system', contentParts: [{ type: 'text', text: 'System prompt' }] }),
        createMessage({ id: '2', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] }),
        createMessage({ id: '3', role: 'assistant', contentParts: [{ type: 'text', text: 'Hi there' }] }),
      ]

      const result = await buildContext(messages, { attachmentResolver: createMockResolver() })

      expect(result).toHaveLength(3)
    })
  })

  describe('message limit', () => {
    it('should limit messages to maxContextMessageCount', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'user', contentParts: [{ type: 'text', text: 'First' }] }),
        createMessage({ id: '2', role: 'assistant', contentParts: [{ type: 'text', text: 'Response 1' }] }),
        createMessage({ id: '3', role: 'user', contentParts: [{ type: 'text', text: 'Second' }] }),
        createMessage({ id: '4', role: 'assistant', contentParts: [{ type: 'text', text: 'Response 2' }] }),
        createMessage({ id: '5', role: 'user', contentParts: [{ type: 'text', text: 'Third' }] }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        maxContextMessageCount: 2,
      })

      // maxContextMessageCount=2 limits history to 2 messages
      // +1 for current input (last message), so we get last 3 messages
      // result = [user2, assistant2, user3]
      expect(result).toHaveLength(3)
      expect(result.map((m) => m.id)).toEqual(['3', '4', '5'])
    })

    it('should preserve system message when limiting', async () => {
      const messages: Message[] = [
        createMessage({ id: 'sys', role: 'system', contentParts: [{ type: 'text', text: 'System' }] }),
        createMessage({ id: '1', role: 'user', contentParts: [{ type: 'text', text: 'First' }] }),
        createMessage({ id: '2', role: 'assistant', contentParts: [{ type: 'text', text: 'Response' }] }),
        createMessage({ id: '3', role: 'user', contentParts: [{ type: 'text', text: 'Second' }] }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        maxContextMessageCount: 1,
      })

      expect(result[0].role).toBe('system')
      expect(result[0].id).toBe('sys')
    })

    it('should skip error messages when limiting', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'user' }),
        createMessage({ id: '2', role: 'assistant', error: 'Some error' }),
        createMessage({ id: '3', role: 'user' }),
        createMessage({ id: '4', role: 'assistant' }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        maxContextMessageCount: 2,
      })

      const ids = result.map((m) => m.id)
      expect(ids).not.toContain('2')
    })

    it('should preserve last user message when maxContextMessageCount is 0', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'user', contentParts: [{ type: 'text', text: 'First' }] }),
        createMessage({ id: '2', role: 'assistant', contentParts: [{ type: 'text', text: 'Response 1' }] }),
        createMessage({ id: '3', role: 'user', contentParts: [{ type: 'text', text: 'Current input' }] }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        maxContextMessageCount: 0,
      })

      // maxContextMessageCount=0 means no history, but current input (last message) is preserved
      // slice(-1) returns the last message
      expect(result.map((m) => m.id)).toEqual(['3'])
    })

    it('should preserve system message and last user message when maxContextMessageCount is 0', async () => {
      const messages: Message[] = [
        createMessage({ id: 'sys', role: 'system', contentParts: [{ type: 'text', text: 'System' }] }),
        createMessage({ id: '1', role: 'user', contentParts: [{ type: 'text', text: 'First' }] }),
        createMessage({ id: '2', role: 'assistant', contentParts: [{ type: 'text', text: 'Response 1' }] }),
        createMessage({ id: '3', role: 'user', contentParts: [{ type: 'text', text: 'Current input' }] }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        maxContextMessageCount: 0,
      })

      // system + last message (current input)
      expect(result.map((m) => m.id)).toEqual(['sys', '3'])
    })
  })

  describe('compaction', () => {
    it('should apply compaction point', async () => {
      const compactionPoints: CompactionPoint[] = [
        {
          boundaryMessageId: '2',
          summaryMessageId: 'summary',
          createdAt: Date.now(),
        },
      ]

      const messages: Message[] = [
        createMessage({ id: 'sys', role: 'system', contentParts: [{ type: 'text', text: 'System' }] }),
        createMessage({ id: '1', role: 'user' }),
        createMessage({ id: '2', role: 'assistant' }),
        createMessage({
          id: 'summary',
          role: 'assistant',
          isSummary: true,
          contentParts: [{ type: 'text', text: 'Summary of conversation' }],
        }),
        createMessage({ id: '3', role: 'user' }),
        createMessage({ id: '4', role: 'assistant' }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        compactionPoints,
      })

      expect(result.map((m) => m.id)).toContain('summary')
      expect(result.map((m) => m.id)).not.toContain('1')
      expect(result.map((m) => m.id)).not.toContain('2')
    })

    it('should use latest compaction point', async () => {
      const now = Date.now()
      const compactionPoints: CompactionPoint[] = [
        { boundaryMessageId: '2', summaryMessageId: 'old-summary', createdAt: now - 1000 },
        { boundaryMessageId: '4', summaryMessageId: 'new-summary', createdAt: now },
      ]

      const messages: Message[] = [
        createMessage({ id: '1', role: 'user' }),
        createMessage({ id: '2', role: 'assistant' }),
        createMessage({ id: 'old-summary', role: 'assistant', isSummary: true }),
        createMessage({ id: '3', role: 'user' }),
        createMessage({ id: '4', role: 'assistant' }),
        createMessage({ id: 'new-summary', role: 'assistant', isSummary: true }),
        createMessage({ id: '5', role: 'user' }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        compactionPoints,
      })

      expect(result.map((m) => m.id)).toContain('new-summary')
      expect(result.map((m) => m.id)).toContain('5')
      expect(result.map((m) => m.id)).not.toContain('old-summary')
    })

    it('should preserve system message after compaction', async () => {
      const compactionPoints: CompactionPoint[] = [
        { boundaryMessageId: '2', summaryMessageId: 'summary', createdAt: Date.now() },
      ]

      const messages: Message[] = [
        createMessage({ id: 'sys', role: 'system', contentParts: [{ type: 'text', text: 'System' }] }),
        createMessage({ id: '1', role: 'user' }),
        createMessage({ id: '2', role: 'assistant' }),
        createMessage({ id: 'summary', role: 'assistant', isSummary: true }),
        createMessage({ id: '3', role: 'user' }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        compactionPoints,
      })

      expect(result[0].id).toBe('sys')
    })
  })

  describe('tool call cleanup', () => {
    it('should keep recent tool calls based on keepToolCallRounds', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'user' }),
        createMessage({
          id: '2',
          role: 'assistant',
          contentParts: [
            { type: 'text', text: 'Let me call a tool' },
            { type: 'tool-call', state: 'result', toolCallId: 'tc1', toolName: 'search', args: {}, result: {} },
          ],
        }),
        createMessage({ id: '3', role: 'user' }),
        createMessage({
          id: '4',
          role: 'assistant',
          contentParts: [
            { type: 'text', text: 'Another tool call' },
            { type: 'tool-call', state: 'result', toolCallId: 'tc2', toolName: 'search', args: {}, result: {} },
          ],
        }),
        createMessage({ id: '5', role: 'user' }),
        createMessage({
          id: '6',
          role: 'assistant',
          contentParts: [
            { type: 'text', text: 'Recent tool call' },
            { type: 'tool-call', state: 'result', toolCallId: 'tc3', toolName: 'search', args: {}, result: {} },
          ],
        }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        keepToolCallRounds: 1,
      })

      const msg2 = result.find((m) => m.id === '2')
      const msg6 = result.find((m) => m.id === '6')

      expect(msg2?.contentParts.some((p) => p.type === 'tool-call')).toBe(false)
      expect(msg6?.contentParts.some((p) => p.type === 'tool-call')).toBe(true)
    })
  })

  describe('attachment injection', () => {
    it('should inject file attachments', async () => {
      const fileContent = 'File content here'
      const resolver = createMockResolver(new Map([['file-key-1', fileContent]]))

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Check this file' }],
          files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'file-key-1' }],
        }),
      ]

      const result = await buildContext(messages, { attachmentResolver: resolver })

      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      expect(textContent?.type).toBe('text')
      expect((textContent as { type: 'text'; text: string }).text).toContain('File content here')
      expect((textContent as { type: 'text'; text: string }).text).toContain('test.txt')
    })

    it('should inject link attachments', async () => {
      const linkContent = 'Web page content'
      const resolver = createMockResolver(new Map([['link-key-1', linkContent]]))

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Check this link' }],
          links: [{ id: 'link-1', title: 'Example Page', url: 'https://example.com', storageKey: 'link-key-1' }],
        }),
      ]

      const result = await buildContext(messages, { attachmentResolver: resolver })

      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      expect((textContent as { type: 'text'; text: string }).text).toContain('Web page content')
    })

    it('should handle missing attachment content', async () => {
      const resolver = createMockResolver(new Map())

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Check this file' }],
          files: [{ id: 'file-1', name: 'missing.txt', fileType: 'text/plain', storageKey: 'nonexistent-key' }],
        }),
      ]

      const result = await buildContext(messages, { attachmentResolver: resolver })

      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      expect((textContent as { type: 'text'; text: string }).text).toBe('Check this file')
    })

    it('should truncate large files when modelSupportToolUseForFile is true', async () => {
      const largeContent = Array(600).fill('Line of content').join('\n')
      const resolver = createMockResolver(new Map([['file-key', largeContent]]))

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Check file' }],
          files: [{ id: 'file-1', name: 'large.txt', fileType: 'text/plain', storageKey: 'file-key' }],
        }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: resolver,
        modelSupportToolUseForFile: true,
      })

      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      const text = (textContent as { type: 'text'; text: string }).text
      expect(text).toContain('TRUNCATED')
      expect(text).toContain('Use read_file or search_file_content tool')
    })

    it('should not truncate when modelSupportToolUseForFile is false', async () => {
      const largeContent = Array(600).fill('Line').join('\n')
      const resolver = createMockResolver(new Map([['file-key', largeContent]]))

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Check file' }],
          files: [{ id: 'file-1', name: 'large.txt', fileType: 'text/plain', storageKey: 'file-key' }],
        }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: resolver,
        modelSupportToolUseForFile: false,
      })

      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      const text = (textContent as { type: 'text'; text: string }).text
      expect(text).not.toContain('TRUNCATED')
    })
  })

  describe('immutability', () => {
    it('should not mutate input messages', async () => {
      const originalMessages: Message[] = [
        createMessage({ id: '1', role: 'user', contentParts: [{ type: 'text', text: 'Original' }] }),
      ]
      const messagesCopy = JSON.stringify(originalMessages)

      await buildContext(originalMessages, { attachmentResolver: createMockResolver() })

      expect(JSON.stringify(originalMessages)).toBe(messagesCopy)
    })
  })

  describe('edge cases', () => {
    it('should handle mixed file and link attachments on same message', async () => {
      const fileContent = 'File content here'
      const linkContent = 'Web page content here'
      const resolver = createMockResolver(
        new Map([
          ['file-key-1', fileContent],
          ['link-key-1', linkContent],
        ])
      )

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Check both attachments' }],
          files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'file-key-1' }],
          links: [{ id: 'link-1', title: 'Example Page', url: 'https://example.com', storageKey: 'link-key-1' }],
        }),
      ]

      const result = await buildContext(messages, { attachmentResolver: resolver })

      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      expect(textContent?.type).toBe('text')
      const text = (textContent as { type: 'text'; text: string }).text

      expect(text).toContain('File content here')
      expect(text).toContain('test.txt')
      expect(text).toContain('Web page content here')
      expect(text).toContain('Example Page')
    })

    it('should increment attachmentIndex correctly for multiple attachments', async () => {
      const resolver = createMockResolver(
        new Map([
          ['file-key-1', 'Content 1'],
          ['file-key-2', 'Content 2'],
          ['link-key-1', 'Content 3'],
        ])
      )

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Multiple attachments' }],
          files: [
            { id: 'file-1', name: 'first.txt', fileType: 'text/plain', storageKey: 'file-key-1' },
            { id: 'file-2', name: 'second.txt', fileType: 'text/plain', storageKey: 'file-key-2' },
          ],
          links: [{ id: 'link-1', title: 'Third', url: 'https://example.com', storageKey: 'link-key-1' }],
        }),
      ]

      const result = await buildContext(messages, { attachmentResolver: resolver })

      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      const text = (textContent as { type: 'text'; text: string }).text

      expect(text).toContain('<FILE_INDEX>1</FILE_INDEX>')
      expect(text).toContain('<FILE_INDEX>2</FILE_INDEX>')
      expect(text).toContain('<FILE_INDEX>3</FILE_INDEX>')
    })

    it('should handle summaryMessageId not found in message list', async () => {
      const compactionPoints: CompactionPoint[] = [
        {
          boundaryMessageId: '2',
          summaryMessageId: 'nonexistent-summary',
          createdAt: Date.now(),
        },
      ]

      const messages: Message[] = [
        createMessage({ id: 'sys', role: 'system', contentParts: [{ type: 'text', text: 'System' }] }),
        createMessage({ id: '1', role: 'user' }),
        createMessage({ id: '2', role: 'assistant' }),
        createMessage({ id: '3', role: 'user' }),
        createMessage({ id: '4', role: 'assistant' }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        compactionPoints,
      })

      expect(result.map((m) => m.id)).toContain('sys')
      expect(result.map((m) => m.id)).toContain('3')
      expect(result.map((m) => m.id)).toContain('4')
      expect(result.map((m) => m.id)).not.toContain('1')
      expect(result.map((m) => m.id)).not.toContain('2')
      expect(result.map((m) => m.id)).not.toContain('nonexistent-summary')
    })

    it('should handle system message not at index 0', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'user', contentParts: [{ type: 'text', text: 'First user message' }] }),
        createMessage({ id: 'sys', role: 'system', contentParts: [{ type: 'text', text: 'System prompt' }] }),
        createMessage({ id: '2', role: 'assistant', contentParts: [{ type: 'text', text: 'Response' }] }),
      ]

      const result = await buildContext(messages, { attachmentResolver: createMockResolver() })

      expect(result).toHaveLength(3)
      expect(result[0].id).toBe('1')
      expect(result[1].id).toBe('sys')
      expect(result[2].id).toBe('2')
    })

    it('should handle empty compactionPoints array same as undefined', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'user' }),
        createMessage({ id: '2', role: 'assistant' }),
        createMessage({ id: '3', role: 'user' }),
      ]

      const resultWithEmpty = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        compactionPoints: [],
      })

      const resultWithUndefined = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        compactionPoints: undefined,
      })

      expect(resultWithEmpty.map((m) => m.id)).toEqual(resultWithUndefined.map((m) => m.id))
      expect(resultWithEmpty).toHaveLength(3)
      expect(resultWithUndefined).toHaveLength(3)
    })
  })
})
