import type { ModelInterface } from '@shared/models/types'
import type { Message } from '@shared/types'
import type { ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { generateCompactionSummaryWithModel } from './compaction-summary'

function modelWith(options: { supportsSystem?: boolean; supportsVision: boolean }) {
  const chat = vi.fn(async (_messages: ModelMessage[]) => ({
    contentParts: [{ type: 'text' as const, text: 'summary' }],
  }))
  const model = {
    isSupportSystemMessage: () => options.supportsSystem ?? true,
    isSupportVision: () => options.supportsVision,
    chat,
  } as unknown as ModelInterface
  return { chat, model }
}

function userMessageWithImage(storageKey = 'image:stored'): Message {
  return {
    id: 'user-1',
    role: 'user',
    contentParts: [
      { type: 'text', text: 'Please inspect this image.' },
      { type: 'image', storageKey, ocrResult: 'OCR fallback' },
    ],
    files: [{ id: 'file-1', name: 'private.txt', fileType: 'text/plain', storageKey: 'file:stored' }],
    links: [{ id: 'link-1', title: 'Private link', url: 'https://example.com', storageKey: 'link:stored' }],
  }
}

describe('generateCompactionSummaryWithModel', () => {
  it('resolves stored user images for a vision-capable summary without injecting file or link bodies', async () => {
    const { chat, model } = modelWith({ supportsVision: true })
    const resolveImage = vi.fn((storageKey: string) => {
      if (storageKey === 'image:stored') return Promise.resolve('data:image/jpeg;base64,SU1BR0U=')
      if (storageKey === 'file:stored') return Promise.resolve('PRIVATE_FILE_BODY')
      if (storageKey === 'link:stored') return Promise.resolve('PRIVATE_LINK_BODY')
      return Promise.resolve(null)
    })

    await expect(
      generateCompactionSummaryWithModel({
        model,
        messages: [userMessageWithImage()],
        languageName: 'English',
        resolveImage,
      })
    ).resolves.toMatchObject({ success: true, summary: 'summary' })

    expect(resolveImage).toHaveBeenCalledTimes(1)
    expect(resolveImage).toHaveBeenCalledWith('image:stored')
    const modelMessages = chat.mock.calls[0]?.[0]
    expect(modelMessages?.[0]).toMatchObject({
      role: 'user',
      content: expect.arrayContaining([{ type: 'image', image: 'SU1BR0U=', mediaType: 'image/jpeg' }]),
    })
    expect(JSON.stringify(modelMessages)).not.toContain('PRIVATE_FILE_BODY')
    expect(JSON.stringify(modelMessages)).not.toContain('PRIVATE_LINK_BODY')
    expect(JSON.stringify(modelMessages)).not.toContain('file:stored')
    expect(JSON.stringify(modelMessages)).not.toContain('link:stored')
  })

  it('uses OCR text for a non-vision user image without reading its blob', async () => {
    const { chat, model } = modelWith({ supportsVision: false })
    const resolveImage = vi.fn(() => Promise.resolve('data:image/png;base64,SU1BR0U='))

    await generateCompactionSummaryWithModel({
      model,
      messages: [userMessageWithImage()],
      languageName: 'English',
      resolveImage,
    })

    expect(resolveImage).not.toHaveBeenCalled()
    expect(chat.mock.calls[0]?.[0]?.[0]).toMatchObject({
      role: 'user',
      content: expect.arrayContaining([{ type: 'text', text: 'This is an image, OCR Result: \nOCR fallback' }]),
    })
  })

  it('uses available OCR and omits unreadable assistant images for a non-vision model', async () => {
    const { chat, model } = modelWith({ supportsVision: false })
    const resolveImage = vi.fn(() => Promise.resolve('data:image/png;base64,SU1BR0U='))

    await generateCompactionSummaryWithModel({
      model,
      messages: [
        { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Create an image' }] },
        {
          id: 'assistant-image',
          role: 'assistant',
          contentParts: [
            { type: 'text', text: 'Generated result' },
            { type: 'image', storageKey: 'assistant:no-ocr' },
            { type: 'image', storageKey: 'assistant:with-ocr', ocrResult: 'Assistant image text' },
          ],
        },
      ],
      languageName: 'English',
      resolveImage,
    })

    expect(resolveImage).not.toHaveBeenCalled()
    expect(chat.mock.calls[0]?.[0]?.[1]).toMatchObject({
      role: 'assistant',
      content: expect.arrayContaining([
        { type: 'text', text: 'Generated result' },
        { type: 'text', text: 'This is an image, OCR Result: \nAssistant image text' },
      ]),
    })
    expect(JSON.stringify(chat.mock.calls[0]?.[0])).not.toContain('"type":"file"')
  })

  it('silently omits missing and unreadable stored images', async () => {
    const { chat, model } = modelWith({ supportsVision: true })
    const resolveImage = vi.fn((storageKey: string) => {
      if (storageKey === 'image:missing') return Promise.resolve(null)
      return Promise.reject(new Error('blob read failed'))
    })

    await expect(
      generateCompactionSummaryWithModel({
        model,
        messages: [userMessageWithImage('image:missing'), userMessageWithImage('image:error')],
        languageName: 'English',
        resolveImage,
      })
    ).resolves.toMatchObject({ success: true, summary: 'summary' })

    const modelMessages = chat.mock.calls[0]?.[0]
    expect(resolveImage.mock.calls.map(([storageKey]) => storageKey)).toEqual(['image:missing', 'image:error'])
    expect(JSON.stringify(modelMessages)).not.toContain('"type":"image"')
  })

  it('normalizes a previous assistant summary into a valid user-first prompt', async () => {
    const { chat, model } = modelWith({ supportsVision: false })

    await generateCompactionSummaryWithModel({
      model,
      messages: [
        { id: 'previous-summary', role: 'assistant', contentParts: [{ type: 'text', text: 'Previous summary' }] },
        { id: 'next-user', role: 'user', contentParts: [{ type: 'text', text: 'Continue' }] },
      ],
      languageName: 'English',
    })

    expect(chat.mock.calls[0]?.[0]?.[0]).toMatchObject({ role: 'user' })
    expect(JSON.stringify(chat.mock.calls[0]?.[0])).toContain('Previous summary')
  })
})
