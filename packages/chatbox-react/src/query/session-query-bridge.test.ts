import type { SessionMetaPage } from '@chatbox/core'
import { SessionEventBus } from '@chatbox/core/application/session'
import { SessionRowConflictError, type SessionCommandDelta, type SessionHeaderRead } from '@chatbox/core/ports'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { QueryKeys } from './query-keys'
import { applySessionListUpdate, type InfiniteSessionData, SessionQueryBridge } from './session-query-bridge'
import {
  createSessionQueryDefinitions,
  type SessionMessageQueryRead,
  type SessionQuerySource,
} from './session-query-options'
import { SessionTranscriptWindowController } from './session-transcript-window'
import { InMemorySessionRowStore } from '@chatbox/core/testing'

const emptyPage: SessionMetaPage = { items: [], nextCursor: null, total: 0 }
function header(revision = 1): SessionHeaderRead {
  return {
    header: { id: 's', name: 'Chat', type: 'chat' },
    revision,
    activeThreadId: 't',
    control: { generatingAssistantCount: 1 },
    summary: {
      hasAutoTitleContent: false,
      messageCount: 1,
      userMessageCount: 0,
      assistantMessageCount: 1,
      fileMessageCount: 0,
      generatingMessageCount: 1,
      pausedMessageCount: 0,
      webSearchSignInErrorCount: 0,
      legacyCommandMessageCount: 0,
      steeredMessageCount: 0,
    },
  }
}
function harness() {
  const events = new SessionEventBus()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const source = {
    getSessionHeader: vi.fn<SessionQuerySource['getSessionHeader']>().mockResolvedValue(header()),
    readSessionMessages: vi.fn<SessionQuerySource['readSessionMessages']>().mockResolvedValue(null),
    readSessionThread: vi.fn<SessionQuerySource['readSessionThread']>().mockResolvedValue(null),
    readSessionTranscriptWindow: vi.fn<SessionQuerySource['readSessionTranscriptWindow']>().mockResolvedValue(null),
    readSessionThreadSummariesPage: vi
      .fn<SessionQuerySource['readSessionThreadSummariesPage']>()
      .mockResolvedValue(null),
    readSessionForkOptionsPage: vi.fn<SessionQuerySource['readSessionForkOptionsPage']>().mockResolvedValue(null),
    listSessionsMetaPage: vi.fn<SessionQuerySource['listSessionsMetaPage']>().mockResolvedValue(emptyPage),
    listArchivedSessionsMetaPage: vi
      .fn<SessionQuerySource['listArchivedSessionsMetaPage']>()
      .mockResolvedValue(emptyPage),
    listSessionFolders: vi.fn<NonNullable<SessionQuerySource['listSessionFolders']>>().mockResolvedValue([]),
  }
  const bridge = new SessionQueryBridge(client, source, events)
  const dispose = () => {
    bridge.dispose()
    client.clear()
  }
  return { source, client, events, bridge, dispose }
}
function delta(revision: number): SessionCommandDelta {
  return {
    sessionId: 's',
    previousRevision: revision - 1,
    revision,
    record: { id: 's', name: 'Chat', type: 'chat', activeThreadId: 't', storageFormat: 'rows' },
    header: header().header,
    previousHeader: header().header,
    diff: { sessionId: 's', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
    appendedMessageIds: [],
  }
}

describe('row query definitions', () => {
  it('uses isolated header and single-message reads while offline', async () => {
    const h = harness()
    try {
      const definitions = createSessionQueryDefinitions(h.source)
      expect(definitions.header('s').networkMode).toBe('always')
      expect(definitions.message('s', 'm').gcTime).toBe(0)
      expect(await h.client.fetchQuery(definitions.header('s'))).toEqual(header())
      await h.client.fetchQuery(definitions.message('s', 'm'))
      expect(h.source.readSessionMessages).toHaveBeenCalledExactlyOnceWith({ sessionId: 's', messageIds: ['m'] })
      expect(h.source.readSessionTranscriptWindow).not.toHaveBeenCalled()
    } finally {
      h.dispose()
    }
  })
})

describe('row query event bridge', () => {
  it.each([false, true])('projects a created branch atomically from committed rows (empty: %s)', async (empty) => {
    const h = harness()
    const store = new InMemorySessionRowStore()
    const messages = [0, 1].map((index) => ({
      sessionId: 's',
      threadId: 't',
      messageId: `m${index}`,
      parentMessageId: index ? 'm0' : null,
      activeChildId: index ? null : 'm1',
      siblingOrder: index,
      kind: 'message' as const,
      status: 'settled' as const,
      createdAt: index,
      updatedAt: index,
      branchId: null,
      selected: true,
      message: { id: `m${index}`, role: 'user' as const, contentParts: [] },
    }))
    const thread = {
      sessionId: 's',
      threadId: 't',
      threadOrder: -1,
      name: null,
      createdAt: 0,
      rootMessageId: 'm0',
      activeLeafMessageId: 'm1',
      compactionPoints: [],
    }
    await store.writeRows({ ...delta(1), rows: { sessionId: 's', messages, threads: [thread] } })
    const read = vi.spyOn(store, 'readTranscriptWindow')
    const controller = new SessionTranscriptWindowController({ sessionId: 's', pageSize: 20, source: store })
    h.bridge.registerWindow('s', controller)
    try {
      await controller.open()
      controller.acknowledgeLayout(controller.getSnapshot().layout!.requestId)
      const epoch = controller.getSnapshot().windowEpoch
      const snapshots: ReturnType<typeof controller.getSnapshot>[] = []
      controller.subscribe(() => snapshots.push(controller.getSnapshot()))
      const reply = {
        ...messages[1],
        messageId: 'm2',
        status: 'generating' as const,
        message: { ...messages[1].message, id: 'm2', role: 'assistant' as const, generating: true },
      }
      const { message: _message, ...pivot } = messages[0]
      const change = delta(2)
      change.diff.messages.upsert = empty ? [] : [reply]
      change.diff.messageMetadataUpsert = [{ ...pivot, activeChildId: empty ? null : 'm2' }]
      change.diff.threads.upsert = [{ ...thread, activeLeafMessageId: empty ? 'm0' : 'm2' }]
      change.appendedMessageIds = empty ? [] : ['m2']
      change.structureResult = {
        applied: true,
        cancelMessageIds: [],
        navigation: {
          type: 'branch',
          mode: 'create',
          sharedPrefixEnd: { threadId: 't', messageId: 'm0' },
          firstMessageId: empty ? null : 'm2',
        },
      }
      await h.events.publish({
        type: 'session-command-committed',
        delta: change,
        meta: null,
        metaRevision: null,
        preserveCachedGeneratingMessages: true,
      })
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toMatchObject({
        revision: 2,
        windowEpoch: epoch,
        hasNewer: false,
        operation: { kind: 'branch', phase: 'layout' },
      })
      expect(snapshots[0].rows.map((row) => row.messageId)).toEqual(empty ? ['m0'] : ['m0', 'm2'])
      expect(snapshots[0].operation?.branchOperationId).toBe(snapshots[0].layout?.requestId)
      expect(read).toHaveBeenCalledTimes(1)
      if (!empty) {
        await h.bridge.updateMessageCache('s', 'm2', { contentParts: [{ type: 'text', text: 'live reply' }] })
        const live = controller.getSnapshot().rows.at(-1)?.message
        const checkpoint = delta(3)
        checkpoint.diff.messages.upsert = [reply]
        await h.events.publish({
          type: 'session-command-committed',
          delta: checkpoint,
          meta: null,
          metaRevision: null,
          preserveCachedGeneratingMessages: true,
        })
        expect(controller.getSnapshot().rows.at(-1)?.message).toBe(live)
        expect(controller.getSnapshot().operation?.branchOperationId).toBe(snapshots[0].operation?.branchOperationId)
        expect(read).toHaveBeenCalledTimes(1)
      }
    } finally {
      h.dispose()
    }
  })

  it.each(['message', 'thread-tail'] as const)(
    'marks missing-prefix branch replacement as a branch operation at its %s target',
    async (target) => {
      const h = harness()
      const store = new InMemorySessionRowStore()
      const messages = [0, 1].map((i) => ({
        sessionId: 's',
        threadId: 't',
        messageId: `m${i}`,
        parentMessageId: i ? 'm0' : null,
        activeChildId: i ? null : 'm1',
        siblingOrder: i,
        kind: 'message' as const,
        status: 'settled' as const,
        createdAt: i,
        updatedAt: i,
        branchId: null,
        selected: true,
        message: { id: `m${i}`, role: 'user' as const, contentParts: [] },
      }))
      const thread = {
        sessionId: 's',
        threadId: 't',
        threadOrder: -1,
        name: null,
        createdAt: 0,
        rootMessageId: 'm0',
        activeLeafMessageId: 'm1',
        compactionPoints: [],
      }
      await store.writeRows({ ...delta(1), rows: { sessionId: 's', messages, threads: [thread] } })
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize: 1,
        source: { readTranscriptWindow: store.readTranscriptWindow.bind(store) },
      })
      h.bridge.registerWindow('s', controller)
      try {
        await controller.open()
        controller.acknowledgeLayout(controller.getSnapshot().layout!.requestId)
        expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(['m1'])
        const reply = {
          ...messages[1],
          messageId: 'm2',
          siblingOrder: 2,
          message: { ...messages[1].message, id: 'm2' },
        }
        const nextRows = [{ ...messages[0], activeChildId: 'm2' }, { ...messages[1], selected: false }, reply]
        const nextThread = { ...thread, activeLeafMessageId: 'm2' }
        const change = delta(2)
        change.diff.messages.upsert = nextRows
        change.diff.threads.upsert = [nextThread]
        change.structureResult = {
          applied: true,
          cancelMessageIds: [],
          navigation: {
            type: 'branch',
            mode: 'select',
            sharedPrefixEnd: { threadId: 't', messageId: 'm0' },
            firstMessageId: target === 'message' ? 'm2' : null,
          },
        }
        await store.writeRows({ ...change, rows: { sessionId: 's', messages: nextRows, threads: [nextThread] } })
        const navigate = controller.navigateBranch.bind(controller)
        let branching: Promise<boolean> | undefined
        const branchRead = vi.spyOn(controller, 'navigateBranch').mockImplementation((...args) => {
          branching = navigate(...args)
          return branching
        })
        await h.events.publish({
          type: 'session-command-committed',
          delta: change,
          meta: null,
          metaRevision: null,
          preserveCachedGeneratingMessages: false,
        })
        expect(await branching).toBe(true)
        expect(branchRead).toHaveBeenCalledExactlyOnceWith(
          target === 'message' ? { messageId: 'm2' } : { threadId: 't', edge: 'tail' },
          2
        )
        const state = controller.getSnapshot()
        expect(state.rows.map((row) => row.messageId)).toEqual(['m2'])
        expect(state.operation).toMatchObject({ kind: 'branch', branchOperationId: state.operation?.requestId })
        expect(state.layout?.kind).toBe(target === 'message' ? 'head' : 'tail')
      } finally {
        h.dispose()
      }
    }
  )

  it('does not read or retain off-screen message bodies for a stream chunk', async () => {
    const h = harness()
    try {
      await h.bridge.updateMessageCache('s', 'off-screen', { contentParts: [{ type: 'text', text: 'live' }] })
      expect(h.source.readSessionMessages).not.toHaveBeenCalled()
      expect(h.client.getQueryData(QueryKeys.ChatSessionMessage('s', 'off-screen'))).toBeUndefined()
    } finally {
      h.dispose()
    }
  })

  it.each(['tail', 'branch'] as const)(
    'projects title and body commits during pending %s layout without rereading retained pages',
    async (layout) => {
      const h = harness()
      const store = new InMemorySessionRowStore()
      const messages = Array.from({ length: 80 }, (_, i) => ({
        sessionId: 's',
        threadId: 't',
        messageId: `m${i}`,
        parentMessageId: i ? `m${i - 1}` : null,
        activeChildId: i < 79 ? `m${i + 1}` : null,
        siblingOrder: i,
        kind: 'message' as const,
        status: 'settled' as const,
        createdAt: i,
        updatedAt: i,
        branchId: null,
        selected: true,
        message: {
          id: `m${i}`,
          role: 'user' as const,
          contentParts: [{ type: 'text' as const, text: `message ${i}` }],
        },
      }))
      const thread = {
        sessionId: 's',
        threadId: 't',
        threadOrder: -1,
        name: null,
        createdAt: 0,
        rootMessageId: 'm0',
        activeLeafMessageId: 'm79',
        compactionPoints: [],
      }
      await store.writeRows({ ...delta(1), rows: { sessionId: 's', messages, threads: [thread] } })
      const read = vi.fn(store.readTranscriptWindow.bind(store))
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize: 20,
        source: { readTranscriptWindow: read },
      })
      h.bridge.registerWindow('s', controller)
      try {
        await controller.open()
        if (layout === 'branch') {
          controller.acknowledgeLayout(controller.getSnapshot().layout!.requestId)
          await controller.loadOlder()
          controller.acknowledgeLayout(controller.getSnapshot().layout!.requestId)
          await store.writeRows({ ...delta(2), rows: { sessionId: 's', messages, threads: [thread] } })
          await controller.applyBranchCommit({
            ...delta(2),
            previousRevision: 1,
            sharedPrefixEnd: { threadId: 't', messageId: 'm69' },
            origin: { messageId: 'm70' },
          })
          expect(controller.getSnapshot().operation?.error).toBeUndefined()
          expect(controller.getSnapshot().pages).toHaveLength(3)
        }
        const initialReadCount = read.mock.calls.length
        const initialPageCount = controller.getSnapshot().pages.length
        const nextRevision = layout === 'branch' ? 3 : 2
        const pending = controller.getSnapshot().layout
        const body = controller.getSnapshot().rows[0].message
        const change = delta(nextRevision)
        change.structureResult = { applied: true, cancelMessageIds: [] }
        change.header = { ...change.header, threadName: 'Title' }
        change.diff.threads.upsert = [{ ...thread, name: 'Title' }]
        await store.writeRows({ ...change, rows: { sessionId: 's', messages, threads: change.diff.threads.upsert } })
        await h.events.publish({
          type: 'session-command-committed',
          delta: change,
          meta: null,
          metaRevision: null,
          preserveCachedGeneratingMessages: false,
        })
        expect(read).toHaveBeenCalledTimes(initialReadCount)
        expect(controller.getSnapshot().revision).toBe(nextRevision)
        expect(controller.getSnapshot().layout).toBe(pending)
        expect(controller.getSnapshot().rows[0].message).toBe(body)
        expect(controller.getSnapshot().threads[0].name).toBe('Title')
        expect(controller.getSnapshot().pages[0].older?.revision).toBe(nextRevision)
        const checkpoint = delta(nextRevision + 1)
        checkpoint.diff.messages.upsert = [
          {
            ...messages[75],
            message: { ...messages[75].message, contentParts: [{ type: 'text', text: 'checkpoint' }] },
          },
        ]
        await store.writeRows({
          ...checkpoint,
          rows: {
            sessionId: 's',
            messages: messages.map((row) => (row.messageId === 'm75' ? checkpoint.diff.messages.upsert[0] : row)),
            threads: change.diff.threads.upsert,
          },
        })
        await h.events.publish({
          type: 'session-command-committed',
          delta: checkpoint,
          meta: null,
          metaRevision: null,
          preserveCachedGeneratingMessages: false,
        })
        expect(read).toHaveBeenCalledTimes(initialReadCount)
        expect(controller.getSnapshot().layout).toBe(pending)
        expect(controller.getSnapshot().pages).toHaveLength(initialPageCount)
        expect(controller.getSnapshot().rows[0].message).toBe(body)
        expect(controller.getSnapshot().rows.find((row) => row.messageId === 'm75')?.message.contentParts).toEqual([
          { type: 'text', text: 'checkpoint' },
        ])
        controller.acknowledgeLayout(pending!.requestId)
        await controller.loadOlder()
        expect(read).toHaveBeenLastCalledWith(
          expect.objectContaining({
            expectedRevision: nextRevision + 1,
            cursor: expect.objectContaining({ revision: nextRevision + 1 }),
          })
        )
        expect(controller.getSnapshot().pages).toHaveLength(initialPageCount + 1)
        expect(controller.getSnapshot().operation?.phase).toBe('layout')
      } finally {
        h.dispose()
      }
    }
  )

  it('patches a mounted row and point read while keeping an unmounted row out of the cache', async () => {
    const h = harness()
    const store = new InMemorySessionRowStore()
    const commit = delta(1)
    const message = { id: 'm', role: 'assistant' as const, generating: true, contentParts: [] }
    const row = {
      sessionId: 's',
      threadId: 't',
      messageId: 'm',
      parentMessageId: null,
      activeChildId: null,
      siblingOrder: 0,
      kind: 'message' as const,
      status: 'generating' as const,
      createdAt: 0,
      updatedAt: 0,
      branchId: null,
      message,
    }
    await store.writeRows({
      ...commit,
      rows: {
        sessionId: 's',
        threads: [
          {
            sessionId: 's',
            threadId: 't',
            name: null,
            threadOrder: -1,
            createdAt: 0,
            rootMessageId: 'm',
            activeLeafMessageId: 'm',
            compactionPoints: [],
          },
        ],
        messages: [row],
      },
    })
    const controller = new SessionTranscriptWindowController({ sessionId: 's', pageSize: 20, source: store })
    await controller.open()
    controller.acknowledgeLayout(controller.getSnapshot().layout!.requestId)
    h.bridge.registerWindow('s', controller)
    h.client.setQueryData<SessionMessageQueryRead>(QueryKeys.ChatSessionMessage('s', 'm'), {
      header: header().header,
      revision: 1,
      message,
    })
    try {
      await h.bridge.updateMessageCache('s', 'm', { contentParts: [{ type: 'text', text: 'live' }] })
      expect(controller.getSnapshot().rows[0].message.contentParts).toEqual([{ type: 'text', text: 'live' }])
      expect(
        h.client.getQueryData<SessionMessageQueryRead>(QueryKeys.ChatSessionMessage('s', 'm'))?.message?.contentParts
      ).toEqual([{ type: 'text', text: 'live' }])
      const change = delta(2)
      change.diff.messages.upsert = [
        { ...row, message: { ...message, contentParts: [{ type: 'text', text: 'checkpoint' }] } },
      ]
      await h.events.publish({
        type: 'session-command-committed',
        delta: change,
        meta: null,
        metaRevision: null,
        preserveCachedGeneratingMessages: true,
      })
      expect(controller.getSnapshot().revision).toBe(2)
      expect(controller.getSnapshot().rows[0].message.contentParts).toEqual([{ type: 'text', text: 'live' }])
      expect(h.source.readSessionMessages).not.toHaveBeenCalled()
    } finally {
      h.dispose()
    }
  })

  it('ignores older command events and discards all mounted data on deletion', async () => {
    const h = harness()
    try {
      h.client.setQueryData(QueryKeys.ChatSessionHeader('s'), header())
      h.source.getSessionHeader.mockResolvedValue(header(3))
      const current = delta(3)
      await h.events.publish({
        type: 'session-command-committed',
        delta: current,
        meta: null,
        metaRevision: null,
        preserveCachedGeneratingMessages: false,
      })
      await h.events.publish({
        type: 'session-command-committed',
        delta: delta(2),
        meta: null,
        metaRevision: null,
        preserveCachedGeneratingMessages: false,
      })
      expect(h.client.getQueryData<SessionHeaderRead>(QueryKeys.ChatSessionHeader('s'))?.revision).toBe(3)
      expect(h.source.getSessionHeader).toHaveBeenCalledTimes(1)
      await h.events.publish({ type: 'session-deleted', ids: ['s'] })
      expect(h.client.getQueryData(QueryKeys.ChatSessionHeader('s'))).toBeNull()
      expect(h.client.getQueriesData({ queryKey: QueryKeys.ChatSessionMessage('s') })).toEqual([])
    } finally {
      h.dispose()
    }
  })

  it('cancels a list continuation when a new ordered prefix is installed', async () => {
    const h = harness()
    try {
      h.bridge.resetSessionList({
        items: [{ id: 's', name: 'Chat', sortOrder: 1, createdAt: 1 }],
        total: 2,
        nextCursor: 1,
      })
      let finish: ((page: SessionMetaPage) => void) | undefined
      h.source.listSessionsMetaPage.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      const request = h.client
        .fetchInfiniteQuery({ ...h.bridge.definitions.sessions, staleTime: 0 })
        .catch(() => undefined)
      await Promise.resolve()
      h.bridge.resetSessionList(emptyPage)
      finish?.({ items: [{ id: 'late', name: 'Late', sortOrder: 0, createdAt: 0 }], total: 1, nextCursor: null })
      await request
      expect(h.bridge.getCachedSessionsMeta()).toEqual([])
    } finally {
      h.dispose()
    }
  })
})

