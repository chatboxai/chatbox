import { isPdfFilePath } from '@shared/file-extensions'
import {
  LOCAL_PARSER_FILE_TOO_LARGE_ERROR,
  LOCAL_PARSER_MAX_PDF_FILE_SIZE,
  LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR,
} from '@shared/file-parse-errors'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

type PdfTextItem = {
  str: string
  hasEOL: boolean
  transform: number[]
  height: number
}

function formatPdfPageMarker(pageNumber: number): string {
  return `==== Page ${pageNumber} ====`
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof (item as PdfTextItem).str === 'string' &&
    Array.isArray((item as PdfTextItem).transform)
  )
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  return pdfjs
}

export async function parsePdfFileLocally(
  file: File,
  options: { signal?: AbortSignal; failOnPageError?: boolean } = {}
): Promise<string> {
  const { signal } = options
  signal?.throwIfAborted()
  if (!isPdfFilePath(file.name)) {
    throw new Error('local_parser_failed')
  }

  if (file.size > LOCAL_PARSER_MAX_PDF_FILE_SIZE) {
    throw new Error(LOCAL_PARSER_FILE_TOO_LARGE_ERROR)
  }

  const { getDocument } = await loadPdfjs()
  signal?.throwIfAborted()
  const data = new Uint8Array(await file.arrayBuffer())
  signal?.throwIfAborted()
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
  })
  let destruction: Promise<void> | undefined
  const destroy = () => (destruction ??= loadingTask.destroy())
  let abort: (() => void) | undefined
  const canceled = new Promise<never>((_, reject) => {
    abort = () => {
      void destroy().catch(() => undefined)
      reject(signal?.reason ?? new DOMException('PDF parsing canceled', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })

  try {
    const document = await Promise.race([loadingTask.promise, canceled])
    const pageTexts: string[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      signal?.throwIfAborted()
      try {
        const page = await Promise.race([document.getPage(pageNumber), canceled])
        try {
          const textContent = await Promise.race([page.getTextContent(), canceled])
          signal?.throwIfAborted()
          let pageText = ''
          let lastY: number | undefined

          for (const item of textContent.items) {
            if (!isPdfTextItem(item)) {
              continue
            }

            if (item.str === '') {
              if (item.hasEOL && pageText && !pageText.endsWith('\n')) {
                pageText += '\n'
              }
              continue
            }

            const y = item.transform[5] ?? 0
            const fontHeight = item.height || Math.abs(item.transform[3] ?? 0) || 0
            const lineTolerance = fontHeight * 0.5
            if (pageText && !pageText.endsWith('\n') && lastY !== undefined && Math.abs(y - lastY) > lineTolerance) {
              pageText += '\n'
            }
            pageText += item.str
            if (item.hasEOL) {
              pageText += '\n'
            }
            lastY = y
          }

          pageTexts.push(pageText.trim())
        } finally {
          page.cleanup()
        }
      } catch (error) {
        signal?.throwIfAborted()
        if (options.failOnPageError) throw error
        pageTexts.push('')
      }
    }

    if (pageTexts.every((text) => text === '')) {
      return ''
    }

    return pageTexts.map((text, i) => `${formatPdfPageMarker(i + 1)}\n\n${text}`).join('\n\n')
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new Error(LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR)
    }
    throw error
  } finally {
    if (abort) signal?.removeEventListener('abort', abort)
    await destroy()
  }
}
