import { describe, expect, test, vi } from 'vitest'
import {
  canRetryKnowledgeBaseFileWithServer,
  getKnowledgeBaseFileErrorLabel,
  isChatboxAIParserLicenseRequired,
} from './knowledge-base-file-error'

describe('knowledge base file error policy', () => {
  test('keeps server retry available when the previous attempt stopped before license validation', () => {
    const error = 'chatbox_ai_parser_license_key_required'

    expect(isChatboxAIParserLicenseRequired(error)).toBe(true)
    expect(canRetryKnowledgeBaseFileWithServer({ error, parsed_remotely: 1 })).toBe(true)
  })

  test('does not offer another server retry after a real remote parse failure', () => {
    expect(canRetryKnowledgeBaseFileWithServer({ error: 'chatbox_ai_parser_failed', parsed_remotely: 1 })).toBe(false)
  })

  test('formats parsed-content limits instead of exposing the internal error code', () => {
    const t = vi.fn((key: string, options?: { limit: string }) => (options?.limit ? `${key} ${options.limit}` : key))

    expect(getKnowledgeBaseFileErrorLabel('knowledge_base_parsed_content_too_large', t)).toBe(
      'Parsed document content must be {{limit}} or smaller. 20 MB'
    )
  })
})
