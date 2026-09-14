import type { NormalizeWorkImage } from '@shared/mobile-work/view-image'
import { throwIfWorkAborted } from '@shared/mobile-work/abort'
import { getImageBase64AndResize } from '@/packages/pic_utils'

export const normalizeWorkImage: NormalizeWorkImage = async (dataUrl, signal) => {
  throwIfWorkAborted(signal)
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error('Invalid image data')
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0))
  const result = await getImageBase64AndResize(new File([bytes], 'image', { type: match[1] }), {
    outputType: match[1] === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    quality: 0.8,
  })
  throwIfWorkAborted(signal)
  return result
}
