import { describe, expect, test, vi } from 'vitest'
import {
  canRetryKnowledgeBaseFileWithServer,
  getKnowledgeBaseFileErrorLabel,
  getKnowledgeBaseFileErrorStatusLabel,
  getKnowledgeBaseFileErrorTooltip,
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

  test.each(['token_quota_exhausted', 'expired_license'])(
    'keeps server retry available after %s so the user can retry once the account is fixed',
    (error) => {
      expect(canRetryKnowledgeBaseFileWithServer({ error, parsed_remotely: 1 })).toBe(true)
    }
  )

  test('labels account failures by what the user needs to fix', () => {
    const t = (key: string) => key

    expect(getKnowledgeBaseFileErrorStatusLabel('chatbox_ai_parser_license_key_required', t)).toBe('Sign in needed')
    expect(getKnowledgeBaseFileErrorStatusLabel('token_quota_exhausted', t)).toBe('Not enough points')
    expect(getKnowledgeBaseFileErrorStatusLabel('expired_license', t)).toBe('License expired')
    expect(getKnowledgeBaseFileErrorStatusLabel('chatbox_ai_parser_failed', t)).toBeUndefined()
  })

  test('tooltips repeat the status label for account failures and explain other failures', () => {
    const t = (key: string) => key

    expect(getKnowledgeBaseFileErrorTooltip('chatbox_ai_parser_license_key_required', t)).toBe('Sign in needed')
    expect(getKnowledgeBaseFileErrorTooltip('token_quota_exhausted', t)).toBe('Not enough points')
    expect(getKnowledgeBaseFileErrorTooltip('expired_license', t)).toBe('License expired')
    expect(getKnowledgeBaseFileErrorTooltip('Unsupported file type', t)).toBe('Unsupported file type')
  })

  test('renders Chatbox AI error keys as plain tooltip text', () => {
    expect(getKnowledgeBaseFileErrorLabel('token_quota_exhausted', (key) => key)).toBe(
      'You have used up your monthly Chatbox AI quota. Please go to Settings to view your quota usage or upgrade your plan.'
    )
  })

  test('formats parsed-content limits instead of exposing the internal error code', () => {
    const t = vi.fn((key: string, options?: { limit: string }) => (options?.limit ? `${key} ${options.limit}` : key))

    expect(getKnowledgeBaseFileErrorLabel('knowledge_base_parsed_content_too_large', t)).toBe(
      'Parsed document content must be {{limit}} or smaller. 20 MB'
    )
  })
})
