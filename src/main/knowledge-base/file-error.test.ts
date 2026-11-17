import { describe, expect, it } from 'vitest'
import { CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR } from '../../shared/file-parse-errors'
import { normalizeKnowledgeBaseFileError } from './file-error'

describe('normalizeKnowledgeBaseFileError', () => {
  it('preserves stable error codes for renderer-side presentation', () => {
    expect(normalizeKnowledgeBaseFileError(CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR)).toBe(
      CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR
    )
  })

  it('stores the Chatbox AI error code from JSON API failures', () => {
    const errorMessage = '{"error":{"code":"token_quota_exhausted","title":"Token Quota Exhausted","status":499}}'

    expect(normalizeKnowledgeBaseFileError(errorMessage)).toBe('token_quota_exhausted')
  })

  it('keeps extracting a user-facing message from JSON API failures', () => {
    const errorMessage =
      'Status Code 500, {"error":{"code":"unknown_api_error","detail":"Server unavailable","status":500}}'

    expect(normalizeKnowledgeBaseFileError(errorMessage)).toBe('Server unavailable')
  })
})
