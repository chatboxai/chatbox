import { LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR } from '../file-parse-errors'
import { encodeMultipart } from '../models/transcription'

type NativeFetchInit = NonNullable<Parameters<typeof fetch>[1]>

const DEEPSEEK_OCR_URL = 'https://api.deepseek.com/v1/tools/ocr'

/** DeepSeek OCR rejects files larger than 100 MiB. */
export const DEEPSEEK_OCR_MAX_FILE_SIZE = 100 * 1024 * 1024

/** File types DeepSeek OCR accepts: PDF, Word, PowerPoint and images. */
const DEEPSEEK_OCR_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
])

export function isDeepSeekOcrFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 && DEEPSEEK_OCR_FILE_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase())
}

/** A failed DeepSeek tool request. `status` is the HTTP status, which is 200 when recognition itself failed. */
export class DeepSeekToolError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'DeepSeekToolError'
  }
}

/** Maps a DeepSeek OCR failure to the attachment error the UI explains. */
export function getDeepSeekParserErrorCode(error: unknown): string {
  if (!(error instanceof DeepSeekToolError)) return 'third_party_parser_failed'
  if (error.status === 402) return 'deepseek_insufficient_balance'
  if (error.status === 413 || /too large|more than 1000 pages/i.test(error.message)) {
    return 'deepseek_parser_file_too_large'
  }
  if (/password-protected/i.test(error.message)) return LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR
  return 'third_party_parser_failed'
}

/**
 * Removes the grounding tokens DeepSeek OCR leaves in page-by-page output, keeping the referenced text:
 * `<｜ref｜>Title<｜/ref｜><｜box｜>[[52, 40, 948, 96]]<｜/box｜>` becomes `Title`.
 */
export function cleanDeepSeekOcrText(text: string): string {
  return text
    .replace(/<｜box｜>[\s\S]*?<｜\/box｜>/g, '')
    .replace(/<｜ref｜>([\s\S]*?)<｜\/ref｜>/g, '$1')
    .trim()
}

function errorMessage(payload: unknown): string | undefined {
  const message = (payload as { error?: { message?: unknown } } | null)?.error?.message
  return typeof message === 'string' && message.trim() ? message.trim() : undefined
}

function parseJson(text: string): unknown {
  try {
    // While recognizing, the service sends newlines to keep the connection alive before the JSON object.
    return JSON.parse(text.trim())
  } catch {
    return null
  }
}

/**
 * Recognizes the text of a PDF, Word, PowerPoint or image file with DeepSeek OCR (`text_recognition`) and returns
 * the cleaned text of every page in page order, plus the indexes of pages whose output was cut off.
 */
export async function recognizeDocumentWithDeepSeek(input: {
  apiKey: string
  fileName: string
  mimeType: string
  data: Uint8Array
  fetch: (url: string, init: RequestInit) => Promise<Response>
  signal?: AbortSignal
}): Promise<{ text: string; truncatedPages: number[] }> {
  const apiKey = input.apiKey.trim()
  if (!apiKey) throw new Error('DeepSeek API key is required')
  // The service accepts exactly these two fields; the format is detected from the file content.
  const { body, contentType } = encodeMultipart(
    { purpose: 'text_recognition' },
    {
      name: 'file',
      fileName: input.fileName,
      contentType: input.mimeType || 'application/octet-stream',
      data: input.data,
    }
  )
  const response = await input.fetch(DEEPSEEK_OCR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': contentType },
    body,
    signal: input.signal as NativeFetchInit['signal'],
  })
  const payload = parseJson(await response.text())
  if (!response.ok) {
    throw new DeepSeekToolError(
      errorMessage(payload) ?? `DeepSeek OCR failed with status ${response.status}`,
      response.status
    )
  }
  if ((payload as { error?: unknown } | null)?.error) {
    throw new DeepSeekToolError(errorMessage(payload) ?? 'DeepSeek OCR failed', response.status)
  }
  const pages = (payload as { pages?: unknown } | null)?.pages
  if (!Array.isArray(pages)) throw new DeepSeekToolError('DeepSeek returned an invalid OCR response', response.status)

  const ordered = pages
    .flatMap((page: unknown) => {
      const { index, text, finish_reason } = (page ?? {}) as Record<string, unknown>
      return typeof index === 'number' && typeof text === 'string' ? [{ index, text, finish_reason }] : []
    })
    .sort((a, b) => a.index - b.index)
  return {
    text: ordered
      .map((page) => cleanDeepSeekOcrText(page.text))
      .filter(Boolean)
      .join('\n\n'),
    truncatedPages: ordered.filter((page) => page.finish_reason === 'length').map((page) => page.index),
  }
}
