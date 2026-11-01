import type { ModelInterface } from '@shared/models/types'
import type { Message } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { generateText } from './index'

const convertToModelMessagesMock = vi.fn()

vi.mock('./message-utils', () => ({
  convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
}))

describe('generateText', () => {
  it('passes modelSupportVision option into convertToModelMessages', async () => {
    const messages: Message[] = [{ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] }]
    convertToModelMessagesMock.mockResolvedValue([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])

    const chatMock = vi.fn().mockResolvedValue({ contentParts: [{ type: 'text', text: 'ok' }] })
    const model = {
      isSupportVision: () => false,
      chat: chatMock,
    } as unknown as ModelInterface

    await generateText(model, messages, { sessionId: 'session-1' })

    expect(convertToModelMessagesMock).toHaveBeenCalledWith(messages, { modelSupportVision: false })
    expect(chatMock).toHaveBeenCalledWith(expect.any(Array), { sessionId: 'session-1' })
  })
})
