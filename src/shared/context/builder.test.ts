import { sandboxAttachmentParsedRelPath, sandboxAttachmentRelPath } from '@shared/sandbox/attachment-path'
import type { CompactionPoint, Message } from '@shared/types'
import { uploadedFilePath } from '@shared/uploaded-file-tools'
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

    it('should filter out fork marker messages', async () => {
      const messages: Message[] = [
        createMessage({ id: '1', role: 'user', contentParts: [{ type: 'text', text: 'Hi' }] }),
        createMessage({ id: 'fork-marker', role: 'assistant', isForkMarker: true }),
        createMessage({ id: '2', role: 'assistant', contentParts: [{ type: 'text', text: 'Hello' }] }),
      ]

      const result = await buildContext(messages, { attachmentResolver: createMockResolver() })

      expect(result.map((m) => m.id)).toEqual(['1', '2'])
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
    it('orders a persisted steered user before the assistant reply prior to limiting', async () => {
      const messages: Message[] = [
        createMessage({ id: 'original', role: 'user' }),
        createMessage({ id: 'reply', role: 'assistant' }),
        createMessage({ id: 'steered', role: 'user', steered: true }),
        createMessage({ id: 'next', role: 'user' }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        maxContextMessageCount: 2,
      })

      expect(result.map((message) => message.id)).toEqual(['steered', 'reply', 'next'])
    })

    it('passes true-order steering records through unchanged', async () => {
      const messages: Message[] = [
        createMessage({ id: 'original', role: 'user' }),
        createMessage({
          id: 'segment',
          role: 'assistant',
          finishReason: 'steered',
          contentParts: [{ type: 'text', text: 'before' }],
        }),
        createMessage({
          id: 'steered',
          role: 'user',
          steered: true,
          contentParts: [{ type: 'text', text: 'change direction' }],
        }),
        createMessage({ id: 'continuation', role: 'assistant', contentParts: [{ type: 'text', text: 'after' }] }),
      ]

      const result = await buildContext(messages, { attachmentResolver: createMockResolver() })

      expect(result.map((message) => message.id)).toEqual(['original', 'segment', 'steered', 'continuation'])
    })

    it('keeps true-order steering records adjacent under a history limit', async () => {
      const messages: Message[] = [
        createMessage({ id: 'old', role: 'user' }),
        createMessage({ id: 'segment', role: 'assistant', finishReason: 'steered' }),
        createMessage({ id: 'steered', role: 'user', steered: true }),
        createMessage({ id: 'continuation', role: 'assistant' }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        maxContextMessageCount: 2,
      })

      // Split segments are ordinary history messages: plain tail slicing keeps
      // the steer between its segment and continuation without special casing.
      expect(result.map((message) => message.id)).toEqual(['segment', 'steered', 'continuation'])
    })

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

  describe('sticky message-limit window (prompt-cache prefix)', () => {
    // maxContextMessageCount=19 → effectiveLimit 20 → chunk = ceil(20/4) = 5
    const limitOptions = {
      attachmentResolver: createMockResolver(),
      maxContextMessageCount: 19,
    }
    const makeMessages = (count: number): Message[] =>
      Array.from({ length: count }, (_, i) => createMessage({ id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant' }))

    it('keeps the window boundary fixed while the overflow stays within a chunk', async () => {
      const base = await buildContext(makeMessages(21), limitOptions)
      const grown = await buildContext(makeMessages(24), limitOptions)

      // 21 messages: overflow 1 → drop one whole chunk (5). 24: overflow 4 →
      // still one chunk. The boundary (and thus the request prefix) is stable
      // across the intermediate turns instead of sliding every turn.
      expect(base[0].id).toBe('m5')
      expect(grown[0].id).toBe('m5')
      expect(grown.slice(0, base.length).map((m) => m.id)).toEqual(base.map((m) => m.id))
    })

    it('advances the boundary by a whole chunk when the overflow crosses it', async () => {
      const result = await buildContext(makeMessages(26), limitOptions)

      // overflow 6 → drop ceil(6/5)*5 = 10
      expect(result[0].id).toBe('m10')
      expect(result).toHaveLength(16)
    })

    it('never serves more than the configured limit', async () => {
      for (let count = 20; count <= 30; count += 1) {
        const result = await buildContext(makeMessages(count), limitOptions)
        expect(result.length).toBeLessThanOrEqual(20)
      }
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

    it('summarizes a finalized segment behind the compaction boundary', async () => {
      // A steer can land while compaction is running. With true-order
      // persistence the interrupted segment is finalized before the steered
      // user, so a boundary at the steered user cleanly covers the segment.
      const messages: Message[] = [
        createMessage({ id: 'original', role: 'user' }),
        createMessage({
          id: 'segment',
          role: 'assistant',
          finishReason: 'steered',
          contentParts: [{ type: 'text', text: 'before' }],
        }),
        createMessage({ id: 'steered', role: 'user', steered: true }),
        createMessage({ id: 'summary', role: 'assistant', isSummary: true }),
        createMessage({ id: 'continuation', role: 'assistant', contentParts: [{ type: 'text', text: 'after' }] }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        compactionPoints: [{ boundaryMessageId: 'steered', summaryMessageId: 'summary', createdAt: Date.now() }],
      })

      expect(result.map((message) => message.id)).toEqual(['summary', 'continuation'])
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

    it('should ignore a compaction point whose summary is missing from the path', async () => {
      const compactionPoints: CompactionPoint[] = [
        { boundaryMessageId: '2', summaryMessageId: 'missing-summary', createdAt: Date.now() },
      ]

      const messages: Message[] = [
        createMessage({ id: '1', role: 'user' }),
        createMessage({ id: '2', role: 'assistant' }),
        createMessage({ id: '3', role: 'user' }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        compactionPoints,
      })

      expect(result.map((m) => m.id)).toEqual(['1', '2', '3'])
    })

    it('should fall back to an older applicable point when the latest is torn apart by a fork switch', async () => {
      const now = Date.now()
      const compactionPoints: CompactionPoint[] = [
        { boundaryMessageId: '2', summaryMessageId: 'old-summary', createdAt: now - 1000 },
        { boundaryMessageId: '4', summaryMessageId: 'new-summary', createdAt: now },
      ]

      // new-summary went into a sibling fork branch; this path only holds the older pair.
      const messages: Message[] = [
        createMessage({ id: '1', role: 'user' }),
        createMessage({ id: '2', role: 'assistant' }),
        createMessage({ id: 'old-summary', role: 'assistant', isSummary: true }),
        createMessage({ id: '3', role: 'user' }),
        createMessage({ id: '4', role: 'assistant' }),
        createMessage({ id: '5', role: 'user' }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        compactionPoints,
      })

      expect(result.map((m) => m.id)).toEqual(['old-summary', '3', '4', '5'])
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
      expect(text).toContain('Use read_file')
      expect(text).toContain(`file_path="${uploadedFilePath('file-key')}"`)
      expect(text).not.toContain('with FILE_KEY=')
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

    it('should insert retrieval attachment tags without reading large session RAG content', async () => {
      const resolver = createMockResolver(new Map([['file-key', 'large parsed content should stay out of context']]))

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Use the attached manual' }],
          files: [
            {
              id: 'file-1',
              name: 'manual.md',
              fileType: 'text/markdown',
              storageKey: 'file-key',
              ragMode: 'session-retrieval',
              sessionAttachmentId: 42,
              sessionAttachmentIndexStatus: 'ready',
            },
          ],
        }),
      ]

      const result = await buildContext(messages, { attachmentResolver: resolver })

      expect(resolver.read).not.toHaveBeenCalled()
      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      const text = (textContent as { type: 'text'; text: string }).text
      expect(text).toContain('<ATTACHMENT_FILE>')
      expect(text).toContain('<FILE_NAME>manual.md</FILE_NAME>')
      expect(text).toContain('<FILE_KEY>session-attachment:42</FILE_KEY>')
      expect(text).toContain('<INDEX_STATUS>ready</INDEX_STATUS>')
      expect(text).toContain('<SYSTEM_REMINDER>')
      expect(text).toContain('query_session_attachment')
      expect(text).not.toContain('large parsed content should stay out of context')
    })

    it('should use ATTACHMENT_FILE metadata tags in sandbox mode', async () => {
      const resolver = createMockResolver(new Map([['file-key', 'parsed content should stay out of sandbox prompt']]))

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Analyze the spreadsheet' }],
          files: [
            {
              id: 'file-1',
              name: 'budget.xlsx',
              fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              storageKey: 'file-key',
              rawStorageKey: 'file-key-raw',
              parserType: 'local',
              byteLength: 4096,
              lineCount: 1200,
            },
          ],
        }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: resolver,
        sandboxMode: true,
      })

      expect(resolver.read).not.toHaveBeenCalled()
      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      const text = (textContent as { type: 'text'; text: string }).text
      expect(text).toContain('<ATTACHMENT_FILE>')
      expect(text).not.toContain('<ATTACHED_FILES>')
      expect(text).toContain('<FILE_NAME>budget.xlsx</FILE_NAME>')
      expect(text).toContain('<SANDBOX_MODE>true</SANDBOX_MODE>')
      const budgetPath = sandboxAttachmentRelPath('budget.xlsx', 'file-key-raw')
      expect(text).toContain(`<SANDBOX_PATH>${budgetPath}</SANDBOX_PATH>`)
      expect(text).toContain(`<PARSED_SANDBOX_PATH>${sandboxAttachmentParsedRelPath(budgetPath)}</PARSED_SANDBOX_PATH>`)
      expect(text).toContain('process the original binary at SANDBOX_PATH with a script')
      expect(text).not.toContain('code_execution')
      expect(text).toContain('<PARSED_TEXT_STATUS>available</PARSED_TEXT_STATUS>')
      expect(text).toContain('<FILE_LINES>1200</FILE_LINES>')
      expect(text).toContain('read PARSED_SANDBOX_PATH sequentially')
      expect(text).toContain('endLine + 1')
      expect(text).toContain('reducing limit cannot recover them')
      expect(text).toContain('bounded Unicode-safe character chunks')
      expect(text).toContain('Line-number coverage alone does not establish complete text coverage')
      expect(text).not.toContain('parsed content should stay out of sandbox prompt')
    })

    it('should omit parsed sandbox path for raw-only sandbox files', async () => {
      const resolver = createMockResolver(new Map())

      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Inspect this binary' }],
          files: [
            {
              id: 'file-1',
              name: 'archive.bin',
              fileType: 'application/octet-stream',
              storageKey: 'file-key',
              rawStorageKey: 'file-key-raw',
              parserType: 'sandbox-raw',
            },
          ],
        }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: resolver,
        sandboxMode: true,
      })

      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      const text = (textContent as { type: 'text'; text: string }).text
      expect(text).toContain(`<SANDBOX_PATH>${sandboxAttachmentRelPath('archive.bin', 'file-key-raw')}</SANDBOX_PATH>`)
      expect(text).not.toContain('<PARSED_SANDBOX_PATH>')
      expect(text).toContain('<PARSED_TEXT_STATUS>unavailable</PARSED_TEXT_STATUS>')
      expect(text).not.toContain('<FILE_LINES>')
      expect(text).toContain('Use read_file on SANDBOX_PATH to inspect it, or process it with a script')
    })

    it.each(['ready', 'indexing', 'failed'] as const)(
      'routes sandbox text independently of retrieval status %s',
      async (status) => {
        const resolver = createMockResolver(new Map([['file-key', 'large parsed content should stay out of context']]))

        const messages: Message[] = [
          createMessage({
            id: '1',
            role: 'user',
            contentParts: [{ type: 'text', text: 'Use the attached manual' }],
            files: [
              {
                id: 'file-1',
                name: 'manual.pdf',
                fileType: 'application/pdf',
                storageKey: 'file-key',
                rawStorageKey: 'file-key-raw',
                ragMode: 'session-retrieval',
                sessionAttachmentId: 42,
                sessionAttachmentIndexStatus: status,
              },
            ],
          }),
        ]

        const result = await buildContext(messages, {
          attachmentResolver: resolver,
          sandboxMode: true,
        })

        expect(resolver.read).not.toHaveBeenCalled()
        const textContent = result[0].contentParts.find((p) => p.type === 'text')
        const text = (textContent as { type: 'text'; text: string }).text
        expect(text).toContain('<ATTACHMENT_FILE>')
        expect(text).not.toContain('<ATTACHED_FILES>')
        expect(text).toContain('<FILE_KEY>session-attachment:42</FILE_KEY>')
        expect(text).toContain('<RETRIEVAL_MODE>session_attachment_rag</RETRIEVAL_MODE>')
        expect(text).toContain(`<INDEX_STATUS>${status}</INDEX_STATUS>`)
        expect(text).toContain('<PARSED_TEXT_STATUS>available</PARSED_TEXT_STATUS>')
        expect(text).toContain('<FILE_LINES>unknown</FILE_LINES>')
        const manualPath = sandboxAttachmentRelPath('manual.pdf', 'file-key-raw')
        expect(text).toContain(`<SANDBOX_PATH>${manualPath}</SANDBOX_PATH>`)
        expect(text).toContain(
          `<PARSED_SANDBOX_PATH>${sandboxAttachmentParsedRelPath(manualPath)}</PARSED_SANDBOX_PATH>`
        )
        expect(text).toContain('query_session_attachment')
        expect(text).toContain('For focused questions')
        expect(text).toContain('read PARSED_SANDBOX_PATH sequentially')
        expect(text).toContain('not extracted-text availability or completeness')
        expect(text).not.toContain('For document-specific questions about this file')
        expect(text).not.toContain('large parsed content should stay out of context')
      }
    )

    it('uses the original sandbox path and known line count for text attachments', async () => {
      const resolver = createMockResolver(new Map())
      const result = await buildContext(
        [
          createMessage({
            id: 'text-message',
            role: 'user',
            files: [{ id: 'text', name: 'notes.md', fileType: 'text/markdown', storageKey: 'text', lineCount: 800 }],
          }),
        ],
        { attachmentResolver: resolver, sandboxMode: true }
      )
      const text = result[0].contentParts.find((part) => part.type === 'text')?.text ?? ''
      expect(text).toContain('<PARSED_TEXT_STATUS>not_required</PARSED_TEXT_STATUS>')
      expect(text).toContain('<FILE_LINES>800</FILE_LINES>')
      expect(text).not.toContain('<PARSED_SANDBOX_PATH>')
      expect(text).toContain('for original text files, use SANDBOX_PATH')
      expect(resolver.read).not.toHaveBeenCalled()
    })

    it('gives same-named uploads distinct sandbox paths', async () => {
      const messages: Message[] = [
        createMessage({
          id: '1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Compare these two reports' }],
          files: [
            {
              id: 'file-a',
              name: 'report.html',
              fileType: 'text/html',
              storageKey: 'file-a',
              rawStorageKey: 'raw-a',
            },
            {
              id: 'file-b',
              name: 'report.html',
              fileType: 'text/html',
              storageKey: 'file-b',
              rawStorageKey: 'raw-b',
            },
          ],
        }),
      ]

      const result = await buildContext(messages, {
        attachmentResolver: createMockResolver(),
        sandboxMode: true,
      })

      const textContent = result[0].contentParts.find((p) => p.type === 'text')
      const text = (textContent as { type: 'text'; text: string }).text
      const pathA = sandboxAttachmentRelPath('report.html', 'raw-a')
      const pathB = sandboxAttachmentRelPath('report.html', 'raw-b')
      expect(pathA).not.toBe(pathB)
      expect(text).toContain(`<SANDBOX_PATH>${pathA}</SANDBOX_PATH>`)
      expect(text).toContain(`<SANDBOX_PATH>${pathB}</SANDBOX_PATH>`)
      expect(text).toContain('<FILE_NAME>report.html</FILE_NAME>')
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

      // The point is not applicable without its summary: keep full history
      // instead of silently dropping everything before the boundary.
      expect(result.map((m) => m.id)).toEqual(['sys', '1', '2', '3', '4'])
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

it.each([false, true])('keeps host storage identities out of retrieval metadata (sandbox=%s)', async (sandboxMode) => {
  const storageKey = 'file:/Users/alice/private/report.txt</FILE_KEY>-123'
  const messages: Message[] = [
    createMessage({
      id: 'private',
      role: 'user',
      contentParts: [],
      files: [{ id: 'f', name: 'report.txt', fileType: 'txt', storageKey, ragMode: 'session-retrieval' }],
    }),
  ]
  const result = await buildContext(messages, {
    attachmentResolver: createMockResolver(new Map()),
    sandboxMode,
  })
  const text = JSON.stringify(result[0].contentParts)
  expect(text).not.toContain('/Users/alice')
  expect(text).not.toContain('%2FUsers')
  expect(text).toContain(uploadedFilePath(storageKey))
})
