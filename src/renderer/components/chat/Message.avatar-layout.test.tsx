// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message as MessageType } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const h = vi.hoisted(() => ({
  smallScreen: true,
  settings: {
    messageLayout: 'bubble' as 'bubble' | 'classic',
    showAvatar: true,
    showModelName: true,
    showMessageTimestamp: true,
    showWordCount: false,
    showTokenUsed: false,
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
vi.mock('@/platform', () => ({ default: { appLog: vi.fn() } }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => h.smallScreen }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => selector(h.settings),
  useLanguage: () => 'en',
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
vi.mock('@/components/Markdown', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('../common/Avatar', () => ({
  AssistantAvatar: () => <span data-testid="avatar" />,
  UserAvatar: () => <span data-testid="avatar" />,
  SystemAvatar: () => <span data-testid="avatar" />,
}))
vi.mock('../ActionMenu', () => ({ default: () => null }))
vi.mock('../message-parts/ToolCallPartUI', () => ({ MessageArtifactsUI: () => null, ToolCallPartUI: () => null }))

const { default: Message } = await import('./Message')

const TIMESTAMP = new Date(2001, 2, 4, 7, 8).getTime()

function renderReply(fields: Partial<MessageType> = {}) {
  const msg = {
    id: 'assistant-message',
    role: 'assistant',
    aiProvider: 'openai',
    aiProviderName: 'OpenAI',
    modelId: 'gpt-test-model',
    timestamp: TIMESTAMP,
    contentParts: [{ type: 'text', text: 'Reply text' }],
    ...fields,
  } as MessageType
  render(
    <MantineProvider>
      <TooltipProvider>
        <Message sessionId="session" sessionType="chat" msg={msg} />
      </TooltipProvider>
    </MantineProvider>
  )
  const content = screen.getByTestId(TestId.message.content)
  const column = content.parentElement as HTMLElement
  return { item: screen.getByTestId(TestId.message.item), content, column, row: column.parentElement as HTMLElement }
}

function isBefore(a: Node, b: Node): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

/** What sizes and places the reply: the row and column styles and classes, and anything beside the column. */
function replyLayout({ row, column, content }: ReturnType<typeof renderReply>) {
  // Mantine adds a generated class per instance; it carries no layout of its own.
  const stableClass = (element: Element) =>
    element.className
      .split(' ')
      .filter((name) => !name.startsWith('__m__'))
      .join(' ')
  return {
    row: row.getAttribute('style'),
    column: column.getAttribute('style'),
    columnClass: stableClass(column),
    content: stableClass(content),
    besideReply: Array.from(row.children).filter((child) => child !== column && !child.hasAttribute('aria-hidden')),
  }
}

/** The model and time line below the reply. */
function details() {
  return { model: screen.getByText('gpt-test-model'), time: screen.getByText('· 2001-03-04 07:08') }
}

beforeEach(() => {
  h.settings.showModelName = true
  h.settings.showMessageTimestamp = true
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

afterEach(cleanup)

describe.each([true, false])('assistant reply layout, small screen: %s', (smallScreen) => {
  beforeEach(() => {
    h.smallScreen = smallScreen
  })

  describe.each(['bubble', 'classic'] as const)('%s layout', (layout) => {
    beforeEach(() => {
      h.settings.messageLayout = layout
    })

    test.each([true, false])('shows the model and time below the reply, avatars shown: %s', (showAvatar) => {
      h.settings.showAvatar = showAvatar
      const { content, column } = renderReply()
      const { model, time } = details()
      for (const detail of [model, time]) {
        expect(column.contains(detail)).toBe(true)
        expect(content.contains(detail)).toBe(false)
        expect(isBefore(content, detail)).toBe(true)
      }
      expect(isBefore(model, time)).toBe(true)
      expect(screen.queryByText('OpenAI')).toBeNull()
    })

    test('drops the model and time when their settings are off', () => {
      h.settings.showModelName = false
      h.settings.showMessageTimestamp = false
      renderReply()
      expect(screen.queryByText('gpt-test-model')).toBeNull()
      expect(screen.queryByText(/2001-03-04/)).toBeNull()
    })
  })

  test('bubble layout puts the avatar beside the bubble, left of it', () => {
    h.settings.messageLayout = 'bubble'
    h.settings.showAvatar = true
    const { column, row } = renderReply()
    const avatar = screen.getByTestId('avatar')
    expect(avatar.parentElement?.parentElement).toBe(row)
    expect(column.contains(avatar)).toBe(false)
    expect(isBefore(avatar, column)).toBe(true)
  })

  test('bubble layout without avatars starts the bubble at the left edge of the row', () => {
    h.settings.messageLayout = 'bubble'
    h.settings.showAvatar = false
    const { content, column, row } = renderReply()
    expect(screen.queryByTestId('avatar')).toBeNull()
    expect(column.firstElementChild).toBe(content)
    expect(Array.from(row.children).filter((child) => child !== column && !child.hasAttribute('aria-hidden'))).toEqual(
      []
    )
  })

  test('classic layout puts only the avatar above the reply', () => {
    h.settings.messageLayout = 'classic'
    h.settings.showAvatar = true
    const { content, column } = renderReply()
    const avatar = screen.getByTestId('avatar')
    const avatarRow = column.firstElementChild as HTMLElement
    expect(avatarRow.contains(avatar)).toBe(true)
    expect(avatarRow.nextElementSibling).toBe(content)
    expect(avatarRow.textContent).toBe('')
  })

  test('classic layout keeps the reply the same width with avatars shown or hidden', () => {
    h.settings.messageLayout = 'classic'
    h.settings.showAvatar = true
    const shown = replyLayout(renderReply())
    expect(shown.besideReply).toEqual([])
    cleanup()

    h.settings.showAvatar = false
    const hidden = renderReply()
    expect(screen.queryByTestId('avatar')).toBeNull()
    expect(hidden.column.firstElementChild).toBe(hidden.content)
    expect(replyLayout(hidden)).toEqual(shown)
  })
})

describe('streaming reply feedback', () => {
  test.each(['bubble', 'classic'] as const)('%s layout shows a spinner below a reply without an avatar', (layout) => {
    h.settings.messageLayout = layout
    h.settings.showAvatar = false
    const { content } = renderReply({ generating: true })
    const spinner = screen.getByLabelText('Generating...')
    expect(content.contains(spinner)).toBe(false)
    expect(isBefore(content, spinner)).toBe(true)
  })
})
