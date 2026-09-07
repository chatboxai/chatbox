import { describe, expect, it } from 'vitest'
import {
  buildViewImageToolResultContent,
  buildViewImageUserMessage,
  parseViewImageToolResult,
  supportsToolResultImages,
} from './view-image'

describe('parseViewImageToolResult', () => {
  it('accepts a well-formed result', () => {
    const result = {
      file_path: 'chart.png',
      image_storage_key: 'picture:view-image:s1:uuid',
      media_type: 'image/png',
    }
    expect(parseViewImageToolResult(result)).toEqual(result)
  })

  it('rejects results with missing or empty fields', () => {
    expect(parseViewImageToolResult(null)).toBeNull()
    expect(parseViewImageToolResult('error')).toBeNull()
    expect(parseViewImageToolResult({ error: 'boom' })).toBeNull()
    expect(parseViewImageToolResult({ file_path: 'a.png', image_storage_key: '', media_type: 'image/png' })).toBeNull()
    expect(parseViewImageToolResult({ file_path: 'a.png', media_type: 'image/png' })).toBeNull()
  })
})

describe('supportsToolResultImages', () => {
  it('allows protocols whose providers encode media in tool results', () => {
    expect(supportsToolResultImages('anthropic')).toBe(true)
    expect(supportsToolResultImages('google')).toBe(true)
    expect(supportsToolResultImages('openai-responses')).toBe(true)
  })

  it('excludes chat-completions style protocols', () => {
    expect(supportsToolResultImages('openai')).toBe(false)
    expect(supportsToolResultImages(undefined)).toBe(false)
  })
})

describe('buildViewImageUserMessage', () => {
  it('builds the shared user-message shape for one or more images', () => {
    expect(
      buildViewImageUserMessage([
        { filePath: 'chart.png', base64Data: 'Q0hBUlQ=', mediaType: 'image/png' },
        { filePath: 'photo.jpg', base64Data: 'UEhPVE8=', mediaType: 'image/jpeg' },
      ])
    ).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '[Image from view_image tool: chart.png]' },
        { type: 'image', image: 'Q0hBUlQ=', mediaType: 'image/png' },
        { type: 'text', text: '[Image from view_image tool: photo.jpg]' },
        { type: 'image', image: 'UEhPVE8=', mediaType: 'image/jpeg' },
      ],
    })
  })
})

describe('buildViewImageToolResultContent', () => {
  it('builds the shared native tool-result media shape', () => {
    expect(
      buildViewImageToolResultContent({
        filePath: 'chart.png',
        base64Data: 'Q0hBUlQ=',
        mediaType: 'image/png',
      })
    ).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'Viewed image: chart.png' },
        { type: 'image-data', data: 'Q0hBUlQ=', mediaType: 'image/png' },
      ],
    })
  })
})
