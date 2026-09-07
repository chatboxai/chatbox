import { describe, expect, it, vi } from 'vitest'
import { RendererModelStorageAdapter } from './RendererModelStorageAdapter'

describe('RendererModelStorageAdapter', () => {
  it('preserves picture keys and normalizes stored base64 values', async () => {
    const setBlob = vi.fn(() => Promise.resolve())
    const getBlob = vi.fn(() => Promise.resolve('encoded-image'))
    const adapter = new RendererModelStorageAdapter({ setBlob, getBlob }, (folder) => `picture:${folder}`)

    await expect(adapter.saveImage('session:message:0', 'data:image/png;base64,value')).resolves.toBe(
      'picture:session:message:0'
    )
    expect(setBlob).toHaveBeenCalledWith('picture:session:message:0', 'data:image/png;base64,value')
    await expect(adapter.getImage('picture:session:message:0')).resolves.toBe('data:image/png;base64,encoded-image')
  })

  it('passes remote image URLs through without reading storage', async () => {
    const getBlob = vi.fn(() => Promise.resolve(null))
    const adapter = new RendererModelStorageAdapter({ setBlob: () => Promise.resolve(), getBlob }, (folder) => folder)

    await expect(adapter.getImage('https://example.com/image.png')).resolves.toBe('https://example.com/image.png')
    expect(getBlob).not.toHaveBeenCalled()
  })
})
