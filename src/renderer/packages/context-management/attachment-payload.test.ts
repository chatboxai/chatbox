import type { Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  buildAttachmentWrapperPrefix,
  buildAttachmentWrapperSuffix,
  MAX_INLINE_FILE_LINES,
  PREVIEW_LINES,
  selectMessagesForSendContext,
} from './attachment-payload'

describe('attachment-payload', () => {
  describe('constants', () => {
    it('should export MAX_INLINE_FILE_LINES = 500', () => {
      expect(MAX_INLINE_FILE_LINES).toBe(500)
    })

    it('should export PREVIEW_LINES = 100', () => {
      expect(PREVIEW_LINES).toBe(100)
    })
  })

  describe('buildAttachmentWrapperPrefix', () => {
    it('should build prefix with all metadata fields', () => {
      const prefix = buildAttachmentWrapperPrefix({
        attachmentIndex: 1,
        fileName: 'test.txt',
        fileKey: 'key123',
        fileLines: 150,
        fileSize: 1500,
      })

      expect(prefix).toContain('<ATTACHMENT_FILE>')
      expect(prefix).toContain('<FILE_INDEX>1</FILE_INDEX>')
      expect(prefix).toContain('<FILE_NAME>test.txt</FILE_NAME>')
      expect(prefix).toContain('<FILE_KEY>key123</FILE_KEY>')
      expect(prefix).toContain('<FILE_LINES>150</FILE_LINES>')
      expect(prefix).toContain('<FILE_SIZE>1500 bytes</FILE_SIZE>')
      expect(prefix).toContain('<FILE_CONTENT>')
      expect(prefix).toBe(prefix.trimEnd() + '\n')
    })

    it('should start with double newline', () => {
      const prefix = buildAttachmentWrapperPrefix({
        attachmentIndex: 1,
        fileName: 'test.txt',
        fileKey: 'key123',
        fileLines: 150,
        fileSize: 1500,
      })

      expect(prefix).toMatch(/^\n\n<ATTACHMENT_FILE>/)
    })

    it('should handle special characters in fileName', () => {
      const prefix = buildAttachmentWrapperPrefix({
        attachmentIndex: 2,
        fileName: 'file with spaces & special.txt',
        fileKey: 'key456',
        fileLines: 200,
        fileSize: 2000,
      })

      expect(prefix).toContain('<FILE_NAME>file with spaces & special.txt</FILE_NAME>')
    })

    it('should handle large file sizes', () => {
      const prefix = buildAttachmentWrapperPrefix({
        attachmentIndex: 1,
        fileName: 'large.bin',
        fileKey: 'key789',
        fileLines: 10000,
        fileSize: 10485760,
      })

      expect(prefix).toContain('<FILE_SIZE>10485760 bytes</FILE_SIZE>')
    })
  })

  describe('buildAttachmentWrapperSuffix', () => {
    it('should build suffix without truncation', () => {
      const suffix = buildAttachmentWrapperSuffix({ isTruncated: false })

      expect(suffix).toContain('</FILE_CONTENT>')
      expect(suffix).toContain('</ATTACHMENT_FILE>')
      expect(suffix).not.toContain('<TRUNCATED>')
    })

    it('should build suffix with truncation message', () => {
      const suffix = buildAttachmentWrapperSuffix({
        isTruncated: true,
        previewLines: 100,
        totalLines: 1500,
        fileKey: 'key123',
      })

      expect(suffix).toContain('</FILE_CONTENT>')
      expect(suffix).toContain('<TRUNCATED>')
      expect(suffix).toContain('Content truncated')
      expect(suffix).toContain('Showing first 100 of 1500 lines')
      expect(suffix).toContain('FILE_KEY="key123"')
      expect(suffix).toContain('</ATTACHMENT_FILE>')
    })

    it('should end with newline', () => {
      const suffix = buildAttachmentWrapperSuffix({ isTruncated: false })
      expect(suffix).toBe(suffix.trimEnd() + '\n')
    })

    it('should include tool usage hint in truncated message', () => {
      const suffix = buildAttachmentWrapperSuffix({
        isTruncated: true,
        previewLines: 100,
        totalLines: 2000,
        fileKey: 'storage_key_abc',
      })

      expect(suffix).toContain('read_file or search_file_content tool')
      expect(suffix).toContain('FILE_KEY="storage_key_abc"')
    })
  })

  describe('selectMessagesForSendContext', () => {
    const createMessage = (role: 'user' | 'assistant' | 'system', text: string, id = 'msg1'): Message =>
      ({
        id,
        role,
        contentParts: [{ type: 'text', text }],
      }) as Message

    it('should return empty array when msgs is empty', () => {
      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 10 },
        msgs: [],
      })

      expect(result).toEqual([])
    })

    it('should skip messages with error flag', () => {
      const messages: Message[] = [
        createMessage('user', 'hello', 'msg1'),
        { ...createMessage('assistant', 'error response', 'msg2'), error: 'error' },
        createMessage('user', 'retry', 'msg3'),
      ]

      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 10 },
        msgs: messages,
      })

      expect(result).toHaveLength(2)
      expect(result.map((m) => m.id)).toEqual(['msg1', 'msg3'])
    })

    it('should skip messages with errorCode flag', () => {
      const messages: Message[] = [
        createMessage('user', 'hello', 'msg1'),
        { ...createMessage('assistant', 'error response', 'msg2'), errorCode: 500 },
        createMessage('user', 'retry', 'msg3'),
      ]

      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 10 },
        msgs: messages,
      })

      expect(result).toHaveLength(2)
      expect(result.map((m) => m.id)).toEqual(['msg1', 'msg3'])
    })

    it('should exclude messages with generating === true', () => {
      const messages: Message[] = [
        createMessage('user', 'hello', 'msg1'),
        { ...createMessage('assistant', 'generating...', 'msg2'), generating: true },
        createMessage('user', 'another', 'msg3'),
      ]

      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 10 },
        msgs: messages,
      })

      expect(result).toHaveLength(2)
      expect(result.map((m) => m.id)).toEqual(['msg1', 'msg3'])
    })

    it('should respect maxContextMessageCount without preserveLastUserMessage', () => {
      const messages: Message[] = [
        createMessage('user', 'msg1', 'msg1'),
        createMessage('assistant', 'msg2', 'msg2'),
        createMessage('user', 'msg3', 'msg3'),
        createMessage('assistant', 'msg4', 'msg4'),
        createMessage('user', 'msg5', 'msg5'),
      ]

      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 2 },
        msgs: messages,
        preserveLastUserMessage: false,
      })

      expect(result).toHaveLength(2)
      expect(result.map((m) => m.id)).toEqual(['msg4', 'msg5'])
    })

    it('should include maxContextMessageCount + 1 when preserveLastUserMessage is true', () => {
      const messages: Message[] = [
        createMessage('user', 'msg1', 'msg1'),
        createMessage('assistant', 'msg2', 'msg2'),
        createMessage('user', 'msg3', 'msg3'),
        createMessage('assistant', 'msg4', 'msg4'),
        createMessage('user', 'msg5', 'msg5'),
      ]

      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 2 },
        msgs: messages,
        preserveLastUserMessage: true,
      })

      expect(result).toHaveLength(3)
      expect(result.map((m) => m.id)).toEqual(['msg3', 'msg4', 'msg5'])
    })

    it('should return no messages when maxContextMessageCount is 0 without preserveLastUserMessage', () => {
      const messages: Message[] = [createMessage('user', 'msg1', 'msg1'), createMessage('assistant', 'msg2', 'msg2')]

      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 0 },
        msgs: messages,
        preserveLastUserMessage: false,
      })

      expect(result).toEqual([])
    })

    it('should use default keepToolCallRounds = 2', () => {
      const messages: Message[] = [createMessage('user', 'hello', 'msg1')]

      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 10 },
        msgs: messages,
      })

      expect(result).toHaveLength(1)
    })

    it('should handle system message at start', () => {
      const messages: Message[] = [
        createMessage('system', 'You are helpful', 'sys'),
        createMessage('user', 'hello', 'msg1'),
        createMessage('assistant', 'hi', 'msg2'),
      ]

      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 10 },
        msgs: messages,
      })

      expect(result).toHaveLength(3)
      expect(result[0].role).toBe('system')
    })

    it('should filter and respect maxContextMessageCount together', () => {
      const messages: Message[] = [
        createMessage('user', 'msg1', 'msg1'),
        { ...createMessage('assistant', 'error', 'msg2'), error: 'error' },
        createMessage('user', 'msg3', 'msg3'),
        createMessage('assistant', 'msg4', 'msg4'),
        createMessage('user', 'msg5', 'msg5'),
      ]

      const result = selectMessagesForSendContext({
        settings: { maxContextMessageCount: 2 },
        msgs: messages,
        preserveLastUserMessage: false,
      })

      expect(result).toHaveLength(2)
      expect(result.map((m) => m.id)).toEqual(['msg4', 'msg5'])
    })
  })

  describe('wrapper format parity', () => {
    it('should produce exact wrapper format for small file (full content)', () => {
      const prefix = buildAttachmentWrapperPrefix({
        attachmentIndex: 1,
        fileName: 'small.txt',
        fileKey: 'key1',
        fileLines: 50,
        fileSize: 500,
      })

      const suffix = buildAttachmentWrapperSuffix({ isTruncated: false })

      const content = 'line1\nline2\nline3\n'
      const fullWrapper = prefix + content + suffix

      expect(fullWrapper).toMatch(/^\n\n<ATTACHMENT_FILE>\n/)
      expect(fullWrapper).toMatch(/<FILE_INDEX>1<\/FILE_INDEX>\n/)
      expect(fullWrapper).toMatch(/<FILE_NAME>small\.txt<\/FILE_NAME>\n/)
      expect(fullWrapper).toMatch(/<FILE_KEY>key1<\/FILE_KEY>\n/)
      expect(fullWrapper).toMatch(/<FILE_LINES>50<\/FILE_LINES>\n/)
      expect(fullWrapper).toMatch(/<FILE_SIZE>500 bytes<\/FILE_SIZE>\n/)
      expect(fullWrapper).toMatch(/<FILE_CONTENT>\n/)
      expect(fullWrapper).toMatch(/line1\nline2\nline3\n/)
      expect(fullWrapper).toMatch(/<\/FILE_CONTENT>\n/)
      expect(fullWrapper).toMatch(/<\/ATTACHMENT_FILE>\n$/)
    })

    it('should produce exact wrapper format for large file (preview + truncated)', () => {
      const prefix = buildAttachmentWrapperPrefix({
        attachmentIndex: 1,
        fileName: 'large.txt',
        fileKey: 'key2',
        fileLines: 1500,
        fileSize: 15000,
      })

      const suffix = buildAttachmentWrapperSuffix({
        isTruncated: true,
        previewLines: 100,
        totalLines: 1500,
        fileKey: 'key2',
      })

      const previewContent = 'preview line 1\npreview line 2\n'
      const fullWrapper = prefix + previewContent + suffix

      expect(fullWrapper).toMatch(/^\n\n<ATTACHMENT_FILE>\n/)
      expect(fullWrapper).toMatch(/<FILE_LINES>1500<\/FILE_LINES>\n/)
      expect(fullWrapper).toMatch(/<FILE_CONTENT>\n/)
      expect(fullWrapper).toMatch(/preview line 1\npreview line 2\n/)
      expect(fullWrapper).toMatch(/<TRUNCATED>/)
      expect(fullWrapper).toMatch(/Showing first 100 of 1500 lines/)
      expect(fullWrapper).toMatch(/<\/ATTACHMENT_FILE>\n$/)
    })
  })
})
