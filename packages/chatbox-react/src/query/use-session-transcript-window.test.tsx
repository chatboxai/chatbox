// @vitest-environment jsdom
import type { SessionTranscriptPage, SessionTranscriptRequest } from '@chatbox/core/ports'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useSessionTranscriptWindow } from './use-session-transcript-window'

vi.mock('@chatbox/core/ports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@chatbox/core/ports')>()),
  DEFAULT_TRANSCRIPT_PAGE_BYTES: 2 * 1024 * 1024,
}))

function page(request: SessionTranscriptRequest): SessionTranscriptPage {
  const messageId =
    typeof request.origin === 'object' && 'messageId' in request.origin ? request.origin.messageId : 'last'
  return {
    record: { id: request.sessionId, name: 'Conversation', activeThreadId: 'thread', storageFormat: 'rows' },
    revision: 1,
    payloadBytes: 100,
    messages: [
      {
        sessionId: request.sessionId,
        threadId: 'thread',
        messageId,
        parentMessageId: null,
        activeChildId: null,
        siblingOrder: 0,
        kind: 'message',
        status: 'settled',
        createdAt: 0,
        updatedAt: 0,
        branchId: null,
        message: { id: messageId, role: 'user', contentParts: [] },
      },
    ],
    threads: [
      {
        sessionId: request.sessionId,
        threadId: 'thread',
        threadOrder: -1,
        name: 'Current',
        createdAt: 0,
        rootMessageId: messageId,
        activeLeafMessageId: messageId,
      },
    ],
    anchor: { threadId: 'thread', messageId },
    older: null,
    newer: null,
  }
}

describe('useSessionTranscriptWindow', () => {
  it('opens the search target directly and only exposes readiness after the current layout acknowledgement', async () => {
    const source = { readTranscriptWindow: vi.fn(async (request: SessionTranscriptRequest) => page(request)) }
    const { result } = renderHook(() =>
      useSessionTranscriptWindow({ sessionId: 's', pageSize: 20, source, initialOrigin: { messageId: 'found' } })
    )
    await waitFor(() => expect(result.current.rows[0]?.messageId).toBe('found'))
    expect(source.readTranscriptWindow).toHaveBeenCalledTimes(1)
    expect(source.readTranscriptWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin: { messageId: 'found', align: 'center' }, limit: 20 })
    )
    expect(result.current.firstWindowReady).toBe(false)
    expect(result.current.layout?.kind).toBe('anchor')
    act(() => {
      result.current.controller.acknowledgeLayout(result.current.layout!.requestId)
    })
    expect(result.current.firstWindowReady).toBe(true)
  })

  it('creates a fresh pagination owner when the page-size configuration changes', async () => {
    const source = { readTranscriptWindow: vi.fn(async (request: SessionTranscriptRequest) => page(request)) }
    const { result, rerender } = renderHook(
      ({ pageSize }) => useSessionTranscriptWindow({ sessionId: 's', pageSize, source }),
      { initialProps: { pageSize: 20 } }
    )
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    const previous = result.current.controller
    act(() => {
      previous.acknowledgeLayout(result.current.layout!.requestId)
    })
    rerender({ pageSize: 50 })
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    expect(result.current.controller).not.toBe(previous)
    expect(previous.getSnapshot().pages).toEqual([])
    expect(result.current.pageSize).toBe(50)
    expect(result.current.firstWindowReady).toBe(false)
    expect(source.readTranscriptWindow).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }))
  })

  it('survives strict effect setup and releases its pages after unmount', async () => {
    const source = { readTranscriptWindow: vi.fn(async (request: SessionTranscriptRequest) => page(request)) }
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>
    const { result, unmount } = renderHook(() => useSessionTranscriptWindow({ sessionId: 's', pageSize: 20, source }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    const controller = result.current.controller
    expect(result.current.rows).toHaveLength(1)
    unmount()
    expect(controller.getSnapshot().pages).toEqual([])
    expect(controller.getSnapshot().firstWindowReady).toBe(false)
  })
})

it('prefetches links only after layout is acknowledged and aborts its background work on unmount', async () => {
  const source = {
    readTranscriptWindow: vi.fn(async (request: SessionTranscriptRequest) => page(request)),
    prefetchThreadLinks: vi.fn(
      async (_request: import('@chatbox/core/ports').SessionThreadRequest & { signal?: AbortSignal }) => {}
    ),
  }
  const { result, unmount } = renderHook(() => useSessionTranscriptWindow({ sessionId: 's', pageSize: 20, source }))
  await waitFor(() => expect(result.current.rows).toHaveLength(1))
  expect(source.prefetchThreadLinks).not.toHaveBeenCalled()
  act(() => {
    result.current.controller.acknowledgeLayout(result.current.layout!.requestId)
  })
  await waitFor(() => expect(source.prefetchThreadLinks).toHaveBeenCalledTimes(1))
  const request = source.prefetchThreadLinks.mock.calls[0][0]
  expect(request).toMatchObject({ sessionId: 's', threadId: 'thread', expectedRevision: 1 })
  expect(request.signal?.aborted).toBe(false)
  unmount()
  expect(request.signal?.aborted).toBe(true)
})
