/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERATED_IMAGE_LOAD_TIMEOUT_MS, getImageSizeFromUrl } from './constants'

let images: HTMLImageElement[]

beforeEach(() => {
  images = []
  vi.useFakeTimers()
  vi.spyOn(window, 'Image').mockImplementation(function MockImage() {
    const image = document.createElement('img')
    images.push(image)
    return image
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('generated image loading', () => {
  it('rejects a hanging image after the timeout and releases the request', async () => {
    const load = getImageSizeFromUrl('https://example.com/image.png')
    const rejection = expect(load).rejects.toThrow('Image loading timed out')
    await vi.advanceTimersByTimeAsync(GENERATED_IMAGE_LOAD_TIMEOUT_MS)
    await rejection
    expect(images[0].hasAttribute('src')).toBe(false)
    expect(images[0].onload).toBeNull()
    expect(images[0].onerror).toBeNull()
  })

  it('returns natural dimensions and clears the timeout after success', async () => {
    const load = getImageSizeFromUrl('https://example.com/image.png')
    Object.defineProperties(images[0], { naturalWidth: { value: 1400 }, naturalHeight: { value: 1100 } })
    images[0].dispatchEvent(new Event('load'))
    await expect(load).resolves.toEqual({ width: 1400, height: 1100 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a failed download and allows a fresh request to recover', async () => {
    const failed = getImageSizeFromUrl('https://example.com/image.png')
    images[0].dispatchEvent(new Event('error'))
    await expect(failed).rejects.toThrow('Failed to load image')
    expect(vi.getTimerCount()).toBe(0)
    const retry = getImageSizeFromUrl('https://example.com/image.png')
    images[1].dispatchEvent(new Event('load'))
    await expect(retry).resolves.toBeDefined()
  })

  it('cancels the image request when its query is aborted', async () => {
    const controller = new AbortController()
    const load = getImageSizeFromUrl('https://example.com/image.png', controller.signal)
    controller.abort()
    await expect(load).rejects.toMatchObject({ name: 'AbortError' })
    expect(images[0].hasAttribute('src')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start an already cancelled request', async () => {
    await expect(getImageSizeFromUrl('https://example.com/image.png', AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(images).toHaveLength(0)
  })
})
