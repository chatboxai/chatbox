// @vitest-environment jsdom
import { IDLE_SESSION_LOCK_STATE, type SessionLockState } from '@chatbox/core/session/action-gates'
import type { SessionCommandDelta, SessionGenerationControl } from '@chatbox/core/ports'
import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message, SessionType } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteFork: vi.fn(),
  switchFork: vi.fn(),
  switchForkTo: vi.fn(),
  toast: vi.fn(),
  isSmallScreen: vi.fn(() => false),
  readPreview: vi.fn(),
  readBranch: vi.fn(),
  options: vi.fn(),
  message: vi.fn(),
  subscribeCommits: vi.fn(),
  commitListener: null as ((delta: SessionCommandDelta) => void) | null,
}))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: mocks.isSmallScreen }))
vi.mock('@/stores/session/forks', () => ({
  deleteFork: mocks.deleteFork,
  switchFork: mocks.switchFork,
  switchForkTo: mocks.switchForkTo,
}))
vi.mock('@/stores/toastActions', () => ({ add: mocks.toast }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
  }),
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: {
      readSessionBranchPreview: mocks.readPreview,
      readSessionBranchMessagesPage: mocks.readBranch,
    },
    sessionHooks: {
      useSessionHeader: () => ({ session: { id: 's', name: 'Chat' }, revision: 1 }),
      useSessionForks: mocks.options,
      useSessionMessage: mocks.message,
    },
    sessionQueryBridge: {
      subscribeCommits: mocks.subscribeCommits,
      definitions: {
        message: (_sessionId: string, id: string) => ({ queryKey: ['message', id], staleTime: Infinity }),
      },
    },
  },
}))
vi.mock('../ActionMenu', () => ({
  default: ({
    children,
    items,
  }: {
    children: React.ReactNode
    items: Array<{ divider?: boolean; text?: string; disabled?: boolean; onClick?: () => void }>
  }) => (
    <div>
      {children}
      {items
        .filter((item) => !item.divider)
        .map((item) => (
          <button key={item.text} type="button" disabled={item.disabled} onClick={item.onClick}>
            {item.text}
          </button>
        ))}
    </div>
  ),
}))
vi.mock('./Message', () => ({
  default: ({
    msg,
    readOnly,
    allowGeneratingStop,
    buttonGroup,
  }: {
    msg: Message
    readOnly?: boolean
    allowGeneratingStop?: boolean
    buttonGroup?: string
  }) => (
    <div
      data-testid={`message-${msg.id}`}
      data-read-only={readOnly}
      data-generating-stop={allowGeneratingStop}
      data-button-group={buttonGroup}
    >
      {msg.id}
    </div>
  ),
}))
import ForkGroup from './ForkGroup'

type Fork = React.ComponentProps<typeof ForkGroup>['fork']
type Branch = { branchId: string; firstMessageId: string | null; seq: number; selected: boolean }
type Preview = {
  sessionId: string
  revision: number
  threadId: string
  headMessageId: string | null
  headRole: Message['role'] | null
  pairedReplyMessageId: string | null
  followupCount: number
  revealedMessageIds?: string[]
}
const defaultFork: Fork = {
  pivotId: 'pivot',
  branchPointId: 'connection',
  selectedBranchId: 'current',
  count: 2,
  position: 0,
}
const current: Branch = { branchId: 'current', firstMessageId: null, seq: 0, selected: true }
const saved: Branch = { branchId: 'saved', firstMessageId: 'saved-first', seq: 7, selected: false }
const generationLocks: Partial<SessionLockState> = { generatingReplyCount: 2, anyReplyGenerating: true }
const messages = new Map<string, Message>()
const previews = new Map<string, Preview>()

