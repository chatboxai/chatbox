import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const decodeMock = vi.fn()

vi.mock('libheif-js', () => ({
  default: {
    HeifDecoder: class {
      decode = decodeMock
    },
  },
}))

import { decodeHeicToImageData, hasHeicMagicBytes, isHeicImage } from './heic-image'

class FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

function heicHeader(brand = 'heic'): Uint8Array {
  const bytes = new Uint8Array(12)
  bytes.set([0, 0, 0, 0x18], 0)
  bytes.set(Array.from('ftyp', (character) => character.charCodeAt(0)), 4)
  bytes.set(Array.from(brand, (character) => character.charCodeAt(0)), 8)
  return bytes
}

/** A fake libheif image that fills the target buffer with a known pattern. */
function fakeImage({
  width = 4,
  height = 2,
  primary = true,
  failDisplay = false,
}: { width?: number; height?: number; primary?: boolean; failDisplay?: boolean } = {}) {
  return {
    get_width: () => width,
    get_height: () => height,
    is_primary: () => primary,
    display: (
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result?: { data: Uint8ClampedArray; width: number; height: number } | null) => void
    ) => {
      if (failDisplay) {
        callback(null)
        return
      }
      for (let index = 0; index < target.data.length; index += 4) {
        target.data[index] = 12
        target.data[index + 1] = 34
        target.data[index + 2] = 56
        target.data[index + 3] = 255
      }
      callback({ data: target.data, width: target.width, height: target.height })
    },
  }
}

beforeEach(() => {
  decodeMock.mockReset()
  vi.stubGlobal('ImageData', FakeImageData)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isHeicImage', () => {
  test('detects HEIC by MIME type', () => {
    expect(isHeicImage({ type: 'image/heic', name: 'photo.bin' })).toBe(true)
    expect(isHeicImage({ type: 'image/heif', name: 'photo.bin' })).toBe(true)
  })

  test('detects HEIC by extension when the MIME type is missing', () => {
    expect(isHeicImage({ type: '', name: 'IMG_0001.HEIC' })).toBe(true)
    expect(isHeicImage({ type: 'application/octet-stream', name: 'shot.heif' })).toBe(true)
  })

  test('ignores other formats', () => {
    expect(isHeicImage({ type: 'image/png', name: 'shot.png' })).toBe(false)
    expect(isHeicImage({ type: 'image/jpeg', name: 'shot.jpg' })).toBe(false)
  })
})

describe('hasHeicMagicBytes', () => {
  test('accepts HEIF brand headers', () => {
    expect(hasHeicMagicBytes(heicHeader('heic'))).toBe(true)
    expect(hasHeicMagicBytes(heicHeader('mif1'))).toBe(true)
    expect(hasHeicMagicBytes(heicHeader('avif'))).toBe(true)
  })

  test('rejects other containers and truncated input', () => {
    expect(hasHeicMagicBytes(heicHeader('isom'))).toBe(false)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(hasHeicMagicBytes(png)).toBe(false)
    expect(hasHeicMagicBytes(new Uint8Array([0, 0, 0]))).toBe(false)
  })
})

describe('decodeHeicToImageData', () => {
  test('decodes the primary image into RGBA pixels', async () => {
    decodeMock.mockReturnValue([fakeImage({ width: 4, height: 2 })])
    const decoded = await decodeHeicToImageData(heicHeader())
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(2)
    expect(decoded.data).toHaveLength(4 * 2 * 4)
    expect(decoded.data[0]).toBe(12)
    expect(decoded.data[3]).toBe(255)
  })

  test('prefers the primary image', async () => {
    decodeMock.mockReturnValue([
      fakeImage({ width: 2, height: 2, primary: false }),
      fakeImage({ width: 8, height: 4, primary: true }),
    ])
    const decoded = await decodeHeicToImageData(heicHeader())
    expect(decoded.width).toBe(8)
  })

  test('rejects empty input and files without images', async () => {
    await expect(decodeHeicToImageData(new Uint8Array())).rejects.toThrow(/empty/i)
    decodeMock.mockReturnValue([])
    await expect(decodeHeicToImageData(heicHeader())).rejects.toThrow(/no image/i)
  })

  test('rejects decoder failures and absurd dimensions', async () => {
    decodeMock.mockReturnValue([fakeImage({ failDisplay: true })])
    await expect(decodeHeicToImageData(heicHeader())).rejects.toThrow(/decoding failed/i)

    decodeMock.mockReturnValue([fakeImage({ width: 10_000, height: 10_000 })])
    await expect(decodeHeicToImageData(heicHeader())).rejects.toThrow(/too large/i)
  })
})
