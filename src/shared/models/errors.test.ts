import { describe, expect, it } from 'vitest'
import {
  AIProviderNoImplementedChatError,
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  CodedError,
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

describe('CodedError', () => {
  it('constructor sets detail and code from detail', () => {
    const detail = {
      name: 'custom_error',
      code: 29999,
      i18nKey: 'custom.i18n.key',
    }
    const error = new CodedError('service failed', detail, 'req-123')

    expect(error.message).toBe('service failed')
    expect(error.detail).toEqual(detail)
    expect(error.code).toBe(29999)
    expect(error.requestId).toBe('req-123')
  })

  it('fromCodeName returns CodedError for known local/provider codename', () => {
    const error = CodedError.fromCodeName('rate limited', 'rate_limit_exceeded', 'req-123')

    expect(error).toBeInstanceOf(CodedError)
    expect(error?.message).toBe('rate limited')
    expect(error?.code).toBe(20005)
    expect(error?.detail.name).toBe('rate_limit_exceeded')
    expect(error?.requestId).toBe('req-123')
  })

  it('fromCodeName returns null for unknown codename', () => {
    const error = CodedError.fromCodeName('failed', 'not_a_real_codename')

    expect(error).toBeNull()
  })

  it('fromCodeName returns null for empty codename', () => {
    const error = CodedError.fromCodeName('failed', '')

    expect(error).toBeNull()
  })

  it('getDetail returns detail for known code', () => {
    const detail = CodedError.getDetail(20005)

    expect(detail).not.toBeNull()
    expect(detail?.name).toBe('rate_limit_exceeded')
    expect(detail?.code).toBe(20005)
    expect(typeof detail?.i18nKey).toBe('string')
  })

  it('getDetail returns null for unknown code', () => {
    const detail = CodedError.getDetail(99999)

    expect(detail).toBeNull()
  })

  it('getDetail returns null for 0 or falsy code', () => {
    expect(CodedError.getDetail(0)).toBeNull()
    expect(CodedError.getDetail(Number.NaN)).toBeNull()
  })
})

describe('Error inheritance', () => {
  it('all exported errors are instanceof Error and BaseError', () => {
    const workspaiceDetail = CodedError.getDetail(20005)
    expect(workspaiceDetail).not.toBeNull()
    if (!workspaiceDetail) {
      throw new Error('Expected local provider error detail')
    }

    const errors = [
      new BaseError('base'),
      new ApiError('api'),
      new NetworkError('network', 'example.com'),
      new AIProviderNoImplementedPaintError('ProviderA'),
      new AIProviderNoImplementedChatError('ProviderB'),
      new OCRError('ocr-provider', new Error('ocr failed')),
      new CodedError('workspaice', workspaiceDetail),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(BaseError)
    }
  })
})
