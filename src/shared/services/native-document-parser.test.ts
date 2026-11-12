import { describe, expect, it, vi } from 'vitest'
import { parseNativeChatboxAIDocument } from './native-document-parser'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('native document parser service', () => {
  it('uploads the original file before requesting parsed content', async () => {
    const events: string[] = []
    const fetchFn = vi.fn<typeof fetch>((input, init) => {
      const url = String(input)
      if (url.endsWith('/api/files/generate-upload-url')) {
        events.push('generate')
        expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'license-1' }))
        return Promise.resolve(jsonResponse({ data: { url: 'https://upload.example/file', filename: 'stored.xlsx' } }))
      }
      events.push('create')
      expect(JSON.parse(String(init?.body))).toEqual({
        licenseKey: 'license-1',
        filename: 'stored.xlsx',
        filetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        returnContent: true,
      })
      return Promise.resolve(jsonResponse({ data: { uuid: 'file-1', content: 'Sheet 1\nvalue' } }))
    })
    const upload = vi.fn((url: string) => {
      events.push('upload')
      expect(url).toBe('https://upload.example/file')
      return Promise.resolve()
    })

    await expect(
      parseNativeChatboxAIDocument(
        'license-1',
        {
          filename: 'report.xlsx',
          filetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upload,
        },
        { fetchFn }
      )
    ).resolves.toBe('Sheet 1\nvalue')
    expect(events).toEqual(['generate', 'upload', 'create'])
  })

  it('surfaces API failures and does not upload after a rejected signed-url request', async () => {
    const upload = vi.fn<(url: string) => Promise<void>>()
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { message: 'license required' } }, 401))

    await expect(
      parseNativeChatboxAIDocument('', { filename: 'report.pdf', filetype: 'application/pdf', upload }, { fetchFn })
    ).rejects.toThrow('license required')
    expect(upload).not.toHaveBeenCalled()
  })
})
