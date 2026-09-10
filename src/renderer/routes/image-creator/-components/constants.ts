export const MAX_REFERENCE_IMAGES = 14

export const HISTORY_PANEL_WIDTH = 170

export { getRatioOptionsForModel } from '@shared/providers/definitions/image-models'

// Display-only fallback for old generation records. Do not use this for selectable image models.
export const HISTORY_IMAGE_MODEL_DISPLAY_NAMES: Record<string, string> = {
  '': 'GPT Image',
  'chatboxai-paint': 'Chatbox AI Paint',
  'gemini-2.5-flash-image': 'Nano Banana',
  'gemini-3-pro-image-preview': 'Nano Banana Pro',
  'gemini-3-pro-image': 'Nano Banana Pro',
  'gemini-3.1-flash-image-preview': 'Nano Banana 2',
  'gemini-3.1-flash-image': 'Nano Banana 2',
  'gpt-image-1': 'GPT Image 1',
  'gpt-image-1.5': 'GPT Image 1.5',
  'gpt-image-2': 'GPT Image 2',
}

export function blobToDataUrl(blob: string): string {
  if (blob.startsWith('data:')) return blob
  if (blob.startsWith('/9j/') || blob.startsWith('\xff\xd8')) {
    return `data:image/jpeg;base64,${blob}`
  }
  return `data:image/png;base64,${blob}`
}

export function isHttpImageSource(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

export function isDirectImageSource(value: string): boolean {
  return isHttpImageSource(value) || value.startsWith('data:image/') || value.startsWith('blob:')
}

export function getBase64ImageSize(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const cleanup = () => {
      img.onload = null
      img.onerror = null
      // Drop the reference to large base64 strings early.
      try {
        img.src = ''
      } catch {
        // ignore
      }
    }
    img.onload = () => {
      const size = { width: img.width, height: img.height }
      cleanup()
      resolve(size)
    }
    img.onerror = (err) => {
      cleanup()
      reject(err)
    }
    img.src = base64
  })
}

export const GENERATED_IMAGE_LOAD_TIMEOUT_MS = 30_000

export function getImageSizeFromUrl(url: string, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Image loading aborted', 'AbortError'))
      return
    }

    const img = new window.Image()
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      img.onload = null
      img.onerror = null
    }
    const fail = (error: Error) => {
      cleanup()
      img.removeAttribute('src')
      reject(error)
    }
    const abort = () => fail(new DOMException('Image loading aborted', 'AbortError'))
    const timer = setTimeout(() => fail(new Error('Image loading timed out')), GENERATED_IMAGE_LOAD_TIMEOUT_MS)
    signal?.addEventListener('abort', abort, { once: true })
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      cleanup()
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => fail(new Error('Failed to load image'))
    img.src = url
  })
}