describe('applySessionListUpdate', () => {
  it('dedupes overlapping pages and advances the cursor from the unique prefix', () => {
    const first = { id: 'session-1', name: 'First', sortOrder: 1, createdAt: 1 }
    const second = { id: 'session-2', name: 'Second', sortOrder: 2, createdAt: 2 }
    const updated = applySessionListUpdate(
      {
        pages: [
          { items: [second, first], nextCursor: 2, total: 3 },
          { items: [first], nextCursor: 3, total: 3 },
        ],
        pageParams: [0, 2],
      },
      (items) => items
    )

    expect(updated).toEqual({
      pages: [
        {
          items: [second, first],
          nextCursor: 2,
          total: 3,
        },
      ],
      pageParams: [0],
    })
  })
})

describe('title publication and a pinned continuation', () => {
  it.each([
    'during-read',
    'after-conflict',
    'after-later-conflict',
    'after-read-error',
    'after-null-conflict',
    'after-other-session-conflict',
    'after-search-conflict',
  ] as const)('handles a title commit arriving %s', async (timing) => {
    const h = harness()
    const store = new InMemorySessionRowStore()
    const messages = Array.from({ length: 80 }, (_, i) => ({
      sessionId: 's',
      threadId: 't',
      messageId: `m${i}`,
      parentMessageId: i ? `m${i - 1}` : null,
      activeChildId: i < 79 ? `m${i + 1}` : null,
      siblingOrder: i,
      kind: 'message' as const,
      status: 'settled' as const,
      createdAt: i,
      updatedAt: i,
      branchId: null,
      selected: true,
      message: { id: `m${i}`, role: 'user' as const, contentParts: [{ type: 'text' as const, text: `message ${i}` }] },
    }))
    const thread = {
      sessionId: 's',
      threadId: 't',
      threadOrder: -1,
      name: null,
      createdAt: 0,
      rootMessageId: 'm0',
      activeLeafMessageId: 'm79',
      compactionPoints: [],
    }
    await store.writeRows({ ...delta(1), rows: { sessionId: 's', messages, threads: [thread] } })
    const actualRead = store.readTranscriptWindow.bind(store)
    const read = vi.fn(actualRead)
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: read },
      captureAnchor: () => ({ threadId: 't', messageId: 'm60', offset: 0 }),
    })
    const unregister = h.bridge.registerWindow('s', controller)
    try {
      await controller.open()
      expect(controller.acknowledgeLayout(controller.getSnapshot().layout!.requestId)).toBe(true)
      const ids =
        timing === 'after-search-conflict'
          ? Array.from({ length: 20 }, (_, i) => `m${11 + i}`)
          : controller.getSnapshot().rows.map((row) => row.messageId)
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const preserveError = ['after-read-error', 'after-null-conflict', 'after-other-session-conflict'].includes(timing)
      const readError =
        timing === 'after-null-conflict'
          ? new SessionRowConflictError('s', 1, null)
          : timing === 'after-other-session-conflict'
            ? new SessionRowConflictError('another-session', 1, 2)
            : new Error('Storage read unavailable')
      read.mockImplementationOnce(async (request) => {
        await held
        if (preserveError) throw readError
        return actualRead(timing === 'after-search-conflict' ? { ...request, expectedRevision: 1 } : request)
      })
      const continuation = timing === 'after-search-conflict' ? controller.openSearch('m20') : controller.loadOlder(1)
      if (timing === 'after-search-conflict')
        expect(read.mock.lastCall?.[0]).toMatchObject({ origin: { messageId: 'm20' } })
      else
        expect(read.mock.lastCall?.[0]).toMatchObject({
          expectedRevision: 1,
          cursor: { revision: 1, direction: 'before' },
        })
      const actualRevision = timing === 'after-later-conflict' ? 3 : 2
      const change = delta(2)
      change.header = { ...change.header, threadName: 'Title' }
      change.structureResult = { applied: true, cancelMessageIds: [] }
      change.diff.threads.upsert = [{ ...thread, name: 'Title' }]
      await store.writeRows({
        ...change,
        revision: actualRevision,
        rows: { sessionId: 's', messages, threads: change.diff.threads.upsert },
      })
      if (timing !== 'during-read') {
        release()
        expect(await continuation).toBe(false)
        if (!preserveError)
          expect(controller.getSnapshot().operation?.error).toMatchObject({
            name: 'SessionRowConflictError',
            expectedRevision: 1,
            actualRevision,
          })
        else expect(controller.getSnapshot().operation?.error).toBe(readError)
      }
      await h.events.publish({
        type: 'session-command-committed',
        delta: change,
        meta: null,
        metaRevision: null,
        preserveCachedGeneratingMessages: false,
      })
      if (timing === 'after-later-conflict') {
        expect(controller.getSnapshot().revision).toBe(2)
        expect(controller.getSnapshot().operation?.error).toMatchObject({ expectedRevision: 1, actualRevision: 3 })
        expect(read).toHaveBeenCalledTimes(2)
        await h.events.publish({
          type: 'session-command-committed',
          delta: { ...change, revision: 3, previousRevision: 2 },
          meta: null,
          metaRevision: null,
          preserveCachedGeneratingMessages: false,
        })
      }
      release()
      expect(await continuation).toBe(false)
      await vi.waitFor(() => expect(controller.getSnapshot().revision).toBe(actualRevision))
      if (preserveError) {
        expect(controller.getSnapshot().operation?.error).toBe(readError)
        expect(read).toHaveBeenCalledTimes(2)
        expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(ids)
        return
      }
      expect(controller.getSnapshot().operation?.error).toBeUndefined()
      await vi.waitFor(() => expect(controller.getSnapshot().layout).not.toBeNull())
      expect(controller.acknowledgeLayout(controller.getSnapshot().layout!.requestId)).toBe(true)
      expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(
        timing === 'after-search-conflict' ? ids : Array.from({ length: 40 }, (_, i) => `m${40 + i}`)
      )
      expect(controller.getSnapshot().pages).toHaveLength(timing === 'after-search-conflict' ? 1 : 2)
      expect(controller.getSnapshot().operation).toBeNull()
      expect(read).toHaveBeenCalledTimes(3)
      if (timing === 'after-search-conflict')
        expect(read.mock.lastCall?.[0].origin).toEqual({ messageId: 'm20', align: 'center' })
      else {
        expect(read.mock.lastCall?.[0]).toMatchObject({
          expectedRevision: actualRevision,
          cursor: { direction: 'before', messageId: 'm60', revision: actualRevision },
        })
        expect(await controller.loadOlder(1)).toBe(false)
        expect(read).toHaveBeenCalledTimes(3)
      }
    } finally {
      unregister()
      h.dispose()
    }
  })
})
