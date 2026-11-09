// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message as MessageType } from '@shared/types'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {
    messageLayout: 'bubble' as 'bubble' | 'classic',
    showAvatar: true,
    showModelName: true,
    showMessageTimestamp: false,
    showWordCount: false,
    showTokenUsed: true,
    showFirstTokenLatency: false,
    enableMarkdownRendering: false,
    enableLaTeXRendering: false,
    enableMermaidRendering: false,
    customProviders: [],
    userAvatarKey: undefined,
  } as Record<string, unknown>,
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => true }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => selector(h.settings),
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    generationHooks: { useIsActive: () => false },
    generationRuntime: { subscribe: () => () => {}, isSessionStopRequested: () => false },
    sessions: { getSessionHeader: async () => null, readPreviousUserMessage: async () => null },
  },
}))
vi.mock('@/stores/uiStore', () => ({
  uiStore: { getState: () => ({}) },
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setQuote: vi.fn(), widthFull: false }),
}))
vi.mock('@/hooks/useGenerationStop', () => ({ useMessageGenerationStop: () => ({ status: 'idle', stop: vi.fn() }) }))
vi.mock('@/stores/session/generation', () => ({
  generate: vi.fn(),
  generateMore: vi.fn(),
  regenerateInNewFork: vi.fn(),
  retryFromLastToolCallAfterApiError: vi.fn(),
}))
vi.mock('@/stores/session/messages', () => ({ modifyMessage: vi.fn(), removeMessage: vi.fn() }))
vi.mock('@/stores/session/agent-mode', () => ({ lockSessionAgentMode: vi.fn(), setSessionAgentMode: vi.fn() }))
vi.mock('@/utils/long-press-haptic', () => ({ triggerLongPressHaptic: vi.fn() }))
vi.mock('@/components/Markdown', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('../common/Avatar', () => ({
  AssistantAvatar: () => <span data-testid="avatar" />,
  UserAvatar: () => <span data-testid="avatar" />,
  SystemAvatar: () => <span data-testid="avatar" />,
}))
vi.mock('../ActionMenu', () => ({
  default: ({ opened, onChange }: { opened?: boolean; onChange?: (opened: boolean) => void }) =>
    opened ? (
      <button type="button" data-testid="close-menu" onClick={() => onChange?.(false)}>
        close
      </button>
    ) : null,
}))
vi.mock('../message-parts/ToolCallPartUI', () => ({ MessageArtifactsUI: () => null, ToolCallPartUI: () => null }))
vi.mock('./MessageSelectTextPage', () => ({ MessageSelectTextPage: () => null }))

const { default: Message } = await import('./Message')

const PRESSED_TINT = 'before:bg-black/[0.08]'

function message(role: 'user' | 'assistant'): MessageType {
  return {
    id: `${role}-message`,
    role,
    contentParts: [{ type: 'text', text: `${role} text` }],
    ...(role === 'assistant' ? { aiProvider: 'openai', model: 'gpt-test-model', tokensUsed: 42 } : {}),
  } as MessageType
}

function renderMessage(role: 'user' | 'assistant') {
  render(
    <MantineProvider>
      <Message sessionId="session" sessionType="chat" msg={message(role)} />
    </MantineProvider>
  )
  return {
    item: screen.getByTestId(TestId.message.item),
    content: screen.getByTestId(TestId.message.content),
  }
}

/** Class names of every element in the message row other than its content surface. */
function surroundingClasses(item: HTMLElement, content: HTMLElement): string[] {
  return Array.from(item.querySelectorAll<HTMLElement>('[class]'))
    .filter((element) => element !== content && !content.contains(element))
    .map((element) => element.getAttribute('class') ?? '')
}

function openMenu(content: HTMLElement) {
  act(() => {
    fireEvent.contextMenu(content)
  })
  expect(screen.getByTestId('close-menu')).toBeTruthy()
}

function closeMenu() {
  act(() => {
    fireEvent.click(screen.getByTestId('close-menu'))
  })
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => ({
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

afterEach(() => {
  cleanup()
})

describe('Message long-press highlight', () => {
  test.each(['bubble', 'classic'] as const)('%s layout tints only the user bubble while its menu is open', (layout) => {
    h.settings.messageLayout = layout
    const { item, content } = renderMessage('user')
    const surrounding = surroundingClasses(item, content)

    openMenu(content)
    expect(content.className).toContain(PRESSED_TINT)
    expect(surroundingClasses(item, content)).toEqual(surrounding)

    closeMenu()
    expect(content.className).not.toContain(PRESSED_TINT)
  })

  test('bubble layout tints only the reply bubble, leaving the name row above it uncovered', () => {
    h.settings.messageLayout = 'bubble'
    const { item, content } = renderMessage('assistant')
    const surrounding = surroundingClasses(item, content)
    const nameRow = screen.getByText('gpt-test-model')

    openMenu(content)
    expect(content.className).toContain(PRESSED_TINT)
    expect(content.contains(nameRow)).toBe(false)
    expect(surroundingClasses(item, content)).toEqual(surrounding)

    closeMenu()
    expect(content.className).not.toContain(PRESSED_TINT)
  })

  test('classic layout keeps a pressed reply and its name row flat on the page', () => {
    h.settings.messageLayout = 'classic'
    const { item, content } = renderMessage('assistant')
    const surrounding = surroundingClasses(item, content)
    const contentClass = content.className

    openMenu(content)
    expect(content.className).toBe(contentClass)
    expect(surroundingClasses(item, content)).toEqual(surrounding)
  })
})
