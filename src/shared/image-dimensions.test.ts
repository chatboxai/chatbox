import { describe, expect, test } from 'vitest'
import { readRasterImageBounds } from './image-dimensions'

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function gifWithFrames(
  logicalWidth: number,
  logicalHeight: number,
  frames: Array<[number, number, number, number]>
): Uint8Array {
  const bytes = [
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61,
    logicalWidth & 0xff,
    logicalWidth >> 8,
    logicalHeight & 0xff,
    logicalHeight >> 8,
    0,
    0,
    0,
  ]
  for (const [left, top, width, height] of frames) {
    bytes.push(
      0x2c,
      left & 0xff,
      left >> 8,
      top & 0xff,
      top >> 8,
      width & 0xff,
      width >> 8,
      height & 0xff,
      height >> 8,
      0,
      2,
      0
    )
  }
  bytes.push(0x3b)
  return Uint8Array.from(bytes)
}

describe('readRasterImageBounds', () => {
  test('reads PNG dimensions', () => {
    expect(readRasterImageBounds(pngHeader(10_000, 5_000), 'image/png')).toEqual({
      maxWidth: 10_000,
      maxHeight: 5_000,
      maxPixels: 50_000_000,
    })
  })

  test('reads JPEG start-of-frame dimensions', () => {
    const bytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x13, 0x88, 0x27, 0x10, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
    ])
    expect(readRasterImageBounds(bytes, 'image/jpeg')).toEqual({
      maxWidth: 10_000,
      maxHeight: 5_000,
      maxPixels: 50_000_000,
    })
  })

  test('reads GIF and BMP dimensions', () => {
    const gif = gifWithFrames(640, 480, [[0, 0, 640, 480]])
    expect(readRasterImageBounds(gif, 'image/gif')).toEqual({
      maxWidth: 640,
      maxHeight: 480,
      maxPixels: 307_200,
    })

    const bmp = new Uint8Array(26)
    bmp.set([0x42, 0x4d])
    const view = new DataView(bmp.buffer)
    view.setInt32(18, 640, true)
    view.setInt32(22, -480, true)
    expect(readRasterImageBounds(bmp, 'image/bmp')).toEqual({
      maxWidth: 640,
      maxHeight: 480,
      maxPixels: 307_200,
    })
  })

  test('includes every GIF frame rectangle in decode bounds', () => {
    const gif = gifWithFrames(10, 10, [
      [0, 0, 10, 10],
      [2, 3, 20_000, 2],
    ])
    expect(readRasterImageBounds(gif, 'image/gif')).toEqual({
      maxWidth: 20_002,
      maxHeight: 10,
      maxPixels: 200_020,
    })
  })

  test('reads extended WebP canvas dimensions', () => {
    const bytes = new Uint8Array(30)
    bytes.set([0x52, 0x49, 0x46, 0x46], 0)
    bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8)
    bytes.set([0x7f, 0x02, 0], 24)
    bytes.set([0xdf, 0x01, 0], 27)
    expect(readRasterImageBounds(bytes, 'image/webp')).toEqual({
      maxWidth: 640,
      maxHeight: 480,
      maxPixels: 307_200,
    })
  })

  test('rejects truncated headers', () => {
    expect(readRasterImageBounds(pngHeader(640, 480).subarray(0, 20), 'image/png')).toBeNull()
  })
})
