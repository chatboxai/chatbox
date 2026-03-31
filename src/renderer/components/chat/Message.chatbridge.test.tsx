/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import type { Message } from '@shared/types'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import MessageComponent from './Message'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      userAvatarKey: '',
      showMessageTimestamp: false,
      showModelName: false,
      showTokenCount: false,
      showWordCount: false,
      showTokenUsed: false,
      showFirstTokenLatency: false,
      enableMarkdownRendering: true,
      enableLaTeXRendering: false,
      enableMermaidRendering: false,
      autoPreviewArtifacts: false,
      autoCollapseCodeBlock: false,
    }),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setQuote: vi.fn(),
    }),
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    exporter: {
      exportImageFile: vi.fn(),
      exportByUrl: vi.fn(),
    },
    appLog: vi.fn(async () => undefined),
  },
}))

vi.mock('@/stores/chatStore', () => ({
  getSession: vi.fn(async () => null),
}))

vi.mock('@/modals/Settings', () => ({
  navigateToSettings: vi.fn(),
}))

vi.mock('@/packages/navigator', () => ({
  copyToClipboard: vi.fn(),
}))

vi.mock('@/stores/sessionActions', () => ({
  generateMore: vi.fn(),
  getMessageThreadContext: vi.fn(async () => []),
  modifyMessage: vi.fn(),
  regenerateInNewFork: vi.fn(),
  removeMessage: vi.fn(),
}))

vi.mock('@/stores/toastActions', () => ({
  add: vi.fn(),
}))

describe('Message chatbridge rendering', () => {
  it('renders an app-aware content part through the chat timeline without crashing', () => {
    const msg: Message = {
      id: 'assistant-app-1',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'chess-1',
          appName: 'Chess',
          appInstanceId: 'chess-instance-1',
          lifecycle: 'active',
          title: 'Chess shell',
          description: 'The host keeps the chess runtime in the thread.',
          fallbackTitle: 'Fallback',
          fallbackText: 'Recover in place.',
        },
      ],
      timestamp: Date.now(),
    }

    render(
      <MantineProvider>
        <MessageComponent
          sessionId="session-1"
          sessionType="chat"
          msg={msg}
          buttonGroup="none"
          assistantAvatarKey=""
        />
      </MantineProvider>
    )

    expect(screen.getAllByText('Chess shell')).toHaveLength(2)
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('The host keeps the chess runtime in the thread.')).toBeTruthy()
  })
})
