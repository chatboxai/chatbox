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
  ;(globalThis as unknown as { window: { localStorage: typeof localStorageMock } }).window = {
    localStorage: localStorageMock,
  }
}

vi.mock('@/stores/settingActions', () => ({
  getLicenseKey: () => '',
  isPro: () => false,
  getRemoteConfig: () => ({}),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({
        licenseKey: '',
        language: 'en',
        autoCompaction: true,
        compactionThreshold: 0.6,
      }),
    }),
  },
}))

vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({
      inputBoxWebBrowsingMode: false,
      sessionKnowledgeBaseMap: {},
    }),
  },
}))

vi.mock('@/packages/mcp/controller', () => ({
  mcpController: {
    getAvailableTools: () => ({}),
  },
}))

vi.mock('@/router', () => ({
  router: {
    navigate: vi.fn(),
  },
}))

vi.mock('@/utils/track', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/app/renderer-application', async () => {
  const { QueryClient } = await import('@tanstack/react-query')
  return {
    rendererApplication: {
      queryClient: new QueryClient(),
      sessions: { updateSessionWithMessages: vi.fn() },
      sessionQueryBridge: { getSession: vi.fn() },
    },
  }
})
