import { describe, expect, test } from 'vitest'
import { BrowserAttachmentAdapter } from './BrowserAttachmentAdapter'

describe('BrowserAttachmentAdapter', () => {
  test('keeps DOM File private while preserving the historical unique key', async () => {
    const file = new File([Uint8Array.from([1, 2, 3])], 'fixture.bin', {
      type: 'application/octet-stream',
      lastModified: 123,
    })
    const adapter = new BrowserAttachmentAdapter(() => '/native/fixture.bin')

    const asset = adapter.fromFile(file)

    expect(asset).toEqual({
      id: 'file:fixture.bin-3-123',
      uri: '/native/fixture.bin',
      name: 'fixture.bin',
      mimeType: 'application/octet-stream',
      size: 3,
      lastModified: 123,
    })
    expect(await adapter.readBytes(asset)).toEqual(Uint8Array.from([1, 2, 3]))
    expect(await adapter.readDataUrl(asset)).toBe('data:application/octet-stream;base64,AQID')

    adapter.release(asset)
    await expect(adapter.readBytes(asset)).rejects.toThrow('Picked asset is no longer available')
  })
})
