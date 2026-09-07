import type { Session } from '@chatbox/core'
import type { SessionMessagesSource, SessionReadModel } from '@chatbox/core/ports'
import { QueryKeys } from '@chatbox/react/query'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readSessionMessages: vi.fn(),
  getSession: vi.fn(),
  getCachedSession: vi.fn(),
  getQueryData: vi.fn(),
  trackJkViewEvent: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { readSessionMessages: mocks.readSessionMessages },
    queryClient: { getQueryData: mocks.getQueryData },
    sessionQueryBridge: { getSession: mocks.getSession, getCachedSession: mocks.getCachedSession },
  },
}))
vi.mock('./jk', () => ({ trackJkViewEvent: mocks.trackJkViewEvent }))

import { JK_EVENTS, JK_PAGE_NAMES } from './jk-events'
import { trackPageView } from './page-view'

function session(name = 'Session name'): Session {
  return { id: 'session-1', name, type: 'chat', threadName: 'Thread name', messages: [] }
}

function windowModel(name = 'Window session name'): SessionReadModel {
  const { messages: _messages, ...header } = session(name)
  return {
    kind: 'window',
    header,
    summary: {
      messageCount: 0,
      userMessageCount: 0,
      fileMessageCount: 0,
      generatingMessageCount: 0,
      pausedMessageCount: 0,
      hasThreads: false,
      hasForks: false,
    },
    window: {
      revision: 25,
      record: { id: header.id, name, type: 'chat', activeThreadId: 'active', storageFormat: 'rows' },
      thread: {
        sessionId: header.id,
        threadId: 'active',
        seq: -1,
        name: 'Thread name',
        createdAt: 1,
        rootMessageId: null,
        activeLeafMessageId: null,
        compactionPoints: [],
      },
      messages: [],
      older: null,
      newer: null,
    },
  }
}

describe('page view session content', () => {
  let queryClient: QueryClient
  beforeEach(() => {
    vi.resetAllMocks()
    queryClient = new QueryClient()
    mocks.getQueryData.mockImplementation((key) => queryClient.getQueryData(key))
    mocks.getCachedSession.mockImplementation((id: string) => queryClient.getQueryData(QueryKeys.ChatSession(id)))
    mocks.readSessionMessages.mockResolvedValue({
      header: { id: 'session-1', name: 'Stored name', type: 'chat' },
      revision: 25,
      messages: [],
    } satisfies SessionMessagesSource)
  })

  it.each(['window', 'full'] as const)('tracks a warm %s read model from cache', async (kind) => {
    const model: SessionReadModel =
      kind === 'window' ? windowModel() : { kind: 'full', session: session('Full model name') }
    queryClient.setQueryData(QueryKeys.ChatSessionReadModel('session-1'), model)
    queryClient.setQueryData(QueryKeys.ChatSession('session-1'), session('Older complete cache'))

    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')

    expect(mocks.readSessionMessages).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.getCachedSession).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: kind === 'window' ? 'Window session name' : 'Full model name',
    })
  })

  it('uses the complete-session cache when a read model has not loaded', async () => {
    queryClient.setQueryData(QueryKeys.ChatSession('session-1'), session('Complete session name'))
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    expect(mocks.readSessionMessages).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: 'Complete session name',
    })
  })

  it.each(['read-model', 'full-session'] as const)('honors a %s deletion tombstone', async (kind) => {
    if (kind === 'read-model') {
      queryClient.setQueryData(QueryKeys.ChatSessionReadModel('session-1'), null)
      queryClient.setQueryData(QueryKeys.ChatSession('session-1'), session('Stale name'))
    } else queryClient.setQueryData(QueryKeys.ChatSession('session-1'), null)
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    expect(mocks.readSessionMessages).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: undefined,
    })
  })

  it('uses a renamed session on the next page view', async () => {
    queryClient.setQueryData(QueryKeys.ChatSessionReadModel('session-1'), windowModel('First name'))
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    queryClient.setQueryData(QueryKeys.ChatSessionReadModel('session-1'), windowModel('Renamed session'))
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    expect(mocks.readSessionMessages).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent.mock.calls.map((call) => call[1].content)).toEqual(['First name', 'Renamed session'])
  })

  it('preserves an empty session name instead of using its thread name or reading storage', async () => {
    queryClient.setQueryData(QueryKeys.ChatSessionReadModel('session-1'), windowModel(''))
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    expect(mocks.readSessionMessages).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: '',
    })
  })

  it('reads only the header for the session page name', async () => {
    const source: SessionMessagesSource = {
      header: { id: 'session-1', name: 'Long conversation', type: 'chat', threadName: 'Current thread' },
      revision: 25,
      messages: [],
    }
    mocks.readSessionMessages.mockResolvedValue(source)

    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')

    expect(mocks.readSessionMessages).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-1', messageIds: [] })
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: 'Long conversation',
    })
  })

  it('does not read a session for other pages', async () => {
    await trackPageView(JK_PAGE_NAMES.ABOUT_PAGE)

    expect(mocks.readSessionMessages).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.ABOUT_PAGE,
      content: undefined,
    })
  })

  it.each(['missing', 'failed'])('still tracks the page when its session read is %s', async (outcome) => {
    if (outcome === 'missing') mocks.readSessionMessages.mockResolvedValue(null)
    else mocks.readSessionMessages.mockRejectedValue(new Error('Storage unavailable'))

    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')

    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: undefined,
    })
  })
})
