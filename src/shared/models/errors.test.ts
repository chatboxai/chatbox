import { describe, expect, it } from 'vitest'
import {
  AIProviderNoImplementedChatError,
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  ChatboxAIAPIError,
  MESSAGE_ERROR_CODES,
  NetworkError,
  OCRError,
} from './errors'

describe('BaseError', () => {
  it('sets message and default code', () => {
    const error = new BaseError('base failure')

    expect(error.message).toBe('base failure')
    expect(error.code).toBe(1)
  })
})

describe('ApiError', () => {
  it('sets code, prefixes message, and stores responseBody', () => {
    const error = new ApiError('bad request', '{"error":"bad"}', 400, 'req-123')

    expect(error.code).toBe(10001)
    expect(error.message).toBe('API Error: bad request')
    expect(error.responseBody).toBe('{"error":"bad"}')
    expect(error.statusCode).toBe(400)
    expect(error.requestId).toBe('req-123')
  })

  it('keeps responseBody undefined when not provided', () => {
    const error = new ApiError('missing payload')

    expect(error.code).toBe(10001)
    expect(error.message).toBe('API Error: missing payload')
    expect(error.responseBody).toBeUndefined()
  })
})

describe('NetworkError', () => {
  it('sets code, prefixes message, and stores host', () => {
    const error = new NetworkError('connection timeout', 'api.example.com')

    expect(error.code).toBe(10002)
    expect(error.message).toBe('Network Error: connection timeout')
    expect(error.host).toBe('api.example.com')
  })
})

describe('AIProviderNoImplementedPaintError', () => {
  it('sets code and includes provider name in message', () => {
    const error = new AIProviderNoImplementedPaintError('OpenAI')

    expect(error.code).toBe(10003)
    expect(error.message).toContain('OpenAI')
    expect(error.message).toBe('Current AI Provider OpenAI Does Not Support Painting')
  })
})

describe('AIProviderNoImplementedChatError', () => {
  it('sets code and includes provider name in message', () => {
    const error = new AIProviderNoImplementedChatError('OpenAI')

    expect(error.code).toBe(10005)
    expect(error.message).toContain('OpenAI')
    expect(error.message).toBe('Current AI Provider OpenAI Does Not Support Chat Completions API')
  })
})

describe('OCRError', () => {
  it('sets code, stores ocrProvider and cause error', () => {
    const cause = new Error('OCR engine crashed')
    const error = new OCRError('tesseract', cause)

    expect(error.code).toBe(10006)
    expect(error.ocrProvider).toBe('tesseract')
    expect(error.cause).toBe(cause)
    expect(error.message).toBe('OCR Error (tesseract): OCR engine crashed')
  })
})

describe('ChatboxAIAPIError', () => {
  it('constructor sets detail and code from detail', () => {
    const detail = {
      name: 'custom_error',
      code: 29999,
      i18nKey: 'custom.i18n.key',
    }
    const error = new ChatboxAIAPIError('service failed', detail, 'req-123')

    expect(error.message).toBe('service failed')
    expect(error.detail).toEqual(detail)
    expect(error.code).toBe(29999)
    expect(error.requestId).toBe('req-123')
  })

  it('fromCodeName returns ChatboxAIAPIError for known codename', () => {
    const error = ChatboxAIAPIError.fromCodeName('quota exceeded', 'token_quota_exhausted', 'req-123')

    expect(error).toBeInstanceOf(ChatboxAIAPIError)
    expect(error?.message).toBe('quota exceeded')
    expect(error?.code).toBe(10004)
    expect(error?.detail.name).toBe('token_quota_exhausted')
    expect(error?.requestId).toBe('req-123')
  })

  it('maps quota codenames to distinct client error codes', () => {
    const freeError = ChatboxAIAPIError.fromCodeName('daily quota exhausted', 'free_token_quota_exhausted')
    const error = ChatboxAIAPIError.fromCodeName(
      'reward quota available',
      'free_agent_mode_token_quota_exhausted',
      'req-agent-reward'
    )

    expect(freeError?.code).toBe(20039)
    expect(freeError?.detail.name).toBe('free_token_quota_exhausted')
    expect(error).toBeInstanceOf(ChatboxAIAPIError)
    expect(error?.code).toBe(20040)
    expect(error?.detail.name).toBe('free_agent_mode_token_quota_exhausted')
    expect(error?.requestId).toBe('req-agent-reward')
  })

  it('fromCodeName returns null for unknown codename', () => {
    const error = ChatboxAIAPIError.fromCodeName('failed', 'not_a_real_codename')

    expect(error).toBeNull()
  })

  it('fromCodeName returns null for empty codename', () => {
    const error = ChatboxAIAPIError.fromCodeName('failed', '')

    expect(error).toBeNull()
  })

  it.each([
    [10004, 'token_quota_exhausted'],
    [20039, 'free_token_quota_exhausted'],
    [20040, 'free_agent_mode_token_quota_exhausted'],
    [20036, 'searxng_base_url_required'],
    [MESSAGE_ERROR_CODES.FILE_PREPROCESS_FAILED, 'file_preprocess_failed'],
    [MESSAGE_ERROR_CODES.FILE_STORAGE_QUOTA_EXCEEDED, 'file_storage_quota_exceeded'],
    [MESSAGE_ERROR_CODES.EMPTY_ATTACHMENT_CONTENT, 'empty_attachment_content'],
    [20046, 'chatbox_ai_parser_license_key_required'],
  ] as const)('getDetail maps client error code %s to %s', (code, name) => {
    const detail = ChatboxAIAPIError.getDetail(code)

    expect(detail).not.toBeNull()
    expect(detail?.name).toBe(name)
    expect(detail?.code).toBe(code)
    expect(typeof detail?.i18nKey).toBe('string')
  })

  it('getDetail returns null for unknown code', () => {
    const detail = ChatboxAIAPIError.getDetail(99999)

    expect(detail).toBeNull()
  })

  it('getDetail returns null for 0 or falsy code', () => {
    expect(ChatboxAIAPIError.getDetail(0)).toBeNull()
    expect(ChatboxAIAPIError.getDetail(Number.NaN)).toBeNull()
  })

  it('keeps every persisted message error code unique', () => {
    const codes = Object.values(MESSAGE_ERROR_CODES)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('Error inheritance', () => {
  it('all exported errors are instanceof Error and BaseError', () => {
    const chatboxDetail = ChatboxAIAPIError.getDetail(10004)
    expect(chatboxDetail).not.toBeNull()

    const errors = [
      new BaseError('base'),
      new ApiError('api'),
      new NetworkError('network', 'example.com'),
      new AIProviderNoImplementedPaintError('ProviderA'),
      new AIProviderNoImplementedChatError('ProviderB'),
      new OCRError('ocr-provider', new Error('ocr failed')),
      new ChatboxAIAPIError('chatbox', chatboxDetail!),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(BaseError)
    }
  })
})
