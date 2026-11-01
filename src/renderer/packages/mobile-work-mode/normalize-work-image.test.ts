import { beforeEach, expect, it, vi } from 'vitest'
const resize = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,YWJj'))
vi.mock('@/packages/pic_utils', () => ({ getImageBase64AndResize: resize }))
import { normalizeWorkImage } from './normalize-work-image'
beforeEach(() => vi.clearAllMocks())
it.each(['png', 'gif', 'webp', 'bmp', 'jpeg'])('normalizes %s without removing alpha', async (format) => {
  await normalizeWorkImage(`data:image/${format};base64,YWJj`, new AbortController().signal, { width: 1, height: 1 })
  expect(resize).toHaveBeenCalledWith(expect.any(File), {
    outputType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    quality: 0.8,
  })
})
