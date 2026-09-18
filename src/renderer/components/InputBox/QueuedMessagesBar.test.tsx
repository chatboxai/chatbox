/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { createMessage, type Message } from '@shared/types'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test-utils'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/stores/session/agent-mode', () => ({
  useSessionAgentMode: () => ({ value: 'on' }),
}))

vi.mock('@/stores/session/message-queue', async () => {
  const { createStore } = await import('zustand')
  return {
    MAX_QUEUED_MESSAGES: 20,
    messageQueueStore: createStore(() => ({ queues: {}, paused: {} })),
    isSteerableQueuedMessage: () => true,
    clearPendingQueuedMessages: vi.fn(),
    removeQueuedMessage: vi.fn(),
    requestSteerQueuedMessage: vi.fn(),
    resumeQueueAndDrain: vi.fn(),
    updateQueuedMessageText: vi.fn(),
    wakeQueuedUserMessages: vi.fn(),
  }
})

import { messageQueueStore, removeQueuedMessage } from '@/stores/session/message-queue'
import { QueuedMessagesBar } from './QueuedMessagesBar'

const SESSION_ID = 'session-1'
const SCROLL_HEIGHT = 600
const scrollTops = new WeakMap<HTMLElement, number>()

beforeAll(() => {
  // jsdom has no layout, so the scroll geometry the bar reads must be faked.
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => SCROLL_HEIGHT })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return scrollTops.get(this) ?? 0
    },
    set(this: HTMLElement, value: number) {
      scrollTops.set(this, value)
    },
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

function queuedItem(id: string, text: string) {
  const message: Message = createMessage('user', text)
  return { kind: 'message' as const, id, message, createdAt: Date.now() }
}

function setQueue(count: number, headInFlight = false) {
  const queue = Array.from({ length: count }, (_, index) => ({
    ...queuedItem(`q-${index}`, `queued ${index}`),
    inFlight: headInFlight && index === 0 ? true : undefined,
  }))
  act(() => {
    messageQueueStore.setState({ queues: { [SESSION_ID]: queue }, paused: {} })
  })
}

function setCompactionQueue(withMessage = false) {
  const queue = [
    ...(withMessage ? [queuedItem('q-0', 'queued 0')] : []),
    { kind: 'compaction' as const, id: 'c-0', createdAt: Date.now(), prompt: 'Keep exact paths.' },
  ]
  act(() => {
    messageQueueStore.setState({ queues: { [SESSION_ID]: queue }, paused: {} })
  })
}

function renderBar() {
  return render(
    <MantineProvider>
      <QueuedMessagesBar sessionId={SESSION_ID} />
    </MantineProvider>
  )
}

function getList() {
  const list = screen.getAllByTestId(TestId.chat.queuedMessageItem)[0].parentElement
  if (!list) throw new Error('queued message list not found')
  return list
}

beforeEach(() => {
  vi.clearAllMocks()
  act(() => {
    messageQueueStore.setState({ queues: {}, paused: {} })
  })
})

describe('QueuedMessagesBar list height', () => {
  test('caps the list and scrolls it instead of growing with the queue', () => {
    setQueue(20)
    renderBar()

    expect(screen.getAllByTestId(TestId.chat.queuedMessageItem)).toHaveLength(20)
    expect(getList().className).toContain('overflow-y-auto')
    expect(getList().className).toContain('max-h-[min(30vh,180px)]')
  })

  test('keeps a newly queued item in view without hijacking the scroll while draining', () => {
    setQueue(6)
    renderBar()
    const list = getList()
    list.scrollTop = 0

    setQueue(7)
    expect(list.scrollTop).toBe(SCROLL_HEIGHT)

    // Delivery shrinks the queue from the front; that must not force a scroll.
    list.scrollTop = 0
    setQueue(6)
    expect(list.scrollTop).toBe(0)
  })

  test('stays at the head for a queue restored from persistence', () => {
    // The head is the item that sends next, so mounting onto an existing queue
    // must not be mistaken for a local enqueue.
    setQueue(12)
    renderBar()

    expect(getList().scrollTop).toBe(0)
  })

  test('does not scroll when a failed delivery returns an item to the head', () => {
    // Clearing `inFlight` grows the visible count without appending anything;
    // scrolling away would hide the item that gets retried next.
    setQueue(8, true)
    renderBar()
    const list = getList()
    list.scrollTop = 0

    setQueue(8)
    expect(list.scrollTop).toBe(0)
  })

  test('brings the expanded editor into view when a row is edited', () => {
    setQueue(8)
    renderBar()

    fireEvent.click(screen.getAllByTestId(TestId.chat.queuedMessageEdit)[7])

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })
})

describe('QueuedMessagesBar compression requests', () => {
  test('renders a queued compression as its own row next to queued messages', () => {
    setCompactionQueue(true)
    renderBar()

    expect(screen.getAllByTestId(TestId.chat.queuedMessageItem)).toHaveLength(1)
    const row = screen.getByTestId(TestId.chat.queuedCompactionItem)
    expect(row.textContent).toContain('Compress Conversation')

    fireEvent.click(screen.getByTestId(TestId.chat.queuedCompactionRemove))
    expect(removeQueuedMessage).toHaveBeenCalledWith(SESSION_ID, 'c-0')
  })

  test('describes a compression-only queue as running after the reply', () => {
    setCompactionQueue()
    renderBar()

    expect(screen.getByText('Runs when the current reply finishes')).toBeTruthy()
    expect(screen.queryByText('Will send after the current response finishes')).toBeNull()
  })
})
