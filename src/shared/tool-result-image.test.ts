import { describe, expect, it } from 'vitest'
import { extractToolResultImage, getToolResultImageReference } from './tool-result-image'

describe('extractToolResultImage', () => {
  it('promotes a standard image storage key without mutating the input', () => {
    const result = {
      file_path: 'chart.png',
      image_storage_key: 'picture:view-image:s1:uuid',
      media_type: 'image/webp',
    }

    expect(extractToolResultImage(result)).toEqual({
      reference: {
        storageKey: 'picture:view-image:s1:uuid',
        mediaType: 'image/webp',
        filePath: 'chart.png',
      },
      storedResult: { file_path: 'chart.png', media_type: 'image/webp' },
    })
    expect(result.image_storage_key).toBe('picture:view-image:s1:uuid')
  })
})

describe('getToolResultImageReference', () => {
  it('prefers the first-class tool-call fields', () => {
    expect(
      getToolResultImageReference({
        result: { file_path: 'chart.png', media_type: 'image/webp' },
        resultImageStorageKey: 'picture:new',
        resultImageMediaType: 'image/webp',
      })
    ).toEqual({ storageKey: 'picture:new', mediaType: 'image/webp', filePath: 'chart.png' })
  })

  it('reads the legacy private JSON shape', () => {
    expect(
      getToolResultImageReference({
        result: {
          file_path: 'legacy.png',
          image_storage_key: 'picture:legacy',
          media_type: 'image/png',
        },
      })
    ).toEqual({ storageKey: 'picture:legacy', mediaType: 'image/png', filePath: 'legacy.png' })
  })
})
