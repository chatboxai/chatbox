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

describe('OCR results across turns', () => {
  it('reuses a successful result after the source message is reloaded', async () => {
    const { InMemorySessionRepository } = await import('@chatbox/core/testing')
    const { buildContext } = await import('@shared/context')
    const repository = new InMemorySessionRepository()
    await repository.seedSession({
      id: 'session-ocr',
      name: 'OCR',
      messages: [{ id: 'user-1', role: 'user', contentParts: [{ type: 'image', storageKey: 'image-1' }] }],
    })
    getImageMock.mockResolvedValue('data:image/png;base64,aW1hZ2U=')
    const chat = vi.fn().mockResolvedValue({ contentParts: [{ type: 'text', text: 'Recognized text' }] })
    const model = { chat } as unknown as ModelInterface
    const persist = async (messageId: string, storageKey: string, text: string) => {
      await repository.executeSessionCommand('session-ocr', {
        type: 'update',
        messageId,
        updater: (current) => {
          if (!current) throw new Error('Missing source message')
          return {
            ...current,
            contentParts: current.contentParts.map((part) =>
              part.type === 'image' && part.storageKey === storageKey && !part.ocrResult
                ? { ...part, ocrResult: text }
                : part
            ),
          }
        },
      })
    }
    for (let turn = 0; turn < 2; turn++) {
      const session = repository.inspectSession('session-ocr')
      if (!session) throw new Error('Missing session')
      const context = await buildContext(session.messages, { attachmentResolver: { read: vi.fn() } as never })
      await ocrImagesInMessages(context, model, session.id, persist)
    }
    expect(chat).toHaveBeenCalledTimes(1)
    expect(repository.inspectSession('session-ocr')?.messages[0].contentParts[0]).toMatchObject({
      type: 'image',
      storageKey: 'image-1',
      ocrResult: 'Recognized text',
    })
  })
})
