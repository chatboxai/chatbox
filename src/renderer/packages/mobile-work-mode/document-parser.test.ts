// @vitest-environment jsdom
import NiceModal from '@ebay/nice-modal-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capacitorDocumentParser } from './document-parser'

const mocks = vi.hoisted(() => ({ local: vi.fn(), pdf: vi.fn(), cloud: vi.fn(), license: vi.fn() }))
vi.mock('./execution-service', () => ({ capacitorExecution: { parseDocument: mocks.local } }))
vi.mock('@/packages/pdf-parser', () => ({ parsePdfFileLocally: mocks.pdf }))
vi.mock('@/packages/remote', () => ({ uploadAndParseUserFile: mocks.cloud }))
vi.mock('@/stores/settingActions', () => ({ getLicenseKey: mocks.license }))
vi.mock('@ebay/nice-modal-react', () => ({ default: { show: vi.fn(), hide: vi.fn() } }))
vi.mock('@/i18n', () => ({
  default: { t: (key: string, args?: { filename?: string }) => key.replace('{{filename}}', args?.filename ?? '') },
}))

const parse = (name: string, signal = new AbortController().signal) =>
  capacitorDocumentParser.parse(`input/${name}`, btoa('fixture'), signal)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.license.mockReturnValue('test-license')
  mocks.cloud.mockResolvedValue('Cloud document text')
  vi.mocked(NiceModal.show).mockResolvedValue(true)
})

describe('mobile work document parsing', () => {
  it.each(['report.docx', 'table.xlsx', 'deck.pptx'])(
    'parses %s locally without cloud consent or a license',
    async (name) => {
      mocks.license.mockReturnValue('')
      mocks.local.mockResolvedValue({ text: 'Local text', truncated: true })
      expect(await parse(name)).toEqual({ text: 'Local text', truncated: true })
      expect(mocks.cloud).not.toHaveBeenCalled()
      expect(NiceModal.show).not.toHaveBeenCalled()
    }
  )

  it('uses the existing PDF parser and bounds its result', async () => {
    mocks.pdf.mockResolvedValue('p'.repeat(100001))
    const signal = new AbortController().signal
    expect(await parse('REPORT.PDF', signal)).toEqual({ text: 'p'.repeat(100000), truncated: true })
    expect(mocks.pdf.mock.calls[0][0]).toMatchObject({ name: 'REPORT.PDF', type: 'application/pdf' })
    expect(mocks.pdf.mock.calls[0][1]).toEqual({ signal, failOnPageError: true })
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it.each([
    ['report.doc', 'application/msword'],
    ['table.xls', 'application/vnd.ms-excel'],
    ['deck.ppt', 'application/vnd.ms-powerpoint'],
  ])('uploads %s only after consent, with the original bytes and MIME type', async (name, type) => {
    const signal = new AbortController().signal
    expect(await parse(name, signal)).toEqual({ text: 'Cloud document text', truncated: false })
    expect(mocks.local).not.toHaveBeenCalled()
    expect(mocks.pdf).not.toHaveBeenCalled()
    const file = mocks.cloud.mock.calls[0][1] as File
    expect(file).toMatchObject({ name, type, size: 7 })
    expect(mocks.cloud).toHaveBeenCalledWith('test-license', file, signal)
    expect(NiceModal.show).toHaveBeenCalledWith(
      'confirm',
      expect.objectContaining({ message: expect.stringContaining('compute points') })
    )
  })

  it.each(['report.pdf', 'report.docx'])('falls back after %s local parsing fails', async (name) => {
    mocks.local.mockRejectedValue(new Error('Invalid archive'))
    mocks.pdf.mockRejectedValue(new Error('Invalid PDF'))
    expect((await parse(name)).text).toBe('Cloud document text')
  })

  it.each(['report.pdf', 'report.docx'])('falls back after %s local parsing returns empty text', async (name) => {
    mocks.local.mockResolvedValue({ text: ' \n', truncated: false })
    mocks.pdf.mockResolvedValue('')
    expect((await parse(name)).text).toBe('Cloud document text')
  })

  it.each(['pdf_password_protected', 'local_parser_file_too_large'])('surfaces %s without uploading', async (code) => {
    mocks.pdf.mockRejectedValue(new Error(code))
    await expect(parse('report.pdf')).rejects.toThrow(code)
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('requires a license before asking to upload', async () => {
    mocks.license.mockReturnValue('')
    await expect(parse('report.doc')).rejects.toThrow('Sign in to Chatbox AI')
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('uses the attachment filename in cloud consent and upload', async () => {
    await parse('66696c653a31-42-report.doc')
    expect(mocks.cloud.mock.calls[0][1]).toMatchObject({ name: '42-report.doc' })
    expect(NiceModal.show).toHaveBeenCalledWith(
      'confirm',
      expect.objectContaining({ message: expect.stringContaining('"42-report.doc"') })
    )
  })

  it('does not upload when consent is declined', async () => {
    vi.mocked(NiceModal.show).mockResolvedValue(false)
    await expect(parse('report.doc')).rejects.toThrow('declined')
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('cancels a pending consent dialog without uploading', async () => {
    vi.mocked(NiceModal.show).mockImplementation(() => new Promise(() => undefined))
    const controller = new AbortController()
    const result = parse('report.doc', controller.signal)
    const rejected = expect(result).rejects.toThrow(/stopped|aborted/)
    await vi.waitFor(() => expect(NiceModal.show).toHaveBeenCalled())
    controller.abort()
    await rejected
    expect(NiceModal.hide).toHaveBeenCalledWith('confirm')
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('does not upload when local parsing completes after cancellation', async () => {
    const controller = new AbortController()
    mocks.pdf.mockImplementation(async () => {
      controller.abort()
      return ''
    })
    await expect(parse('report.pdf', controller.signal)).rejects.toThrow(/stopped|aborted/)
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('preserves cloud errors and rejects empty cloud results', async () => {
    mocks.cloud.mockRejectedValueOnce(new Error('token_quota_exhausted'))
    await expect(parse('report.xls')).rejects.toThrow('token_quota_exhausted')
    mocks.cloud.mockResolvedValueOnce(' \n')
    await expect(parse('report.xls')).rejects.toThrow('No readable text')
  })

  it('bounds cloud output and rejects unsupported formats before consent', async () => {
    mocks.cloud.mockResolvedValue('c'.repeat(100001))
    expect(await parse('report.doc')).toEqual({ text: 'c'.repeat(100000), truncated: true })
    vi.mocked(NiceModal.show).mockClear()
    await expect(parse('archive.zip')).rejects.toThrow('Document parsing supports')
    expect(NiceModal.show).not.toHaveBeenCalled()
  })
})
