// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message as MessageType } from '@shared/types'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { MessageButtonGroup } from './message-action-state'

const h = vi.hoisted(() => ({
  smallScreen: true,
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
  removeMessage: vi.fn(),
  regenerateInNewFork: vi.fn(),
  showModal: vi.fn(),
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))
vi.mock('@ebay/nice-modal-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ebay/nice-modal-react')>()
  return { ...actual, default: { ...actual.default, show: h.showModal } }
})
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
  regenerateInNewFork: h.regenerateInNewFork,
  retryFromLastToolCallAfterApiError: vi.fn(),
}))
vi.mock('@/stores/session/messages', () => ({ modifyMessage: vi.fn(), removeMessage: h.removeMessage }))
vi.mock('@/stores/session/agent-mode', () => ({ lockSessionAgentMode: vi.fn(), setSessionAgentMode: vi.fn() }))
vi.mock('@/components/Markdown', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('../common/Avatar', () => ({
  AssistantAvatar: () => <span data-testid="avatar" />,
  UserAvatar: () => <span data-testid="avatar" />,
  SystemAvatar: () => <span data-testid="avatar" />,
}))
vi.mock('../ActionMenu', () => ({
  default: ({
    opened,
    onChange,
    items,
    children,
  }: {
    opened?: boolean
    onChange?: (opened: boolean) => void
    items: { testId?: string; text?: ReactNode; onClick?: () => void }[]
    children: ReactNode
  }) => (
    <>
      <span onClickCapture={() => onChange?.(true)}>{children}</span>
      {opened && (
        <div data-testid="message-menu">
          {items.map(
            (item) =>
              item.testId && (
                <button key={item.testId} type="button" data-testid={item.testId} onClick={item.onClick}>
                  {item.text}
                </button>
              )
          )}
        </div>
      )}
    </>
  ),
}))
vi.mock('../message-parts/ToolCallPartUI', () => ({ MessageArtifactsUI: () => null, ToolCallPartUI: () => null }))
vi.mock('../message-parts/StepTimelineUI', () => ({ ReasoningContentUI: () => null, StepTimelineUI: () => null }))
vi.mock('./MessageErrTips', () => ({ default: () => null }))
vi.mock('./MessageLoading', () => ({ default: () => null, PreparingToolCallStatus: () => null }))
vi.mock('./MessageAttachmentGrid', () => ({ MessageAttachmentGrid: () => null }))

const { default: Message } = await import('./Message')

function reply(fields: Partial<MessageType> = {}): MessageType {
  return {
    id: 'assistant-message',
    role: 'assistant',
    aiProvider: 'openai',
    model: 'gpt-test-model',
    contentParts: [{ type: 'text', text: 'Hello there' }],
    ...fields,
  } as MessageType
}

function userMessage(): MessageType {
  return { id: 'user-message', role: 'user', contentParts: [{ type: 'text', text: 'Hi' }] } as MessageType
}

function renderMessage(msg: MessageType, buttonGroup: MessageButtonGroup = 'auto') {
  render(
    <MantineProvider>
      <TooltipProvider>
        <Message sessionId="session" sessionType="chat" sessionMode="chat" msg={msg} buttonGroup={buttonGroup} />
      </TooltipProvider>
    </MantineProvider>
  )
  return screen.getByTestId(TestId.message.item)
}

function openMoreMenu() {
  fireEvent.click(screen.getByTestId(TestId.message.actionMore))
  return screen.getByTestId('message-menu')
}

beforeEach(() => {
  h.smallScreen = true
  h.settings.messageLayout = 'bubble'
  h.removeMessage.mockReset()
  h.regenerateInNewFork.mockReset()
  h.showModal.mockReset()
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
  vi.useRealTimers()
})

describe.each(['bubble', 'classic'] as const)('small-screen message action bar in the %s layout', (layout) => {
  beforeEach(() => {
    h.settings.messageLayout = layout
  })

  test('the last reply keeps Reply Again, Copy and More on screen in a floating card', () => {
    renderMessage(reply(), 'always')
    const bar = screen.getByTestId(TestId.message.actionBar)
    expect(within(bar).getByTestId(TestId.message.actionBarRetry)).toBeTruthy()
    expect(within(bar).getByTestId(TestId.message.actionBarCopy)).toBeTruthy()
    expect(within(bar).getByTestId(TestId.message.actionMore)).toBeTruthy()
    const row = bar.parentElement?.className.split(' ') ?? []
    expect(row).toEqual(expect.arrayContaining(['visible', 'opacity-100', 'sticky', 'bottom-4']))
    expect(row).not.toContain('invisible')
    expect(bar.className.split(' ')).toEqual(expect.arrayContaining(['bg-chatbox-background-primary', 'shadow-sm']))
  })

  test.each([
    ['an earlier reply', reply()],
    ['a user message', userMessage()],
  ])('%s shows its action bar only on hover', (_, msg) => {
    renderMessage(msg)
    const row = screen.getByTestId(TestId.message.actionBar).parentElement?.className.split(' ') ?? []
    expect(row).toEqual(expect.arrayContaining(['invisible', 'opacity-0', 'group-hover/message:visible']))
    expect(row.some((name) => name.includes('hover:none'))).toBe(false)
  })

  test('Reply Again in the bar regenerates the reply', async () => {
    renderMessage(reply())
    fireEvent.click(screen.getByTestId(TestId.message.actionBarRetry))
    await vi.waitFor(() => expect(h.regenerateInNewFork).toHaveBeenCalledTimes(1))
  })

  test('More lists every reply action and deletes the reply', async () => {
    renderMessage(reply())
    const menu = openMoreMenu()
    for (const id of [
      TestId.message.actionMenuRetry,
      TestId.message.actionMenuCopy,
      TestId.message.actionQuote,
      TestId.message.actionDelete,
    ]) {
      expect(within(menu).getByTestId(id)).toBeTruthy()
    }
    fireEvent.click(within(menu).getByTestId(TestId.message.actionDelete))
    await vi.waitFor(() => expect(h.removeMessage).toHaveBeenCalledWith('session', 'assistant-message'))
  })

  test('a user message shows Edit and Copy, and More offers Edit and delete', async () => {
    renderMessage(userMessage())
    const bar = screen.getByTestId(TestId.message.actionBar)
    expect(within(bar).getByTestId(TestId.message.actionBarEdit)).toBeTruthy()
    expect(within(bar).getByTestId(TestId.message.actionBarCopy)).toBeTruthy()
    const menu = openMoreMenu()
    expect(within(menu).getByTestId(TestId.message.actionMenuEdit)).toBeTruthy()
    fireEvent.click(within(menu).getByTestId(TestId.message.actionMenuEdit))
    await vi.waitFor(() => expect(h.showModal).toHaveBeenCalledWith('message-edit', expect.anything()))
    expect(within(menu).getByTestId(TestId.message.actionDelete)).toBeTruthy()
  })

  test('a blank reply keeps its action bar, so it can still be deleted', async () => {
    renderMessage(reply({ contentParts: [], finishReason: 'canceled' }))
    const menu = openMoreMenu()
    fireEvent.click(within(menu).getByTestId(TestId.message.actionDelete))
    await vi.waitFor(() => expect(h.removeMessage).toHaveBeenCalledWith('session', 'assistant-message'))
  })

  test('long-pressing a message opens no menu', () => {
    vi.useFakeTimers()
    const item = renderMessage(reply())
    expect(item.getAttribute('aria-haspopup')).toBeNull()
    const content = screen.getByTestId(TestId.message.content)
    act(() => {
      fireEvent.touchStart(content, { touches: [{ clientX: 40, clientY: 80 }] })
    })
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    act(() => {
      fireEvent.touchEnd(content, { touches: [] })
    })
    expect(screen.queryByTestId('message-menu')).toBeNull()
  })

  test.each([
    ['a reply', reply()],
    ['a user message', userMessage()],
  ])('swiping %s to the right neither regenerates nor edits it', async (_, msg) => {
    renderMessage(msg)
    const content = screen.getByTestId(TestId.message.content)
    fireEvent.touchStart(content, { touches: [{ clientX: 60, clientY: 100 }] })
    for (const x of [80, 120, 180, 240, 300]) {
      fireEvent.touchMove(content, { touches: [{ clientX: x, clientY: 102 }] })
    }
    fireEvent.touchEnd(content, { touches: [], changedTouches: [{ clientX: 300, clientY: 102 }] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.regenerateInNewFork).not.toHaveBeenCalled()
    expect(h.showModal).not.toHaveBeenCalled()
    expect(screen.queryByTestId('message-menu')).toBeNull()
  })
})

test('wide screens keep the More menu to the secondary actions shown beside the bar', () => {
  h.smallScreen = false
  renderMessage(reply())
  const menu = openMoreMenu()
  expect(within(menu).queryByTestId(TestId.message.actionMenuRetry)).toBeNull()
  expect(within(menu).getByTestId(TestId.message.actionQuote)).toBeTruthy()
  expect(within(menu).getByTestId(TestId.message.actionDelete)).toBeTruthy()
})
