// @vitest-environment jsdom
import type { SessionTranscriptPage, SessionTranscriptRequest } from '@chatbox/core/ports'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useSessionTranscript } from './useSessionPresentation'

const state = vi.hoisted(() => ({ type: 'web', read: vi.fn(), register: vi.fn(() => vi.fn()) }))
vi.mock('@/platform', () => ({
  default: {
    get type() {
      return state.type
    },
  },
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { readSessionTranscriptWindow: state.read },
    sessionQueryBridge: { registerWindow: state.register },
  },
}))

function page(request: SessionTranscriptRequest): SessionTranscriptPage {
  const first =
    typeof request.origin === 'object' && 'messageId' in request.origin ? request.origin.messageId : 'latest'
  const row = {
    sessionId: 's',
    threadId: 't',
    messageId: first,
    parentMessageId: null,
    activeChildId: null,
    seq: 0,
    kind: 'message' as const,
    status: 'settled' as const,
    createdAt: 1,
    updatedAt: 1,
    branchId: null,
    message: { id: first, role: 'user' as const, contentParts: [] },
  }
  return {
    record: { id: 's', name: 'Chat', storageFormat: 'rows', activeThreadId: 't' },
    revision: 1,
    threads: [
      {
        sessionId: 's',
        threadId: 't',
        seq: -1,
        name: 'Current',
        createdAt: 1,
        rootMessageId: first,
        activeLeafMessageId: first,
      },
    ],
    messages: [row],
    payloadBytes: 50,
    anchor: { threadId: 't', messageId: first },
    older: null,
    newer: null,
  }
}
beforeEach(() => {
  state.read.mockReset().mockImplementation(async (request) => page(request))
  state.register.mockClear()
})
afterEach(() => {
  state.type = 'web'
})

test.each([
  ['mobile', 20],
  ['desktop', 100],
  ['web', 100],
])('opens one %s page and waits for its host layout', async (platform, size) => {
  state.type = platform
  const view = renderHook(() => useSessionTranscript('s'))
  await waitFor(() => expect(view.result.current.messages).toHaveLength(1))
  expect(state.read).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ sessionId: 's', limit: size, origin: 'tail' })
  )
  expect(view.result.current.firstWindowReady).toBe(false)
  act(() => view.result.current.controller.acknowledgeLayout(view.result.current.layout!.requestId))
  expect(view.result.current.firstWindowReady).toBe(true)
  view.unmount()
})

test('starts the first body read around a search result with target layout', async () => {
  const view = renderHook(() => useSessionTranscript('s', { messageId: 'search-result' }))
  await waitFor(() => expect(view.result.current.messages[0]?.id).toBe('search-result'))
  expect(state.read).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ origin: { messageId: 'search-result', align: 'center' } })
  )
  expect(view.result.current.layout).toMatchObject({ kind: 'anchor', anchor: { messageId: 'search-result' } })
  view.unmount()
})