function registerPreview(
  firstMessageId: string,
  head: string,
  overrides: Partial<Omit<Preview, 'sessionId' | 'revision' | 'threadId'>> = {}
) {
  const preview = {
    sessionId: 's',
    revision: 1,
    threadId: 't',
    headMessageId: head,
    headRole: 'assistant' as const,
    pairedReplyMessageId: null,
    followupCount: 0,
    ...overrides,
  }
  previews.set(firstMessageId, preview)
  for (const id of [head, preview.pairedReplyMessageId].filter((id): id is string => !!id))
    messages.set(id, { id, role: id === head ? (preview.headRole ?? 'assistant') : 'assistant', contentParts: [] })
}
function renderGroup({
  locks = {},
  live = [],
  fork = defaultFork,
  sessionType = 'chat',
  sessionMode = 'chat',
}: {
  locks?: Partial<SessionLockState>
  live?: SessionGenerationControl['cancellableMessages']
  fork?: Fork
  sessionType?: SessionType
  sessionMode?: 'chat' | 'work'
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const group = (
    state: {
      locks?: Partial<SessionLockState>
      live?: SessionGenerationControl['cancellableMessages']
      fork?: Fork
    } = {}
  ) => (
    <QueryClientProvider client={client}>
      <MantineProvider>
        <ForkGroup
          sessionId="s"
          sessionType={sessionType}
          msgId="pivot"
          fork={state.fork ?? fork}
          liveMessages={state.live ?? live}
          sessionLocks={{ ...IDLE_SESSION_LOCK_STATE, ...(state.locks ?? locks) }}
          sessionMode={sessionMode}
        />
      </MantineProvider>
    </QueryClientProvider>
  )
  const view = render(group())
  return { ...view, update: (state: Parameters<typeof group>[0]) => view.rerender(group(state)) }
}
function deferredPreview() {
  let resolve: (preview: Preview) => void = () => {}
  const promise = new Promise<Preview>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
function structuralCommit(): SessionCommandDelta {
  return {
    sessionId: 's',
    record: { id: 's', name: 'Chat', storageFormat: 'rows', activeThreadId: 't' },
    previousRevision: 1,
    revision: 2,
    header: { id: 's', name: 'Chat' },
    appendedMessageIds: [],
    diff: { sessionId: 's', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: ['old-tail'] } },
  }
}
function cards() {
  return Array.from(screen.getByTestId(TestId.message.forkGroup).querySelectorAll(':scope > .shadow-sm'))
}
beforeEach(() => {
  vi.clearAllMocks()
  messages.clear()
  previews.clear()
  mocks.isSmallScreen.mockReturnValue(false)
  mocks.commitListener = null
  mocks.subscribeCommits.mockImplementation((_sessionId: string, listener: (delta: SessionCommandDelta) => void) => {
    mocks.commitListener = listener
    return () => {
      if (mocks.commitListener === listener) mocks.commitListener = null
    }
  })
  registerPreview('saved-first', 'saved-first')
  mocks.readPreview.mockImplementation(
    async ({ firstMessageId }: { firstMessageId: string }) => previews.get(firstMessageId) ?? null
  )
  mocks.message.mockImplementation((_sessionId: string, id: string) => ({ message: messages.get(id) ?? null }))
  mocks.options.mockReturnValue({ branches: [current, saved] })
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })),
  })
})
describe('row branch previews', () => {
  test('keeps saved previews unloaded until expanding and preserves directional navigation', () => {
    renderGroup()
    expect(screen.getByTestId(TestId.message.forkGroup).getAttribute('data-message-id')).toBe('pivot')
    expect(screen.getByTestId(TestId.message.forkCounter).textContent).toBe('1 / 2')
    expect(mocks.readPreview).not.toHaveBeenCalled()
    expect(mocks.message).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId(TestId.message.forkNext))
    expect(mocks.switchFork).toHaveBeenCalledWith('s', 'pivot', 'next')
  })
  test('one Expand view action renders every nonempty preview newest first with original ordinals', async () => {
    registerPreview('newest-first', 'newest-first')
    mocks.options.mockReturnValue({
      branches: [
        current,
        saved,
        { branchId: 'empty', firstMessageId: null, seq: 12, selected: false },
        { branchId: 'newest', firstMessageId: 'newest-first', seq: 25, selected: false },
      ],
    })
    renderGroup({ fork: { ...defaultFork, count: 4 } })
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))
    await screen.findByTestId('message-newest-first')
    await screen.findByTestId('message-saved-first')
    expect(screen.getAllByText(/^Reply \d+$/).map((item) => item.textContent)).toEqual(['Reply 4', 'Reply 2'])
    expect(screen.getAllByRole('button', { name: 'Switch to this branch' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Branch \d+$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Load more/i })).toBeNull()
    expect(mocks.readBranch).not.toHaveBeenCalled()
    expect(mocks.readPreview.mock.calls.map(([request]) => request.firstMessageId).sort()).toEqual([
      'newest-first',
      'saved-first',
    ])
    expect(cards()).toHaveLength(2)
    for (const card of cards()) {
      expect(card.className).toContain('rounded-lg border border-solid border-chatbox-border-primary')
      expect(card.className).toContain('bg-chatbox-background-primary shadow-sm')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Collapse other branches' }))
    expect(screen.queryByTestId('message-newest-first')).toBeNull()
    expect(screen.queryByTestId('message-saved-first')).toBeNull()
  })
  test('loads remaining branch metadata automatically when expanding more than one metadata page', async () => {
    const firstPage = [
      current,
      ...Array.from({ length: 19 }, (_, index) => ({
        branchId: `empty-${index}`,
        firstMessageId: null,
        seq: index + 1,
        selected: false,
      })),
    ]
    const fetchNextPage = vi.fn().mockResolvedValue(undefined)
    registerPreview('last-first', 'last-first')
    mocks.options.mockReturnValue({
      branches: firstPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    })
    const view = renderGroup({ fork: { ...defaultFork, count: 21 } })
    expect(fetchNextPage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))
    await vi.waitFor(() => expect(fetchNextPage).toHaveBeenCalled())
    mocks.options.mockReturnValue({
      branches: [...firstPage, { branchId: 'last', firstMessageId: 'last-first', seq: 100, selected: false }],
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage,
    })
    view.update({})
    await screen.findByTestId('message-last-first')
    expect(screen.getByText('Reply 21')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Load more/i })).toBeNull()
    expect(mocks.readBranch).not.toHaveBeenCalled()
  })
  test('keeps partial metadata usable after a page failure and retries only through the visible action', async () => {
    const fetchNextPage = vi.fn()
    const refetch = vi.fn()
    mocks.options.mockReturnValue({
      branches: [current, saved],
      hasNextPage: true,
      isFetchingNextPage: false,
      isError: true,
      fetchNextPage,
      refetch,
    })
    const view = renderGroup({ fork: { ...defaultFork, count: 21 } })
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))
    await screen.findByTestId('message-saved-first')
    expect(fetchNextPage).not.toHaveBeenCalled()
    view.update({})
    expect(fetchNextPage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(fetchNextPage).not.toHaveBeenCalled()
  })
  test('restarts a pending preview after a structural commit and prevents the older result replacing its count', async () => {
    const pending = deferredPreview()
    const stale = { ...previews.get('saved-first')!, followupCount: 1 }
    const latest = { ...stale, revision: 2, followupCount: 4 }
    mocks.readPreview.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(latest)
    renderGroup()
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))
    await vi.waitFor(() => expect(mocks.readPreview).toHaveBeenCalledTimes(1))
    act(() => mocks.commitListener?.(structuralCommit()))
    await screen.findByText('4 follow-up messages')
    expect(mocks.readPreview).toHaveBeenCalledTimes(2)
    await act(async () => {
      pending.resolve(stale)
      await pending.promise
    })
    expect(screen.getByText('4 follow-up messages')).toBeTruthy()
    expect(screen.queryByText('1 follow-up message')).toBeNull()
  })
  test('preserves newly revealed live candidates when an earlier preview read is still pending', async () => {
    const pending = deferredPreview()
    registerPreview('saved-first', 'saved-first', { followupCount: 3 })
    for (const id of ['live-a', 'live-b'])
      messages.set(id, { id, role: 'assistant', generating: true, contentParts: [] })
    const live = ['live-a', 'live-b'].map((messageId) => ({
      messageId,
      threadId: 't',
      branchId: 'saved',
      forkPivotId: 'pivot',
    }))
    const stale = { ...previews.get('saved-first')!, revealedMessageIds: ['live-a'] }
    const latest = { ...stale, revision: 2, revealedMessageIds: ['live-a', 'live-b'] }
    mocks.readPreview.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(latest)
    const view = renderGroup({ locks: generationLocks, live: live.slice(0, 1) })
    await vi.waitFor(() => expect(mocks.readPreview).toHaveBeenCalledTimes(1))
    view.update({ live })
    await screen.findByTestId('message-live-b')
    expect(mocks.readPreview).toHaveBeenCalledTimes(2)
    expect(mocks.readPreview.mock.calls[1][0].revealedMessageIds).toEqual(['live-a', 'live-b'])
    expect(screen.getByText('1 follow-up message')).toBeTruthy()
    await act(async () => {
      pending.resolve(stale)
      await pending.promise
    })
    expect(screen.getByTestId('message-live-a')).toBeTruthy()
    expect(screen.getByTestId('message-live-b')).toBeTruthy()
    expect(screen.getByText('1 follow-up message')).toBeTruthy()
    expect(screen.queryByText('2 follow-up messages')).toBeNull()
  })
  test('reveals a newly added inactive branch without expanding older saved branches', async () => {
    const view = renderGroup()
    registerPreview('added-first', 'added-first')
    mocks.options.mockReturnValue({
      branches: [current, saved, { branchId: 'added', firstMessageId: 'added-first', seq: 50, selected: false }],
    })
    view.update({ fork: { ...defaultFork, count: 3 } })
    await screen.findByTestId('message-added-first')
    expect(screen.queryByTestId('message-saved-first')).toBeNull()
    expect(screen.getByText('Reply 3')).toBeTruthy()
    expect(screen.getByText('Showing 1 of 2 other replies')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expand view' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse other branches' })).toBeTruthy()
  })
  test('previews a user-headed branch with its first assistant reply and summarizes only hidden followups', async () => {
    registerPreview('saved-first', 'old-prompt', {
      headRole: 'user',
      pairedReplyMessageId: 'old-answer',
      followupCount: 2,
    })
    renderGroup()
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))
    await screen.findByTestId('message-old-prompt')
    expect(screen.getByText('Branch 2')).toBeTruthy()
    expect(screen.getByTestId('message-old-answer')).toBeTruthy()
    expect(screen.getByText('2 follow-up messages')).toBeTruthy()
    expect(mocks.message.mock.calls.map((call) => call[1])).not.toContain('saved-first')
    for (const id of ['old-prompt', 'old-answer']) {
      const message = screen.getByTestId(`message-${id}`)
      expect(message.getAttribute('data-read-only')).toBe('true')
      expect(message.getAttribute('data-generating-stop')).toBe('true')
      expect(message.getAttribute('data-button-group')).toBe('none')
    }
  })
  test('shows an unanswered user preview without a followup counter', async () => {
    registerPreview('saved-first', 'old-prompt', { headRole: 'user' })
    renderGroup()
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))
    await screen.findByTestId('message-old-prompt')
    expect(screen.getByText('Branch 2')).toBeTruthy()
    expect(screen.queryByText(/follow-up/)).toBeNull()
  })
  test('switches by stable branch ID and collapses the preview when selection changes', async () => {
    const view = renderGroup()
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))
    await screen.findByTestId('message-saved-first')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to this branch' }))
    expect(mocks.switchForkTo).toHaveBeenCalledWith('s', 'pivot', 'saved')
    mocks.options.mockReturnValue({
      branches: [
        { ...current, selected: false },
        { ...saved, selected: true },
      ],
    })
    view.update({ fork: { ...defaultFork, selectedBranchId: 'saved', position: 1 } })
    expect(screen.queryByTestId('message-saved-first')).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand view' })).toBeTruthy()
  })
  test('reveals live inactive candidates with their branch preview and retains finished followups until collapse', async () => {
    registerPreview('saved-first', 'saved-first', { followupCount: 3 })
    messages.set('live-a', { id: 'live-a', role: 'assistant', generating: true, contentParts: [] })
    messages.set('live-b', { id: 'live-b', role: 'assistant', generating: true, contentParts: [] })
    const live = ['live-a', 'live-b'].map((messageId) => ({
      messageId,
      threadId: 't',
      branchId: 'saved',
      forkPivotId: 'pivot',
    }))
    const view = renderGroup({ locks: generationLocks, live })
    await screen.findByTestId('message-saved-first')
    expect(screen.getByTestId('message-live-a')).toBeTruthy()
    expect(screen.getByTestId('message-live-b')).toBeTruthy()
    expect(screen.getByText('1 follow-up message')).toBeTruthy()
    expect(mocks.readBranch).not.toHaveBeenCalled()
    for (const id of ['live-a', 'live-b']) messages.set(id, { ...messages.get(id)!, generating: false })
    view.update({ locks: {}, live: [] })
    expect(screen.getByTestId('message-live-a')).toBeTruthy()
    expect(screen.getByTestId('message-live-b')).toBeTruthy()
    expect(screen.getByText('1 follow-up message')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse other branches' }))
    expect(screen.queryByTestId('message-live-a')).toBeNull()
    expect(screen.queryByTestId('message-saved-first')).toBeNull()
  })
  test('lets chat mode switch while replies stream and keeps fork deletion locked', async () => {
    const live = [{ messageId: 'saved-first', threadId: 't', branchId: 'saved', forkPivotId: 'pivot' }]
    renderGroup({ locks: generationLocks, live })
    await screen.findByTestId('message-saved-first')
    fireEvent.click(screen.getByTestId(TestId.message.forkNext))
    expect(mocks.switchFork).toHaveBeenCalledWith('s', 'pivot', 'next')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to this branch' }))
    expect(mocks.switchForkTo).toHaveBeenCalledWith('s', 'pivot', 'saved')
    expect((screen.getByRole('button', { name: 'delete' }) as HTMLButtonElement).disabled).toBe(true)
  })
  test('hides fork deletion for picture sessions and work mode', () => {
    const picture = renderGroup({ sessionType: 'picture' })
    expect(screen.queryByRole('button', { name: 'delete' })).toBeNull()
    picture.unmount()
    renderGroup({ sessionMode: 'work' })
    expect(screen.queryByRole('button', { name: 'delete' })).toBeNull()
  })
  test.each([{ awaitingPauseDecision: true }, { compactionRunning: true }])(
    'blocks branch changes for lock %j',
    async (locks) => {
      renderGroup({ locks })
      fireEvent.click(screen.getByTestId(TestId.message.forkNext))
      expect(mocks.switchFork).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalled())
    }
  )
  test('shows mobile lock feedback for a direct branch switch during work generation', async () => {
    mocks.isSmallScreen.mockReturnValue(true)
    renderGroup({ locks: generationLocks, sessionMode: 'work' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))
    await screen.findByTestId('message-saved-first')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to this branch' }))
    expect(mocks.switchForkTo).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalled())
  })
  test('deletes using the pivot identity', () => {
    renderGroup()
    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    expect(mocks.deleteFork).toHaveBeenCalledWith('s', 'pivot')
  })
})
