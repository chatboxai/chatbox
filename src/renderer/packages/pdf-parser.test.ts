import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePdfFileLocally } from './pdf-parser'

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn() }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mocks.getDocument,
  GlobalWorkerOptions: {},
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({ default: 'pdf-worker' }))

const file = new File(['fixture'], 'report.pdf', { type: 'application/pdf' })
const content = { items: [{ str: 'Page content', hasEOL: false, transform: [1, 0, 0, 1, 0, 0], height: 1 }] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.destroy.mockResolvedValue(undefined)
})

describe('local PDF parsing', () => {
  it('rejects an already canceled request before starting a PDF worker', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(parsePdfFileLocally(file, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.getDocument).not.toHaveBeenCalled()
  })

  it.each(['loading', 'page', 'text'] as const)('cancels pending %s work and destroys the worker', async (stage) => {
    const pending = deferred<never>()
    const cleanup = vi.fn()
    const page = {
      getTextContent: vi.fn(() => (stage === 'text' ? pending.promise : Promise.resolve(content))),
      cleanup,
    }
    const document = {
      numPages: 2,
      getPage: vi.fn(() => (stage === 'page' ? pending.promise : Promise.resolve(page))),
    }
    mocks.getDocument.mockReturnValue({
      promise: stage === 'loading' ? pending.promise : Promise.resolve(document),
      destroy: mocks.destroy,
    })
    const controller = new AbortController()
    const result = parsePdfFileLocally(file, { signal: controller.signal })
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => {
      if (stage === 'loading') expect(mocks.getDocument).toHaveBeenCalledOnce()
      else if (stage === 'page') expect(document.getPage).toHaveBeenCalledOnce()
      else expect(page.getTextContent).toHaveBeenCalledOnce()
    })
    controller.abort()
    await rejected
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(document.getPage).toHaveBeenCalledTimes(stage === 'loading' ? 0 : 1)
    expect(cleanup).toHaveBeenCalledTimes(stage === 'text' ? 1 : 0)
  })

  it.each([false, true])('handles partial page failures with failOnPageError=%s', async (failOnPageError) => {
    const failure = new Error('Page extraction failed')
    const cleanup = vi.fn()
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (number: number) => ({
          getTextContent: async () => {
            if (number === 2) throw failure
            return content
          },
          cleanup,
        }),
      }),
      destroy: mocks.destroy,
    })
    if (failOnPageError) {
      await expect(parsePdfFileLocally(file, { failOnPageError })).rejects.toBe(failure)
    } else {
      expect(await parsePdfFileLocally(file)).toBe('==== Page 1 ====\n\nPage content\n\n==== Page 2 ====\n\n')
    }
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('returns empty text for an image-only PDF so callers can use cloud parsing', async () => {
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items: [] }), cleanup: vi.fn() }),
      }),
      destroy: mocks.destroy,
    })
    expect(await parsePdfFileLocally(file, { failOnPageError: true })).toBe('')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('preserves the password-protected PDF error', async () => {
    const error = new Error('Password required')
    error.name = 'PasswordException'
    mocks.getDocument.mockReturnValue({ promise: Promise.reject(error), destroy: mocks.destroy })
    await expect(parsePdfFileLocally(file, { failOnPageError: true })).rejects.toThrow('pdf_password_protected')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
})
