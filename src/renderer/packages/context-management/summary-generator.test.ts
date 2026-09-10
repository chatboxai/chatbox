import type { Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { chatMock, createModelMock } = vi.hoisted(() => ({
  chatMock: vi.fn(),
  createModelMock: vi.fn(),
}))

vi.mock('@/adapters', () => ({ createModel: createModelMock }))
vi.mock('@/i18n/locales', () => ({ languageNameMap: { en: 'English' } }))
vi.mock('@/packages/model-calls/message-utils', () => ({
  convertToModelMessages: vi.fn(async () => [{ role: 'user', content: 'Summarize' }]),
}))
vi.mock('@/packages/prompts', () => ({
  summarizeConversation: vi.fn(() => [
    { id: 'summary-prompt', role: 'user', contentParts: [{ type: 'text', text: 'Summarize' }] },
  ]),
}))
vi.mock('@/stores/settingActions', () => ({ getRemoteConfig: vi.fn(() => ({})) }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({
        language: 'en',
        defaultChatModel: { provider: 'openai', model: 'gpt-4.1' },
      }),
    }),
  },
}))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))

import { generateSummaryWithStream } from './summary-generator'

describe('generateSummaryWithStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatMock.mockResolvedValue({ contentParts: [{ type: 'text', text: 'Summary' }] })
    createModelMock.mockResolvedValue({
      isSupportVision: () => false,
      chat: chatMock,
    })
  })

  it('passes the owning session id to the model request', async () => {
    const messages: Message[] = [{ id: 'user-1', role: 'user', contentParts: [{ type: 'text', text: 'Conversation' }] }]

    await expect(
      generateSummaryWithStream({ sessionId: 'session-1', messages, language: 'en' })
    ).resolves.toMatchObject({ success: true, summary: 'Summary' })

    expect(chatMock).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ sessionId: 'session-1' }))
  })
})
