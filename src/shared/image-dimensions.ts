export interface ImageDecodeBounds {
  maxWidth: number
  maxHeight: number
  maxPixels: number
}

function decodeBounds(width: number | undefined, height: number | undefined): ImageDecodeBounds | null {
  return width !== undefined && height !== undefined && width > 0 && height > 0
    ? { maxWidth: width, maxHeight: height, maxPixels: width * height }
    : null
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number | undefined {
  if (offset + 2 > bytes.length) return undefined
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function uint16LittleEndian(bytes: Uint8Array, offset: number): number | undefined {
  if (offset + 2 > bytes.length) return undefined
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number | undefined {
  if (offset + 3 > bytes.length) return undefined
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number | undefined {
  if (offset + 4 > bytes.length) return undefined
  return bytes[offset] * 0x1000000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
}

function int32LittleEndian(bytes: Uint8Array, offset: number): number | undefined {
  if (offset + 4 > bytes.length) return undefined
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true)
}

function pngBounds(bytes: Uint8Array): ImageDecodeBounds | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return null
  }
  return decodeBounds(uint32BigEndian(bytes, 16), uint32BigEndian(bytes, 20))
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function jpegBounds(bytes: Uint8Array): ImageDecodeBounds | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const segmentLength = uint16BigEndian(bytes, offset)
    if (segmentLength === undefined || segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      return decodeBounds(uint16BigEndian(bytes, offset + 5), uint16BigEndian(bytes, offset + 3))
    }
    offset += segmentLength
  }
  return null
}

function skipGifSubBlocks(bytes: Uint8Array, startOffset: number): number | null {
  let offset = startOffset
  while (offset < bytes.length) {
    const blockLength = bytes[offset]
    offset += 1
    if (blockLength === 0) return offset
    if (offset + blockLength > bytes.length) return null
    offset += blockLength
  }
  return null
}

function gifBounds(bytes: Uint8Array): ImageDecodeBounds | null {
  if (bytes.length < 14 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null
  const logicalBounds = decodeBounds(uint16LittleEndian(bytes, 6), uint16LittleEndian(bytes, 8))
  if (!logicalBounds) return null

  let bounds = logicalBounds
  const globalColorTableSize = bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 0x07) + 1) : 0
  let offset = 13 + globalColorTableSize

  while (offset < bytes.length) {
    const blockType = bytes[offset]
    if (blockType === 0x3b) return bounds
    if (blockType === 0x21) {
      if (offset + 2 > bytes.length) return null
      const nextOffset = skipGifSubBlocks(bytes, offset + 2)
      if (nextOffset === null) return null
      offset = nextOffset
      continue
    }
    if (blockType !== 0x2c || offset + 10 > bytes.length) return null

    const left = uint16LittleEndian(bytes, offset + 1)
    const top = uint16LittleEndian(bytes, offset + 3)
    const width = uint16LittleEndian(bytes, offset + 5)
    const height = uint16LittleEndian(bytes, offset + 7)
    const frameBounds = decodeBounds(width, height)
    if (left === undefined || top === undefined || !frameBounds) return null
    const frameRight = left + frameBounds.maxWidth
    const frameBottom = top + frameBounds.maxHeight
    const maxWidth = Math.max(bounds.maxWidth, frameRight)
    const maxHeight = Math.max(bounds.maxHeight, frameBottom)
    bounds = {
      maxWidth,
      maxHeight,
      maxPixels: Math.max(bounds.maxPixels, frameBounds.maxPixels, maxWidth * maxHeight),
    }

    const localColorTableSize = bytes[offset + 9] & 0x80 ? 3 * 2 ** ((bytes[offset + 9] & 0x07) + 1) : 0
    const imageDataOffset = offset + 10 + localColorTableSize
    if (imageDataOffset >= bytes.length) return null
    const nextOffset = skipGifSubBlocks(bytes, imageDataOffset + 1)
    if (nextOffset === null) return null
    offset = nextOffset
  }
  return null
}

function bmpBounds(bytes: Uint8Array): ImageDecodeBounds | null {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null
  const width = int32LittleEndian(bytes, 18)
  const height = int32LittleEndian(bytes, 22)
  return decodeBounds(
    width === undefined ? undefined : Math.abs(width),
    height === undefined ? undefined : Math.abs(height)
  )
}

function webpBounds(bytes: Uint8Array): ImageDecodeBounds | null {
  if (
    bytes.length < 20 ||
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) {
    return null
  }
  const chunkType = String.fromCharCode(...bytes.subarray(12, 16))
  if (chunkType === 'VP8X') {
    const width = uint24LittleEndian(bytes, 24)
    const height = uint24LittleEndian(bytes, 27)
    return decodeBounds(width === undefined ? undefined : width + 1, height === undefined ? undefined : height + 1)
  }
  if (chunkType === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8)
    const height = 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10)
    return decodeBounds(width, height)
  }
  if (chunkType === 'VP8 ') {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    const width = uint16LittleEndian(bytes, 26)
    const height = uint16LittleEndian(bytes, 28)
    return decodeBounds(
      width === undefined ? undefined : width & 0x3fff,
      height === undefined ? undefined : height & 0x3fff
    )
  }
  return null
}

/** Read worst-case declared decode bounds without asking the browser to allocate the bitmap. */
export function readRasterImageBounds(bytes: Uint8Array, mediaType: string): ImageDecodeBounds | null {
  switch (mediaType) {
    case 'image/png':
      return pngBounds(bytes)
    case 'image/jpeg':
      return jpegBounds(bytes)
    case 'image/gif':
      return gifBounds(bytes)
    case 'image/bmp':
      return bmpBounds(bytes)
    case 'image/webp':
      return webpBounds(bytes)
    default:
      return null
  }
}
