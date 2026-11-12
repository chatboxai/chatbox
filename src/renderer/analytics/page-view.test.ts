import type { SessionHeaderRead } from '@chatbox/core/ports'
import { QueryKeys } from '@chatbox/react/query'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSessionHeader: vi.fn(), getQueryData: vi.fn(), trackJkViewEvent: vi.fn() }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { getSessionHeader: mocks.getSessionHeader },
    queryClient: { getQueryData: mocks.getQueryData },
  },
}))
vi.mock('./jk', () => ({ trackJkViewEvent: mocks.trackJkViewEvent }))
import { JK_EVENTS, JK_PAGE_NAMES } from './jk-events'
import { trackPageView } from './page-view'

function header(name = 'Session name'): SessionHeaderRead {
  return {
    header: { id: 'session-1', name, type: 'chat', threadName: 'Thread name' },
    revision: 25,
    activeThreadId: 'active',
    control: { generatingAssistantCount: 0 },
    summary: {
      hasAutoTitleContent: false,
      messageCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
      fileMessageCount: 0,
      generatingMessageCount: 0,
      pausedMessageCount: 0,
      webSearchSignInErrorCount: 0,
      legacyCommandMessageCount: 0,
      steeredMessageCount: 0,
    },
  }
}
describe('page view session content', () => {
  let client: QueryClient
  beforeEach(() => {
    vi.resetAllMocks()
    client = new QueryClient()
    mocks.getQueryData.mockImplementation((key) => client.getQueryData(key))
    mocks.getSessionHeader.mockResolvedValue(header('Stored name'))
  })
  it.each(['Cached name', ''])('uses the cached header name %s', async (name) => {
    client.setQueryData(QueryKeys.ChatSessionHeader('session-1'), header(name))
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    expect(mocks.getSessionHeader).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: name,
    })
  })
  it('honors the header deletion tombstone', async () => {
    client.setQueryData(QueryKeys.ChatSessionHeader('session-1'), null)
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    expect(mocks.getSessionHeader).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: undefined,
    })
  })
  it('uses the renamed header on the next visit', async () => {
    client.setQueryData(QueryKeys.ChatSessionHeader('session-1'), header('First name'))
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    client.setQueryData(QueryKeys.ChatSessionHeader('session-1'), header('Renamed'))
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    expect(mocks.getSessionHeader).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent.mock.calls.map((call) => call[1].content)).toEqual(['First name', 'Renamed'])
  })
  it('reads only the header on a cold visit', async () => {
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    expect(mocks.getSessionHeader).toHaveBeenCalledExactlyOnceWith('session-1')
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: 'Stored name',
    })
  })
  it('does not read a session for other pages', async () => {
    await trackPageView(JK_PAGE_NAMES.ABOUT_PAGE)
    expect(mocks.getSessionHeader).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.ABOUT_PAGE,
      content: undefined,
    })
  })
  it.each(['missing', 'failed'])('tracks a visit when the header is %s', async (outcome) => {
    if (outcome === 'missing') mocks.getSessionHeader.mockResolvedValue(null)
    else mocks.getSessionHeader.mockRejectedValue(new Error('Storage unavailable'))
    await trackPageView(JK_PAGE_NAMES.CHAT_PAGE, 'session-1')
    expect(mocks.trackJkViewEvent).toHaveBeenCalledExactlyOnceWith(JK_EVENTS.PAGE_VIEW, {
      pageName: JK_PAGE_NAMES.CHAT_PAGE,
      content: undefined,
    })
  })
})
