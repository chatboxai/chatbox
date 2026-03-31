import { vi } from 'vitest'

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
}

;(globalThis as unknown as { localStorage: typeof localStorageMock }).localStorage = localStorageMock

if (typeof globalThis.window === 'undefined') {
  ;(globalThis as unknown as {
    window: { localStorage: typeof localStorageMock; navigator: { userAgent: string } }
  }).window = {
    localStorage: localStorageMock,
    navigator: { userAgent: 'vitest-chatbridge' },
  }
}

Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'vitest-chatbridge',
    clipboard: {
      writeText: vi.fn(),
    },
  },
  configurable: true,
})

vi.mock('@/components/chat/MessageList', () => ({
  clearScrollPositionCache: vi.fn(),
}))

vi.mock('@/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => children,
  BlockCodeCollapsedStateProvider: ({ children }: { children: unknown }) => children,
}))

vi.mock('@/hooks/dom', () => ({
  focusMessageInput: vi.fn(),
}))

vi.mock('@/router', () => ({
  router: {
    navigate: vi.fn(),
  },
}))

vi.mock('@/utils/track', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/packages/mcp/controller', () => ({
  mcpController: {
    getAvailableTools: () => ({}),
  },
}))

vi.mock('@/stores/settingActions', () => ({
  getLicenseKey: () => '',
  isPro: () => false,
  getRemoteConfig: () => ({}),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({
        language: 'en',
        maxContextMessageCount: Number.MAX_SAFE_INTEGER,
      }),
      extension: {},
    }),
  },
  useSettingsStore: vi.fn(() => ({})),
  getPlatformDefaultDocumentParser: vi.fn(() => ({ type: 'none' })),
}))

vi.mock('@/stores/lastUsedModelStore', () => ({
  lastUsedModelStore: {
    getState: () => ({
      chat: {
        provider: 'chatbox-ai',
        modelId: 'chatboxai-4',
      },
      picture: {
        provider: 'chatbox-ai',
        modelId: 'gpt-image-1',
      },
    }),
  },
}))

vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({
      inputBoxWebBrowsingMode: false,
      sessionKnowledgeBaseMap: {},
      messageScrolling: null,
      messageListElement: null,
      clearSessionWebBrowsing: vi.fn(),
      removeSessionKnowledgeBase: vi.fn(),
      setMessageListElement: vi.fn(),
    }),
  },
  useUIStore: vi.fn(),
}))
