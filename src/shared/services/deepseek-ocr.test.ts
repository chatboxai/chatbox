import { describe, expect, it, vi } from 'vitest'
import { LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR } from '../file-parse-errors'
import {
  cleanDeepSeekOcrText,
  DeepSeekToolError,
  getDeepSeekParserErrorCode,
  isDeepSeekOcrFile,
  recognizeDocumentWithDeepSeek,
} from './deepseek-ocr'

const PDF = new Uint8Array([37, 80, 68, 70, 45])

function textResponse(body: string, status = 200) {
  return new Response(body, { status })
}

function ocrResult(pages: Array<{ index: number; text: string; finish_reason?: 'stop' | 'length' }>) {
  return JSON.stringify({
    id: 'ocr-1',
    object: 'ocr.result',
    created: 1762790000,
    purpose: 'text_recognition',
    page_count: pages.length,
    pages: pages.map((page) => ({ finish_reason: 'stop', ...page })),
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  })
}

function recognize(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  return recognizeDocumentWithDeepSeek({
    apiKey: ' ds-key ',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    data: PDF,
    fetch,
  })
}

describe('recognizeDocumentWithDeepSeek', () => {
  it('posts a two-field multipart form with purpose before the named file', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => textResponse(ocrResult([{ index: 0, text: 'Hi' }])))

    await recognize(fetch)

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/v1/tools/ocr')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ds-key')
    const boundary = headers['Content-Type'].match(/^multipart\/form-data; boundary=(.+)$/)?.[1]
    expect(boundary).toBeTruthy()
    const body = new TextDecoder('latin1').decode(init.body as Uint8Array)
    const parts = body.split(`--${boundary}`).filter((part) => part.includes('Content-Disposition'))
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain('Content-Disposition: form-data; name="purpose"\r\n\r\ntext_recognition\r\n')
    expect(parts[1]).toContain(
      'Content-Disposition: form-data; name="file"; filename="report.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-'
    )
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true)
  })

  it('parses a result after keep-alive newlines and joins pages in index order', async () => {
    const fetch = vi.fn(async () =>
      textResponse(
        `\n\n\n${ocrResult([
          { index: 1, text: 'Second page', finish_reason: 'length' },
          { index: 0, text: '<｜ref｜>Title<｜/ref｜><｜box｜>[[52, 40, 948, 96]]<｜/box｜>\nFirst page' },
        ])}`
      )
    )

    await expect(recognize(fetch)).resolves.toEqual({
      text: 'Title\nFirst page\n\nSecond page',
      truncatedPages: [1],
    })
  })

  it('reports an error object returned with HTTP 200', async () => {
    const fetch = vi.fn(async () =>
      textResponse(
        '\n\n{"error":{"message":"OCR did not finish in time","type":"gateway_timeout_error","param":null,"code":"gateway_timeout_error"}}'
      )
    )
    const error = await recognize(fetch).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DeepSeekToolError)
    expect((error as DeepSeekToolError).message).toBe('OCR did not finish in time')
    expect((error as DeepSeekToolError).status).toBe(200)
  })

  it('reports HTTP failures with the DeepSeek message and status', async () => {
    const fetch = vi.fn(async () =>
      textResponse('{"error":{"message":"Insufficient Balance","type":"payment_required"}}', 402)
    )
    await expect(recognize(fetch)).rejects.toMatchObject({ status: 402, message: 'Insufficient Balance' })

    const plain = vi.fn(async () => textResponse('Bad Gateway', 502))
    await expect(recognize(plain)).rejects.toMatchObject({
      status: 502,
      message: 'DeepSeek OCR failed with status 502',
    })
  })

  it('rejects a response without pages', async () => {
    const fetch = vi.fn(async () => textResponse('{"id":"ocr-1"}'))
    await expect(recognize(fetch)).rejects.toThrow('DeepSeek returned an invalid OCR response')
  })

  it('requires the API key before uploading', async () => {
    const fetch = vi.fn()
    await expect(
      recognizeDocumentWithDeepSeek({ apiKey: ' ', fileName: 'a.pdf', mimeType: '', data: PDF, fetch })
    ).rejects.toThrow('DeepSeek API key is required')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('cleanDeepSeekOcrText', () => {
  it('keeps referenced text and drops coordinates', () => {
    expect(
      cleanDeepSeekOcrText(
        '<｜ref｜>Title<｜/ref｜><｜box｜>[[52, 40, 948, 96]]<｜/box｜>\n<｜ref｜>Body<｜/ref｜><｜box｜>[[1, 2, 3, 4], [5, 6, 7, 8]]<｜/box｜> text'
      )
    ).toBe('Title\nBody text')
    expect(cleanDeepSeekOcrText('Plain extracted text')).toBe('Plain extracted text')
  })
})

describe('isDeepSeekOcrFile', () => {
  it.each([
    'a.pdf',
    'b.DOCX',
    'c.doc',
    'd.ppt',
    'e.pptx',
    'f.png',
    'g.jpeg',
    'h.jpg',
    'i.webp',
    'j.gif',
    'k.bmp',
    'l.tiff',
    'm.tif',
  ])('accepts %s', (name) => expect(isDeepSeekOcrFile(name)).toBe(true))
  it.each(['a.xlsx', 'b.epub', 'c.csv', 'noext'])('rejects %s', (name) => expect(isDeepSeekOcrFile(name)).toBe(false))
})

describe('getDeepSeekParserErrorCode', () => {
  it('maps insufficient balance and oversized files', () => {
    expect(getDeepSeekParserErrorCode(new DeepSeekToolError('Payment required', 402))).toBe(
      'deepseek_insufficient_balance'
    )
    expect(getDeepSeekParserErrorCode(new DeepSeekToolError('Payload too large', 413))).toBe(
      'deepseek_parser_file_too_large'
    )
    expect(getDeepSeekParserErrorCode(new DeepSeekToolError('The PDF has more than 1000 pages', 400))).toBe(
      'deepseek_parser_file_too_large'
    )
    expect(getDeepSeekParserErrorCode(new DeepSeekToolError('The PDF is password-protected', 400))).toBe(
      LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR
    )
  })

  it('maps other failures to a generic third-party parser error', () => {
    expect(getDeepSeekParserErrorCode(new DeepSeekToolError('invalid api key', 401))).toBe('third_party_parser_failed')
    expect(getDeepSeekParserErrorCode(new Error('network down'))).toBe('third_party_parser_failed')
  })
})
