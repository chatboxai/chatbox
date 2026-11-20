/**
 * HEIC/HEIF decoding for image inputs.
 *
 * Chromium (and therefore the Android WebView) cannot decode HEIC/HEIF with
 * `<img>` or `createImageBitmap`, so an iPhone photo would otherwise arrive as an
 * unreadable blob and vision models would never see it. libheif compiled to
 * WebAssembly fills that gap locally: no upload, no native plugin.
 */

import { getLogger } from '@/lib/utils'

const log = getLogger('heic-image')

const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

const HEIC_EXTENSION = /\.(?:heic|heif)$/i

/** ISO-BMFF `ftyp` brands produced by HEIF/HEIC encoders (offset 4..12). */
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'mif2',
  'msf1',
  'avif',
  'avis',
])

/** Refuse absurd inputs before allocating an RGBA buffer. */
const MAX_HEIC_PIXELS = 60_000_000

interface HeifImage {
  get_width(): number
  get_height(): number
  is_primary(): boolean
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    callback: (result?: { data: Uint8ClampedArray; width: number; height: number } | null) => void
  ): void
}

interface HeifDecoder {
  decode(data: Uint8Array): HeifImage[]
}

interface HeifModule {
  HeifDecoder: new () => HeifDecoder
}

/** True when the file is a HEIC/HEIF image, judged by MIME type, name or magic bytes. */
export function isHeicImage(file: { type?: string; name?: string }): boolean {
  const type = file.type?.toLowerCase() ?? ''
  if (HEIC_MIME_TYPES.has(type)) return true
  if (HEIC_EXTENSION.test(file.name ?? '')) return true
  return false
}

/** True when the first bytes look like an ISO-BMFF container with a HEIF brand. */
export function hasHeicMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7])
  if (boxType !== 'ftyp') return false
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
  return HEIC_BRANDS.has(brand)
}

async function loadLibheif(): Promise<HeifModule> {
  try {
    const imported = (await import('libheif-js')) as unknown as HeifModule & { default?: HeifModule }
    // The package is CommonJS: depending on the bundler the module object lands on
    // `default` or on the namespace itself.
    return imported.default ?? imported
  } catch (error) {
    log.warn('Failed to load the HEIC decoder:', error instanceof Error ? error.message : String(error))
    throw error
  }
}

/**
 * Decode the primary image of a HEIC/HEIF file into RGBA pixels.
 * Throws on corrupt files or when the image is too large to hold in memory.
 */
export async function decodeHeicToImageData(source: ArrayBuffer | Uint8Array): Promise<ImageData> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source)
  if (bytes.length === 0) throw new Error('HEIC file is empty')
  const libheif = await loadLibheif()
  if (typeof libheif.HeifDecoder !== 'function') throw new Error('HEIC decoder is unavailable')

  const images = new libheif.HeifDecoder().decode(bytes)
  const image = images.find((candidate) => candidate.is_primary()) ?? images[0]
  if (!image) throw new Error('HEIC file contains no image')
  const width = image.get_width()
  const height = image.get_height()
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('HEIC image has invalid dimensions')
  }
  if (width * height > MAX_HEIC_PIXELS) {
    throw new Error(`HEIC image is too large to decode (${width}x${height})`)
  }

  const frame = new Uint8ClampedArray(width * height * 4)
  await new Promise<void>((resolve, reject) => {
    image.display({ data: frame, width, height }, (result) => {
      if (!result) {
        reject(new Error('HEIC decoding failed'))
        return
      }
      resolve()
    })
  })
  const pixels = frame.some((value) => value !== 0) ? frame : new Uint8ClampedArray(width * height * 4)
  return new ImageData(pixels, width, height)
}
