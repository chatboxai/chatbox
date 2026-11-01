import type { ModelInterface } from '@shared/models/types'
import type { Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getImageMock } = vi.hoisted(() => ({
  getImageMock: vi.fn(),
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(async () => ({ storage: { getImage: getImageMock } })),
}))

import { ocrImagesInMessages } from './ocr-helper'

describe('ocrImagesInMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getImageMock.mockResolvedValue('data:image/png;base64,aW1hZ2U=')
  })

  it('passes the owning session id to each OCR request', async () => {
    const chatMock = vi.fn().mockResolvedValue({ contentParts: [{ type: 'text', text: 'OCR result' }] })
    const model = { chat: chatMock } as unknown as ModelInterface
    const messages: Message[] = [
      { id: 'user-1', role: 'user', contentParts: [{ type: 'image', storageKey: 'image-1' }] },
    ]

    await ocrImagesInMessages(messages, model, 'session-1')

    expect(chatMock).toHaveBeenCalledWith(expect.any(Array), { sessionId: 'session-1' })
    expect(messages[0].contentParts[0]).toMatchObject({ type: 'image', ocrResult: 'OCR result' })
  })
})
