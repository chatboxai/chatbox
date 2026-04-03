import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessage, type Session } from '@shared/types'
import { submitNewUserMessage } from './messages'

const { getSessionMock, getSessionSettingsMock, insertMessageMock, generateMock, runCompactionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getSessionSettingsMock: vi.fn(),
  insertMessageMock: vi.fn(),
  generateMock: vi.fn(),
  runCompactionMock: vi.fn(),
}))

vi.hoisted(() => {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  }

  ;(globalThis as unknown as { window: Record<string, unknown>; localStorage: typeof storage }).window = {
    localStorage: storage,
  }
  ;(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage
})

vi.mock('./generation', () => ({
  generate: generateMock,
}))

vi.mock('../chatStore', () => ({
  getSession: getSessionMock,
  getSessionSettings: getSessionSettingsMock,
  insertMessage: insertMessageMock,
  updateMessage: vi.fn(),
  updateMessageCache: vi.fn(),
}))

vi.mock('@/packages/context-management', () => ({
  runCompactionWithUIState: runCompactionMock,
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({}),
    }),
  },
}))

vi.mock('@/stores/settingActions', () => ({
  isPro: () => false,
  getRemoteConfig: () => ({
    setting_chatboxai_first: false,
  }),
}))

vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({
      sessionWebBrowsingMap: {},
    }),
  },
}))

vi.mock('@/packages/token', () => ({
  estimateTokensFromMessages: () => 0,
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    getConfig: async () => ({}),
  },
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: async () => ({}),
}))

vi.mock('@shared/models', () => ({
  getModel: vi.fn(() => ({
    isSupportToolUse: () => true,
  })),
}))

vi.mock('@/packages/model-setting-utils', () => ({
  getModelDisplayName: async () => 'mock-model',
}))

describe('submitNewUserMessage weather interception', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    getSessionSettingsMock.mockReset()
    insertMessageMock.mockReset()
    generateMock.mockReset()
    runCompactionMock.mockReset()

    runCompactionMock.mockResolvedValue({ success: true })
    getSessionSettingsMock.mockResolvedValue({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
    })
  })

  it('inserts a host-owned weather route message and skips generation', async () => {
    const session: Session = {
      id: 'session-1',
      name: 'Weather',
      type: 'chat',
      messages: [],
    }
    getSessionMock.mockResolvedValue(session)

    await submitNewUserMessage(session.id, {
      newUserMsg: createMessage('user', 'weather in Chicago, IL'),
      needGenerating: true,
    })

    expect(insertMessageMock).toHaveBeenCalledTimes(2)
    expect(generateMock).not.toHaveBeenCalled()

    const assistantMessage = insertMessageMock.mock.calls[1][1]
    expect(assistantMessage.role).toBe('assistant')
    expect(assistantMessage.contentParts).toEqual([
      expect.objectContaining({
        type: 'info',
        text: 'Weather Dashboard route ready for Chicago, IL.',
        values: expect.objectContaining({
          hostFlow: 'weather-dashboard',
          status: 'route-ready',
          locationQuery: 'Chicago, IL',
        }),
      }),
    ])
  })
})
