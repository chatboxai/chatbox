import {
  SessionRowConflictError,
  type SessionRowCommit,
  type SessionCommandDelta,
  type SessionTranscriptCursor,
  type SessionTranscriptPage,
  type SessionTranscriptRequest,
  type SessionTranscriptThread,
} from '@chatbox/core/ports'
import type { MessageRow } from '@chatbox/core/session/session-tree'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  sessionTranscriptPageSize,
  SessionTranscriptWindowController,
  type SessionTranscriptViewportAnchor,
  type SessionTranscriptWindowSource,
} from './session-transcript-window'

vi.mock('@chatbox/core/ports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@chatbox/core/ports')>()),
  DEFAULT_TRANSCRIPT_PAGE_BYTES: 2 * 1024 * 1024,
}))

function message(threadId: string, index: number): MessageRow {
  const id = `${threadId}-${index}`
  return {
    sessionId: 's',
    threadId,
    messageId: id,
    parentMessageId: index === 1 ? null : `${threadId}-${index - 1}`,
    activeChildId: `${threadId}-${index + 1}`,
    siblingOrder: index,
    kind: 'message',
    status: 'settled',
    createdAt: index,
    updatedAt: index,
    branchId: null,
    message: { id, role: 'user', contentParts: [{ type: 'text', text: id }] },
  }
}

function fixture(counts = [100, 100, 100]) {
  const rows = counts.flatMap((count, index) =>
    Array.from({ length: count }, (_, position) => message(`T${index + 1}`, position + 1))
  )
  const threads: SessionTranscriptThread[] = counts.map((count, index) => ({
    sessionId: 's',
    threadId: `T${index + 1}`,
    threadOrder: index === counts.length - 1 ? -1 : index,
    name: `Thread ${index + 1}`,
    createdAt: index,
    rootMessageId: count ? `T${index + 1}-1` : null,
    activeLeafMessageId: count ? `T${index + 1}-${count}` : null,
  }))
  let revision = 1
  const record = { id: 's', name: 'Conversation', activeThreadId: `T${counts.length}`, storageFormat: 'rows' as const }
  const cursor = (
    row: MessageRow,
    direction: 'before' | 'after',
    limit: number,
    maxBytes: number
  ): SessionTranscriptCursor => ({
    sessionId: 's',
    revision,
    threadId: row.threadId,
    threadOrder: threads.find((thread) => thread.threadId === row.threadId)!.threadOrder,
    messageId: row.messageId,
    direction,
    limit,
    maxBytes,
    scope: 'transcript',
  })
  const read = vi.fn(async (request: SessionTranscriptRequest): Promise<SessionTranscriptPage> => {
    const expected = request.expectedRevision ?? request.cursor?.revision
    if (expected !== undefined && expected !== revision) throw new SessionRowConflictError('s', expected, revision)
    const origin = request.origin ?? 'tail'
    const maxBytes = request.maxBytes ?? 2 * 1024 * 1024
    let start = 0
    let end = rows.length
    let target = rows.at(-1)
    let targetThread = threads.at(-1)!
    if (request.cursor) {
      const index = rows.findIndex((row) => row.messageId === request.cursor?.messageId)
      if (request.cursor.direction === 'before') end = index
      else start = index + 1
    } else if (origin === 'head') end = request.limit
    else if (origin !== 'tail') {
      if ('messageId' in origin) {
        start = rows.findIndex((row) => row.messageId === origin.messageId)
        target = rows[start]
      } else {
        targetThread = threads.find((thread) => thread.threadId === origin.threadId)!
        const id = origin.edge === 'head' ? targetThread.rootMessageId : targetThread.activeLeafMessageId
        const index = rows.findIndex((row) => row.messageId === id)
        target = index >= 0 ? rows[index] : undefined
        if (origin.edge === 'head') start = index >= 0 ? index : rows.length
        else end = index >= 0 ? index + 1 : 0
      }
    }
    const backwards =
      request.cursor?.direction === 'before' ||
      (!request.cursor &&
        (origin === 'tail' || (typeof origin !== 'string' && 'edge' in origin && origin.edge === 'tail')))
    if (!request.cursor && typeof origin === 'object' && origin.align === 'center' && target) {
      const targetIndex = rows.indexOf(target)
      start = Math.max(0, Math.min(targetIndex - Math.floor((request.limit - 1) / 2), rows.length - request.limit))
      end = Math.min(rows.length, start + request.limit)
    } else if (backwards) start = Math.max(start, end - request.limit)
    else end = Math.min(end, start + request.limit)
    const messages = rows.slice(start, end)
    if (origin === 'head') target = messages[0]
    if (request.cursor) target = messages[0]
    const relevant = new Set(messages.map((row) => row.threadId))
    if (target) targetThread = threads.find((thread) => thread.threadId === target.threadId)!
    relevant.add(targetThread.threadId)
    return {
      record,
      revision,
      messages,
      payloadBytes: messages.length * 100,
      threads: threads.filter((thread) => relevant.has(thread.threadId)),
      anchor: { threadId: targetThread.threadId, messageId: target?.messageId ?? null },
      older: messages.length && start > 0 ? cursor(messages[0], 'before', request.limit, maxBytes) : null,
      newer:
        messages.length && end < rows.length
          ? cursor(messages[messages.length - 1], 'after', request.limit, maxBytes)
          : null,
    }
  })
  return {
    rows,
    threads,
    record,
    read,
    setRevision: (value: number) => {
      revision = value
    },
  }
}

function createdBranch(data: ReturnType<typeof fixture>, pivotId: string, count = 1): SessionCommandDelta {
  const pivot = data.rows.find((row) => row.messageId === pivotId)!
  const thread = data.threads.find((item) => item.threadId === pivot.threadId)!
  const chain = Array.from({ length: count }, (_, index): MessageRow => {
    const row = message(pivot.threadId, 1000 + index)
    return {
      ...row,
      parentMessageId: index ? `${pivot.threadId}-${999 + index}` : pivotId,
      activeChildId: index < count - 1 ? `${pivot.threadId}-${1001 + index}` : null,
      status: 'generating',
      selected: true,
      message: { ...row.message, role: 'assistant', generating: true },
    }
  })
  const { message: _message, ...metadata } = pivot
  return {
    sessionId: 's',
    record: data.record,
    previousRevision: 1,
    revision: 2,
    header: { id: 's', name: 'Conversation' },
    appendedMessageIds: chain.map((row) => row.messageId),
    structureResult: {
      applied: true,
      cancelMessageIds: [],
      navigation: {
        type: 'branch',
        mode: 'create',
        sharedPrefixEnd: { threadId: pivot.threadId, messageId: pivotId },
        firstMessageId: chain[0]?.messageId ?? null,
      },
    },
    diff: {
      sessionId: 's',
      threads: {
        upsert: [{ ...thread, compactionPoints: [], activeLeafMessageId: chain.at(-1)?.messageId ?? pivotId }],
        delete: [],
      },
      messages: { upsert: chain, delete: [] },
      messageMetadataUpsert: [{ ...metadata, activeChildId: chain[0]?.messageId ?? null }],
    },
  }
}

function acknowledge(controller: SessionTranscriptWindowController): void {
  const requestId = controller.getSnapshot().layout?.requestId
  if (requestId === undefined) throw new Error('No layout to acknowledge')
  expect(controller.acknowledgeLayout(requestId)).toBe(true)
}

function deferred<T>() {
  let resolve!: (result: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('platform transcript page size', () => {
  it.each([
    ['rn', 20],
    ['capacitor', 20],
    ['electron', 100],
    ['web', 100],
  ] as const)('%s uses %i messages', (platform, size) => {
    expect(sessionTranscriptPageSize(platform)).toBe(size)
  })
})

describe('transcript window', () => {
  it('publishes the committed new branch once and keeps its layout operation through live and durable updates', async () => {
    const data = fixture([4])
    const anchor = { threadId: 'T1', messageId: 'T1-3', offset: -17 }
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
      captureAnchor: () => anchor,
    })
    await controller.open()
    acknowledge(controller)
    const epoch = controller.getSnapshot().windowEpoch
    const notifications = vi.fn(() => controller.getSnapshot())
    controller.subscribe(notifications)
    const change = createdBranch(data, 'T1-3')
    expect(controller.applyCreatedBranch(change, true)).toBe(true)
    expect(notifications).toHaveBeenCalledTimes(1)
    const state = controller.getSnapshot()
    expect(state.rows.map((row) => row.messageId)).toEqual(['T1-1', 'T1-2', 'T1-3', 'T1-1000'])
    expect(state.rows[2].activeChildId).toBe('T1-1000')
    expect(state).toMatchObject({ revision: 2, hasNewer: false, windowEpoch: epoch })
    expect(state.operation).toMatchObject({
      kind: 'branch',
      phase: 'layout',
      branchOperationId: state.layout?.requestId,
    })
    expect(state.layout).toMatchObject({ kind: 'preserve', anchor })
    expect(state.layout?.rebase).toBeUndefined()
    expect(state.threads[0].activeLeafMessageId).toBe('T1-1000')
    controller.updateMessage('T1-1000', { contentParts: [{ type: 'text', text: 'live' }] })
    const live = controller.getSnapshot().rows.at(-1)?.message
    expect(controller.applyRows({ record: data.record, revision: 3 }, 2, change.diff.messages.upsert, [], true)).toBe(
      true
    )
    expect(controller.getSnapshot().rows.at(-1)?.message).toBe(live)
    expect(controller.getSnapshot().operation?.branchOperationId).toBe(state.operation?.branchOperationId)
    const settled = {
      ...change.diff.messages.upsert[0],
      message: { ...change.diff.messages.upsert[0].message, generating: false },
    }
    expect(controller.applyRows({ record: data.record, revision: 4 }, 3, [settled], [], false)).toBe(true)
    expect(controller.getSnapshot().rows.at(-1)?.message.generating).toBe(false)
    expect(controller.getSnapshot().windowEpoch).toBe(epoch)
    expect(data.read).toHaveBeenCalledTimes(1)
    acknowledge(controller)
    controller.close()
  })

  it('retains five prefix pages across threads and continues to the next thread after the new chain', async () => {
    const data = fixture([3, 4, 2])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 1,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open('head')
    acknowledge(controller)
    for (let index = 0; index < 4; index++) {
      await controller.loadNewer()
      acknowledge(controller)
    }
    const before = controller.getSnapshot()
    const change = createdBranch(data, 'T2-2')
    expect(controller.applyCreatedBranch(change, true)).toBe(true)
    const state = controller.getSnapshot()
    expect(state.pages).toHaveLength(6)
    expect(state.rows.slice(0, 5).map((row) => row.messageId)).toEqual(before.rows.map((row) => row.messageId))
    expect(state.threads.map((thread) => thread.threadId)).toEqual(['T1', 'T2'])
    expect(state.pages.at(-1)?.newer).toMatchObject({
      threadId: 'T2',
      threadOrder: 1,
      messageId: 'T2-1000',
      revision: 2,
    })
    expect(state.windowEpoch).toBe(before.windowEpoch)
    expect(data.read).toHaveBeenCalledTimes(5)
    data.rows.splice(5, 2, ...change.diff.messages.upsert)
    Object.assign(data.threads[1], change.diff.threads.upsert[0])
    data.setRevision(2)
    acknowledge(controller)
    await controller.loadNewer()
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T3-1')
    expect(controller.getSnapshot().pages).toHaveLength(7)
  })

  it('keeps an empty created branch at the committed tail and accepts its first appended reply', async () => {
    const data = fixture([3])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const change = createdBranch(data, 'T1-2', 0)
    expect(controller.applyCreatedBranch(change, true)).toBe(true)
    expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(['T1-1', 'T1-2'])
    expect(controller.getSnapshot().hasNewer).toBe(false)
    const reply = createdBranch(data, 'T1-2').diff.messages.upsert[0]
    expect(controller.applyRows({ record: data.record, revision: 3 }, 2, [reply], [reply.messageId], true)).toBe(true)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe(reply.messageId)
    expect(controller.getSnapshot().hasNewer).toBe(false)
    expect(data.read).toHaveBeenCalledTimes(1)
  })

  it('continues from an empty historical branch into an active thread that receives an append', async () => {
    const data = fixture([3, 2])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open('head')
    acknowledge(controller)
    const change = createdBranch(data, 'T1-2', 0)
    expect(controller.applyCreatedBranch(change, true)).toBe(true)
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().pages[0].messages).toHaveLength(2)
    expect(controller.getSnapshot().pages[0].newer).toMatchObject({ threadId: 'T1', messageId: 'T1-2', revision: 2 })
    data.rows.splice(2, 1)
    Object.assign(data.threads[0], change.diff.threads.upsert[0])
    data.setRevision(2)
    acknowledge(controller)
    expect(await controller.loadNewer()).toBe(true)
    acknowledge(controller)
    expect(controller.getSnapshot().pages.every((page) => page.messages.length > 0)).toBe(true)
    const reply = { ...message('T2', 3), activeChildId: null }
    expect(controller.applyRows({ record: data.record, revision: 3 }, 2, [reply], [reply.messageId], false)).toBe(true)
    const state = controller.getSnapshot()
    expect(state.rows.map((row) => row.messageId)).toEqual(['T1-1', 'T1-2', 'T2-1', 'T2-2', 'T2-3'])
    expect(state.pages[0].newer).toMatchObject({ threadId: 'T1', messageId: 'T1-2', revision: 3 })
    expect(state).toMatchObject({ revision: 3, hasNewer: false })
    expect(data.read).toHaveBeenCalledTimes(2)
  })

  it('projects a bounded new chain when its pivot is outside the mounted page', async () => {
    const data = fixture([6])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 2,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const epoch = controller.getSnapshot().windowEpoch
    expect(controller.applyCreatedBranch(createdBranch(data, 'T1-3', 3), true)).toBe(true)
    expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(['T1-1000', 'T1-1001'])
    expect(controller.getSnapshot().pages[0].older).toMatchObject({
      messageId: 'T1-1000',
      direction: 'before',
      revision: 2,
    })
    expect(controller.getSnapshot().pages[0].newer).toMatchObject({
      messageId: 'T1-1001',
      direction: 'after',
      revision: 2,
    })
    expect(controller.getSnapshot().layout?.anchor).toEqual({ threadId: 'T1', messageId: 'T1-1000' })
    expect(controller.getSnapshot().windowEpoch).toBe(epoch)
    expect(data.read).toHaveBeenCalledTimes(1)
  })

  it('applies the byte budget to the first committed branch page', async () => {
    const data = fixture([2])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      maxBytes: 250,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const change = createdBranch(data, 'T1-1', 2)
    change.diff.messages.upsert[0].message.contentParts = [{ type: 'text', text: 'a'.repeat(300) }]
    expect(controller.applyCreatedBranch(change, false)).toBe(true)
    expect(controller.getSnapshot().pages.at(-1)?.messages).toHaveLength(1)
    expect(controller.getSnapshot().pages.at(-1)?.payloadBytes).toBeGreaterThan(250)
    expect(controller.getSnapshot().hasNewer).toBe(true)
    expect(data.read).toHaveBeenCalledTimes(1)
  })

  it('rejects stale or incomplete creation deltas without publishing partial state', async () => {
    const data = fixture([3])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const before = controller.getSnapshot()
    const notify = vi.fn()
    controller.subscribe(notify)
    const change = createdBranch(data, 'T1-2')
    expect(controller.applyCreatedBranch({ ...change, previousRevision: 0 }, true)).toBe(false)
    expect(controller.applyCreatedBranch({ ...change, appendedMessageIds: ['absent'] }, true)).toBe(false)
    expect(controller.getSnapshot()).toBe(before)
    expect(notify).not.toHaveBeenCalled()
    expect(data.read).toHaveBeenCalledTimes(1)
  })

  it('fences an older pending read when a new branch is projected', async () => {
    const data = fixture([6])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const pending = deferred<SessionTranscriptPage>()
    data.read.mockImplementationOnce(() => pending.promise)
    const navigation = controller.openSearch('T1-1')
    expect(controller.applyCreatedBranch(createdBranch(data, 'T1-5'), true)).toBe(true)
    const state = controller.getSnapshot()
    pending.resolve(await fixture([6]).read({ sessionId: 's', limit: 20, origin: 'head' }))
    expect(await navigation).toBe(false)
    expect(controller.getSnapshot()).toBe(state)
  })

  it('applies fork and thread metadata to a retained prefix without reading or copying message bodies', async () => {
    const data = fixture([3])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const body = controller.getSnapshot().rows[0].message
    const { message: _message, ...metadata } = data.rows[0]
    controller.updateMetadata(
      [
        {
          ...metadata,
          fork: {
            pivotId: metadata.messageId,
            branchPointId: metadata.messageId,
            selectedBranchId: 'b',
            count: 2,
            position: 1,
          },
        },
      ],
      [{ ...data.threads[0], name: 'Renamed' }]
    )
    expect(controller.getSnapshot().rows[0].fork?.selectedBranchId).toBe('b')
    expect(controller.getSnapshot().rows[0].message).toBe(body)
    expect(controller.getSnapshot().threads[0].name).toBe('Renamed')
    expect(data.read).toHaveBeenCalledTimes(1)
  })

  it('retains loaded pages and a committed append beyond five pages', async () => {
    const data = fixture([120])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    for (let index = 0; index < 4; index++) {
      await controller.loadOlder(index)
      acknowledge(controller)
    }
    const before = controller.getSnapshot().rows.map((row) => row.messageId)
    const added = message('T1', 121)
    expect(controller.applyRows({ record: data.record, revision: 2 }, 1, [added], [added.messageId], false)).toBe(true)
    expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual([...before, added.messageId])
    expect(controller.getSnapshot().pages).toHaveLength(6)
    expect(controller.getSnapshot().hasNewer).toBe(false)
    expect(data.read).toHaveBeenCalledTimes(5)
  })

  it('packs durable appended bodies by bytes and retains every page', async () => {
    const data = fixture([1])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const loadedBodyRead = vi.fn(() => [{ type: 'text' as const, text: 'existing' }])
    Object.defineProperty(data.rows[0].message, 'contentParts', { get: loadedBodyRead })
    for (let index = 2; index <= 8; index++) {
      const row = message('T1', index)
      row.message.contentParts = [{ type: 'text', text: 'x'.repeat(1_250_000) }]
      expect(
        controller.applyRows({ record: data.record, revision: index }, index - 1, [row], [row.messageId], false)
      ).toBe(true)
      expect(controller.getSnapshot().pages.length).toBe(index - 1)
      for (const page of controller.getSnapshot().pages) {
        expect(page.payloadBytes).not.toBeNull()
        expect(page.payloadBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
      }
    }
    expect(loadedBodyRead).not.toHaveBeenCalled()
    expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual([
      'T1-1',
      'T1-2',
      'T1-3',
      'T1-4',
      'T1-5',
      'T1-6',
      'T1-7',
      'T1-8',
    ])
    expect(controller.getSnapshot().hasNewer).toBe(false)
    expect(controller.getSnapshot().pages.at(-1)?.newer).toBeNull()
  })

  it('keeps a single oversized appended body on its own page', async () => {
    const data = fixture([1])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const large = message('T1', 2),
      small = message('T1', 3)
    large.message.contentParts = [{ type: 'text', text: 'x'.repeat(3 * 1024 * 1024) }]
    expect(
      controller.applyRows(
        { record: data.record, revision: 2 },
        1,
        [large, small],
        [large.messageId, small.messageId],
        false
      )
    ).toBe(true)
    const pages = controller.getSnapshot().pages
    expect(pages.map((page) => page.messages.map((row) => row.messageId))).toEqual([['T1-1'], ['T1-2'], ['T1-3']])
    expect(pages[1].payloadBytes).toBeGreaterThan(2 * 1024 * 1024)
    expect(pages[2].payloadBytes).toBeLessThan(2 * 1024 * 1024)
  })

  it('keeps thread and navigation projections stable while coalescing streaming notifications', async () => {
    vi.useFakeTimers()
    const data = fixture([20, 20])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    await controller.loadOlder()
    acknowledge(controller)
    const before = controller.getSnapshot()
    const changed = vi.fn()
    controller.subscribe(changed)

    for (const text of ['A', 'AB', 'ABC']) {
      controller.updateMessage('T2-20', { generating: true, contentParts: [{ type: 'text', text }] })
      const after = controller.getSnapshot()
      expect(after.rows.at(-1)?.message.contentParts).toEqual([{ type: 'text', text }])
      expect(after.threads).toBe(before.threads)
      expect(after.pages[0]).toBe(before.pages[0])
      expect(after.rows[0]).toBe(before.rows[0])
      expect(after.pages[1].payloadBytes).toBeNull()
      expect(after.pages[1].older).toBe(before.pages[1].older)
      expect(after.pages[1].newer).toBe(before.pages[1].newer)
      expect(after.revision).toBe(before.revision)
      expect(after.windowEpoch).toBe(before.windowEpoch)
      expect(after.operation).toBe(before.operation)
      expect(after.layout).toBe(before.layout)
      expect(after.firstWindowReady).toBe(true)
    }

    expect(changed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)
    expect(changed).toHaveBeenCalledTimes(1)
    controller.updateMessage('T2-20', { generating: true, contentParts: [{ type: 'text', text: 'ABCD' }] })
    vi.advanceTimersByTime(16)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(data.read).toHaveBeenCalledTimes(2)
  })

  it('applies interleaved functional updates before notifying subscribers', async () => {
    vi.useFakeTimers()
    const data = fixture([2])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const changed = vi.fn()
    controller.subscribe(changed)
    for (const id of ['T1-1', 'T1-2', 'T1-1']) {
      controller.updateMessage(id, (current) => {
        if (!current) throw new Error('Expected a mounted message')
        return {
          ...current,
          generating: true,
          contentParts: current.contentParts.map((part) =>
            part.type === 'text' ? { ...part, text: `${part.text}!` } : part
          ),
        }
      })
    }
    expect(controller.getSnapshot().rows.map((row) => row.message.contentParts)).toEqual([
      [{ type: 'text', text: 'T1-1!!' }],
      [{ type: 'text', text: 'T1-2!' }],
    ])
    expect(changed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('publishes terminal message updates immediately and cancels the pending live notification', async () => {
    vi.useFakeTimers()
    const data = fixture([1])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const changed = vi.fn()
    controller.subscribe(changed)
    controller.updateMessage('T1-1', { generating: true, contentParts: [{ type: 'text', text: 'live' }] })
    controller.updateMessage('T1-1', (current) => {
      if (!current) throw new Error('Expected a mounted message')
      return { ...current, generating: false }
    })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().rows[0].message.generating).toBe(false)
    vi.advanceTimersByTime(16)
    expect(changed).toHaveBeenCalledTimes(1)
    controller.updateMessage('T1-1', { contentParts: [{ type: 'text', text: 'edited' }] })
    expect(changed).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().rows[0].message.contentParts).toEqual([{ type: 'text', text: 'edited' }])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('projects checkpoints synchronously while preserving the latest pending live body', async () => {
    vi.useFakeTimers()
    const data = fixture([1])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const changed = vi.fn()
    controller.subscribe(changed)
    controller.updateMessage('T1-1', { generating: true, contentParts: [{ type: 'text', text: 'latest live' }] })
    const checkpoint = { ...data.rows[0], message: { ...data.rows[0].message, generating: true } }
    expect(controller.applyRows({ record: data.record, revision: 2 }, 1, [checkpoint], [], true)).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().revision).toBe(2)
    expect(controller.getSnapshot().rows[0].message.contentParts).toEqual([{ type: 'text', text: 'latest live' }])
    vi.advanceTimersByTime(16)
    expect(changed).toHaveBeenCalledTimes(1)
    controller.updateMessage('T1-1', { generating: true, contentParts: [{ type: 'text', text: 'newer live' }] })
    expect(controller.applyRows({ record: data.record, revision: 3 }, 2, data.rows, [], false)).toBe(true)
    expect(controller.getSnapshot().rows[0].message).toBe(data.rows[0].message)
    expect(changed).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(16)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('keeps navigation and layout notifications synchronous during a pending stream notification', async () => {
    vi.useFakeTimers()
    const data = fixture([1])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const phases: Array<string | null> = []
    controller.subscribe(() => phases.push(controller.getSnapshot().operation?.phase ?? null))
    controller.updateMessage('T1-1', { generating: true })
    await controller.navigate('head')
    expect(phases).toEqual(['reading', 'layout'])
    acknowledge(controller)
    expect(phases).toEqual(['reading', 'layout', null])
    vi.advanceTimersByTime(16)
    expect(phases).toEqual(['reading', 'layout', null])
  })

  it('discards scheduled notifications when closing, reopening, or losing the last subscriber', async () => {
    vi.useFakeTimers()
    const data = fixture([1])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const changed = vi.fn()
    const unsubscribe = controller.subscribe(changed)
    controller.updateMessage('T1-1', { generating: true })
    unsubscribe()
    const nextChanged = vi.fn()
    controller.subscribe(nextChanged)
    vi.advanceTimersByTime(16)
    expect(changed).not.toHaveBeenCalled()
    expect(nextChanged).not.toHaveBeenCalled()
    controller.updateMessage('T1-1', { generating: true })
    controller.close()
    expect(controller.getSnapshot().rows).toEqual([])
    expect(nextChanged).toHaveBeenCalledTimes(1)
    await controller.open()
    acknowledge(controller)
    expect(controller.getSnapshot().rows[0].message).toBe(data.rows[0].message)
    const notifications = nextChanged.mock.calls.length
    vi.advanceTimersByTime(16)
    expect(nextChanged).toHaveBeenCalledTimes(notifications)
  })

  it('opens a new page after a full live page without rereading its unknown byte size', async () => {
    const data = fixture([20])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    controller.updateMessage('T1-20', { generating: true, contentParts: [{ type: 'text', text: 'live' }] })
    const before = controller.getSnapshot().rows
    const row = message('T1', 21)
    expect(controller.applyRows({ record: data.record, revision: 2 }, 1, [row], [row.messageId], false)).toBe(true)
    const state = controller.getSnapshot()
    expect(state.revision).toBe(2)
    expect(state.rows.slice(0, 20)).toEqual(before)
    expect(state.rows.at(-1)?.messageId).toBe('T1-21')
    expect(state.hasNewer).toBe(false)
    expect(state.pages.map((page) => page.messages.length)).toEqual([20, 1])
    expect(state.pages[0].payloadBytes).toBeNull()
    expect(state.pages[1].payloadBytes).toBe(new TextEncoder().encode(JSON.stringify(row.message)).length)
    expect(data.read).toHaveBeenCalledTimes(1)
  })

  it('requires a bounded source read before appending to a live page with unknown bytes', async () => {
    const data = fixture([1])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    controller.updateMessage('T1-1', { generating: true, contentParts: [{ type: 'text', text: 'live' }] })
    const pages = controller.getSnapshot().pages
    const row = message('T1', 2)
    expect(controller.applyRows({ record: data.record, revision: 2 }, 1, [row], [row.messageId], false)).toBe(false)
    expect(controller.getSnapshot().pages).toBe(pages)
    expect(controller.getSnapshot().rows).toHaveLength(1)
    expect(data.read).toHaveBeenCalledTimes(1)
  })

  it('refreshes an in-flight initial tail read from the latest revision and ignores its old response', async () => {
    const data = fixture([100])
    const first = deferred<SessionTranscriptPage>()
    const old = await data.read({ sessionId: 's', limit: 20, origin: 'tail' })
    const captureAnchor = vi.fn(() => ({ threadId: 'T1', messageId: 'T1-1', offset: 0 }))
    data.read.mockImplementationOnce(() => first.promise)
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
      captureAnchor,
    })
    const opening = controller.open()
    data.setRevision(2)
    await controller.refresh()
    expect(data.read.mock.lastCall?.[0]).toMatchObject({ origin: 'tail' })
    expect(data.read.mock.lastCall?.[0].expectedRevision).toBeUndefined()
    expect(controller.getSnapshot().layout?.kind).toBe('tail')
    expect(controller.getSnapshot().firstWindowReady).toBe(false)
    first.resolve(old)
    expect(await opening).toBe(false)
    expect(controller.getSnapshot().revision).toBe(2)
    expect(captureAnchor).not.toHaveBeenCalled()
  })

  it.each(['tail', 'search', 'view', 'switch', 'loaded-target'] as const)(
    'refresh preserves pending %s intent until layout is acknowledged, then captures the visible reader position',
    async (intent) => {
      const data = fixture([100, 100])
      const captureAnchor = vi.fn(() => ({ threadId: 'T2', messageId: 'T2-82', offset: -7 }))
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize: 20,
        source: { readTranscriptWindow: data.read },
        captureAnchor,
      })
      await controller.open()
      if (intent !== 'tail') {
        acknowledge(controller)
        if (intent === 'search') await controller.openSearch('T1-40')
        else if (intent === 'view') await controller.viewThread('T1')
        else if (intent === 'switch')
          await controller.showSwitchedThread({ record: { ...data.record, activeThreadId: 'T1' }, revision: 1 })
        else await controller.navigate({ messageId: 'T2-90' })
      }
      const oldRequest = controller.getSnapshot().layout!.requestId
      const expectedKind = controller.getSnapshot().layout!.kind
      const expectedAnchor = controller.getSnapshot().layout!.anchor
      const expectedOrigin =
        intent === 'tail'
          ? 'tail'
          : intent === 'search'
            ? { messageId: 'T1-40', align: 'center' }
            : intent === 'view'
              ? { threadId: 'T1', edge: 'head', align: 'center' }
              : intent === 'switch'
                ? { threadId: 'T1', edge: 'tail' }
                : { messageId: 'T2-90', align: 'center' }
      data.setRevision(2)
      await controller.refresh()
      expect(captureAnchor).not.toHaveBeenCalled()
      expect(data.read.mock.lastCall?.[0].origin).toEqual(expectedOrigin)
      expect(data.read.mock.lastCall?.[0].expectedRevision).toBeUndefined()
      expect(controller.getSnapshot().layout).toMatchObject({ kind: expectedKind, anchor: expectedAnchor })
      expect(controller.acknowledgeLayout(oldRequest)).toBe(false)
      acknowledge(controller)
      await controller.refresh()
      expect(captureAnchor).toHaveBeenCalledTimes(1)
      expect(controller.getSnapshot().layout).toMatchObject({
        kind: 'preserve',
        anchor: { messageId: 'T2-82', offset: -7 },
      })
    }
  )

  it('uses the pending preserve anchor during a page rebase rather than transient DOM geometry', async () => {
    const data = fixture([200])
    let visible = { threadId: 'T1', messageId: 'T1-181', offset: -9 }
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
      captureAnchor: () => visible,
    })
    await controller.open()
    acknowledge(controller)
    await controller.loadOlder()
    visible = { threadId: 'T1', messageId: 'T1-161', offset: 0 }
    data.setRevision(2)
    await controller.refresh()
    expect(data.read.mock.lastCall?.[0].origin).toEqual({ messageId: 'T1-181' })
    expect(controller.getSnapshot().layout).toMatchObject({
      kind: 'preserve',
      anchor: { messageId: 'T1-181', offset: -9 },
    })
  })

  it.each(['tail', 'thread-head'] as const)(
    'refresh keeps a pending %s edge when its previous endpoint is deleted',
    async (edge) => {
      const data = fixture([4])
      const captureAnchor = vi.fn(() => ({ threadId: 'T1', messageId: 'T1-3', offset: 0 }))
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize: 20,
        source: { readTranscriptWindow: data.read },
        captureAnchor,
      })
      await controller.open()
      acknowledge(controller)
      await controller.navigate(edge === 'tail' ? 'tail' : { threadId: 'T1', edge: 'head' })
      const removedId = edge === 'tail' ? 'T1-4' : 'T1-1'
      data.rows.splice(edge === 'tail' ? 3 : 0, 1)
      if (edge === 'thread-head') data.threads[0].rootMessageId = 'T1-2'
      data.setRevision(2)
      await controller.refresh([removedId])
      expect(captureAnchor).not.toHaveBeenCalled()
      expect(data.read.mock.lastCall?.[0].origin).toEqual(
        edge === 'tail' ? 'tail' : { threadId: 'T1', edge: 'head', align: 'center' }
      )
      expect(controller.getSnapshot().layout).toMatchObject({
        kind: edge === 'tail' ? 'tail' : 'anchor',
        anchor: { messageId: edge === 'tail' ? 'T1-3' : 'T1-2' },
      })
    }
  )

  it('does not replay a pending navigation target deleted by the refresh commit', async () => {
    const data = fixture([4])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
      captureAnchor: () => ({ threadId: 'T1', messageId: 'T1-3', offset: 0 }),
    })
    await controller.open()
    acknowledge(controller)
    await controller.openSearch('T1-2')
    data.rows.splice(1, 1)
    data.setRevision(2)
    await controller.refresh(['T1-2'])
    expect(data.read.mock.lastCall?.[0].origin).toEqual({ messageId: 'T1-3' })
  })

  it('refreshes a removed visible anchor from a surviving row', async () => {
    const data = fixture([4])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
      captureAnchor: () => ({ threadId: 'T1', messageId: 'T1-2', offset: -5 }),
    })
    await controller.open()
    acknowledge(controller)
    data.rows.splice(1, 1)
    data.setRevision(2)
    await controller.refresh(['T1-2'])
    expect(data.read.mock.lastCall?.[0].origin).toEqual({ messageId: 'T1-1' })
    expect(controller.getSnapshot().rows.some((row) => row.messageId === 'T1-2')).toBe(false)
  })

  it.each(['refresh', 'search', 'navigate'] as const)(
    'preserves a mounted live reply across an overlapping %s page read',
    async (operation) => {
      const data = fixture([4])
      data.rows[1] = {
        ...data.rows[1],
        status: 'generating',
        message: { ...data.rows[1].message, role: 'assistant', generating: true },
      }
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize: 20,
        source: { readTranscriptWindow: data.read },
      })
      await controller.open()
      acknowledge(controller)
      controller.updateMessage('T1-2', { contentParts: [{ type: 'text', text: 'live ABC' }] })
      const live = controller.getSnapshot().rows[1].message
      data.rows.splice(3, 1)
      data.rows[1] = { ...data.rows[1], activeChildId: 'T1-3', updatedAt: 10 }
      data.setRevision(2)
      if (operation === 'refresh') await controller.refresh(['T1-4'])
      else if (operation === 'search') await controller.openSearch('T1-1')
      else await controller.navigate('head', 2)
      expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(['T1-1', 'T1-2', 'T1-3'])
      expect(controller.getSnapshot().rows[1].message).toBe(live)
      expect(controller.getSnapshot().rows[1].updatedAt).toBe(10)
      expect(controller.getSnapshot().pages[0].payloadBytes).toBeNull()
      expect(controller.getSnapshot().revision).toBe(2)
    }
  )

  it('keeps chunks received while a replacement read is pending and accepts the terminal payload', async () => {
    const data = fixture([3])
    data.rows[1] = {
      ...data.rows[1],
      status: 'generating',
      message: { ...data.rows[1].message, role: 'assistant', generating: true },
    }
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const durable = await data.read({ sessionId: 's', limit: 20, origin: 'head' })
    const pending = deferred<SessionTranscriptPage>()
    data.read.mockImplementationOnce(() => pending.promise)
    const refresh = controller.refresh()
    controller.updateMessage('T1-2', { contentParts: [{ type: 'text', text: 'live ABC' }] })
    pending.resolve(durable)
    expect(await refresh).toBe(true)
    expect(controller.getSnapshot().rows[1].message.contentParts).toEqual([{ type: 'text', text: 'live ABC' }])
    acknowledge(controller)
    data.rows[1] = {
      ...data.rows[1],
      status: 'settled',
      message: {
        ...data.rows[1].message,
        generating: false,
        contentParts: [{ type: 'text', text: 'committed ABCD' }],
      },
    }
    data.setRevision(2)
    await controller.refresh()
    expect(controller.getSnapshot().rows[1].message).toBe(data.rows[1].message)
    expect(controller.getSnapshot().rows[1].message.generating).toBe(false)
  })

  it.each([20, 50])(
    'opens one %i-message tail page and waits for layout before first-window readiness',
    async (pageSize) => {
      const data = fixture()
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize,
        source: { readTranscriptWindow: data.read },
      })
      expect(controller.getSnapshot().firstWindowReady).toBe(false)
      await controller.open()
      expect(data.read).toHaveBeenCalledTimes(1)
      expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(
        data.rows.slice(-pageSize).map((row) => row.messageId)
      )
      expect(controller.getSnapshot().firstWindowReady).toBe(false)
      expect(controller.getSnapshot().operation?.phase).toBe('layout')
      acknowledge(controller)
      expect(controller.getSnapshot().firstWindowReady).toBe(true)
    }
  )

  it.each([20, 50])(
    'retains every %i-message page while browsing in both directions across threads',
    async (pageSize) => {
      const data = fixture([400, 400, 400])
      let anchor: SessionTranscriptViewportAnchor | null = null
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize,
        source: { readTranscriptWindow: data.read },
        captureAnchor: () => anchor,
      })
      await controller.openSearch('T2-200')
      acknowledge(controller)
      const initialStart = data.rows.findIndex((row) => row.messageId === controller.getSnapshot().rows[0].messageId)
      const epoch = controller.getSnapshot().windowEpoch
      for (const direction of ['older', 'newer'] as const) {
        for (let index = 0; index < 7; index++) {
          const before = controller.getSnapshot()
          const row = direction === 'older' ? before.rows[0] : before.rows.at(-1)!
          anchor = { threadId: row.threadId, messageId: row.messageId, offset: -17, blockId: 'paragraph-2' }
          expect(await (direction === 'older' ? controller.loadOlder(index) : controller.loadNewer(index))).toBe(true)
          const after = controller.getSnapshot()
          expect(after.pages.length).toBe(before.pages.length + 1)
          expect(after.layout?.anchor).toEqual(anchor)
          expect(after.layout?.rebase).toBeUndefined()
          expect(after.windowEpoch).toBe(epoch)
          expect(direction === 'older' ? after.rows.slice(pageSize) : after.rows.slice(0, -pageSize)).toEqual(
            before.rows
          )
          acknowledge(controller)
        }
      }
      expect(controller.getSnapshot().pages).toHaveLength(15)
      expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(
        data.rows.slice(initialStart - pageSize * 7, initialStart + pageSize * 8).map((row) => row.messageId)
      )
    }
  )

  it.each([20, 50])('opens a centered %i-message page across a thread boundary', async (pageSize) => {
    const data = fixture()
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open({ messageId: 'T2-91' })
    const state = controller.getSnapshot()
    expect(data.read).toHaveBeenCalledTimes(1)
    expect(state.rows[0].messageId).toBe(`T2-${91 - Math.floor((pageSize - 1) / 2)}`)
    expect(state.rows.at(-1)?.messageId).toBe(`T3-${pageSize / 2 - 9}`)
    expect(state.threads.map((thread) => thread.threadId)).toEqual(['T2', 'T3'])
    expect(state.layout?.kind).toBe('anchor')
    expect(state.layout?.anchor.messageId).toBe('T2-91')
  })

  it.each([
    [1, 1, 20],
    [500, 491, 510],
    [2000, 1981, 2000],
  ])('opens search result %i within messages %i–%i and locates the target', async (target, first, last) => {
    const data = fixture([2000])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.openSearch(`T1-${target}`)
    expect(data.read).toHaveBeenCalledWith(
      expect.objectContaining({ origin: { messageId: `T1-${target}`, align: 'center' } })
    )
    expect(controller.getSnapshot().rows).toHaveLength(20)
    expect(controller.getSnapshot().rows[0].messageId).toBe(`T1-${first}`)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe(`T1-${last}`)
    expect(controller.getSnapshot().layout).toMatchObject({ kind: 'anchor', anchor: { messageId: `T1-${target}` } })
  })

  it('replaces all loaded pages with the final page when tail navigation is forced', async () => {
    const data = fixture([100])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    await controller.loadOlder()
    acknowledge(controller)
    await controller.loadOlder()
    acknowledge(controller)
    expect(controller.getSnapshot().pages).toHaveLength(3)
    expect(controller.getSnapshot().hasNewer).toBe(false)
    const pages = controller.getSnapshot().pages
    const returning = controller.navigate('tail', undefined, { forceRead: true })
    expect(controller.getSnapshot().pages).toBe(pages)
    expect(controller.getSnapshot().operation?.kind).toBe('navigate')
    expect(await returning).toBe(true)
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().rows).toHaveLength(20)
    expect(controller.getSnapshot().rows[0].messageId).toBe('T1-81')
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T1-100')
    expect(controller.getSnapshot().layout?.kind).toBe('tail')
    expect(data.read).toHaveBeenCalledTimes(4)
  })

  it('reuses loaded true edges and replaces the complete page chain for unloaded edges', async () => {
    const data = fixture()
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    await controller.loadOlder()
    acknowledge(controller)
    const pages = controller.getSnapshot().pages
    await controller.navigate('tail')
    expect(controller.getSnapshot().pages).toBe(pages)
    expect(data.read).toHaveBeenCalledTimes(2)
    acknowledge(controller)
    await controller.navigate('head')
    expect(data.read).toHaveBeenCalledTimes(3)
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().rows[0].messageId).toBe('T1-1')
    acknowledge(controller)
    await controller.navigate('head')
    expect(data.read).toHaveBeenCalledTimes(3)
  })

  it('views a thread at its first message and displays a committed switch at its last message', async () => {
    const data = fixture()
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    await controller.viewThread('T2')
    expect(controller.getSnapshot().layout?.anchor.messageId).toBe('T2-1')
    expect(controller.getSnapshot().layout?.kind).toBe('anchor')
    expect(controller.getSnapshot().rows[0].messageId).toBe('T1-92')
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T2-11')
    expect(data.record.activeThreadId).toBe('T3')
    acknowledge(controller)
    const previousPages = controller.getSnapshot().pages
    await controller.viewThread('T2')
    expect(controller.getSnapshot().pages).toBe(previousPages)
    expect(data.read).toHaveBeenCalledTimes(2)
    acknowledge(controller)
    data.record.activeThreadId = 'T2'
    data.setRevision(2)
    const commit: SessionRowCommit = { record: data.record, revision: 2 }
    await controller.showSwitchedThread(commit)
    expect(data.read).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin: { threadId: 'T2', edge: 'tail' }, expectedRevision: 2 })
    )
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T2-100')
    expect(controller.getSnapshot().layout?.kind).toBe('tail')
    expect(controller.getSnapshot().revision).toBe(2)
  })

  it('preserves an empty thread anchor without substituting a neighboring message', async () => {
    const data = fixture([20, 0])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open({ threadId: 'T2', edge: 'head' })
    expect(controller.getSnapshot().rows).toEqual([])
    expect(controller.getSnapshot().layout?.anchor).toEqual({ threadId: 'T2', messageId: null })
    acknowledge(controller)
    await controller.viewThread('T2')
    expect(data.read).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])(
    'cancels only the current layout while preserving first-ready=%s and row identities',
    async (ready) => {
      const data = fixture()
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize: 20,
        source: { readTranscriptWindow: data.read },
      })
      await controller.open()
      if (ready) {
        acknowledge(controller)
        await controller.loadOlder()
      }
      const before = controller.getSnapshot()
      const requestId = before.layout!.requestId
      expect(controller.cancelLayout(requestId - 1)).toBe(false)
      expect(controller.getSnapshot()).toBe(before)
      expect(controller.cancelLayout(requestId)).toBe(true)
      const cancelled = controller.getSnapshot()
      expect(cancelled.rows).toBe(before.rows)
      expect(cancelled.pages).toBe(before.pages)
      expect(cancelled.firstWindowReady).toBe(ready)
      expect(cancelled.layout).toBeNull()
      expect(cancelled.operation).toBeNull()
      expect(controller.acknowledgeLayout(requestId)).toBe(false)
      controller.rejectLayout(requestId, new Error('late measurement'))
      expect(controller.getSnapshot()).toBe(cancelled)
      expect(await controller.retry()).toBe(false)
    }
  )

  it('ignores late reads and obsolete layout acknowledgements after a newer navigation', async () => {
    const data = fixture()
    const old = deferred<SessionTranscriptPage>()
    const oldPage = await data.read({ sessionId: 's', limit: 20, origin: 'tail' })
    const source = { readTranscriptWindow: vi.fn<SessionTranscriptWindowSource['readTranscriptWindow']>() }
    source.readTranscriptWindow.mockReturnValueOnce(old.promise).mockImplementation(data.read)
    const controller = new SessionTranscriptWindowController({ sessionId: 's', pageSize: 20, source })
    const opening = controller.open()
    await controller.navigate({ messageId: 'T1-30' })
    const layout = controller.getSnapshot().layout!
    expect(controller.acknowledgeLayout(layout.requestId - 1)).toBe(false)
    expect(controller.getSnapshot().firstWindowReady).toBe(false)
    old.resolve(oldPage)
    expect(await opening).toBe(false)
    expect(controller.getSnapshot().rows[0].messageId).toBe('T1-21')
    expect(controller.getSnapshot().layout).toBe(layout)
    acknowledge(controller)
  })

  it('releases pages and rejects late reads on close, then supports a fresh mount', async () => {
    const data = fixture()
    const pending = deferred<SessionTranscriptPage>()
    const page = await data.read({ sessionId: 's', limit: 20 })
    const source = {
      readTranscriptWindow: vi
        .fn<SessionTranscriptWindowSource['readTranscriptWindow']>()
        .mockReturnValueOnce(pending.promise)
        .mockImplementation(data.read),
    }
    const controller = new SessionTranscriptWindowController({ sessionId: 's', pageSize: 20, source })
    const request = controller.open()
    controller.close()
    pending.resolve(page)
    expect(await request).toBe(false)
    expect(controller.getSnapshot().pages).toEqual([])
    expect(controller.getSnapshot().firstWindowReady).toBe(false)
    await controller.open()
    expect(controller.getSnapshot().pages).toHaveLength(1)
  })

  it('requires new browsing progress after a page and prevents concurrent edge loading', async () => {
    const data = fixture()
    const pending = deferred<SessionTranscriptPage>()
    const source = { readTranscriptWindow: vi.fn(data.read) }
    const controller = new SessionTranscriptWindowController({ sessionId: 's', pageSize: 20, source })
    await controller.open()
    acknowledge(controller)
    const next = await data.read({ sessionId: 's', limit: 20, cursor: controller.getSnapshot().pages[0].older! })
    source.readTranscriptWindow.mockReturnValueOnce(pending.promise)
    const first = controller.loadOlder(1)
    expect(await controller.loadOlder(1)).toBe(false)
    expect(await controller.loadNewer(1)).toBe(false)
    pending.resolve(next)
    await first
    expect(await controller.loadOlder(2)).toBe(false)
    acknowledge(controller)
    expect(await controller.loadOlder(1)).toBe(false)
    expect(await controller.loadOlder(2)).toBe(true)
  })

  it('recovers a stale continuation at the visible anchor in the latest revision and can continue paging', async () => {
    const data = fixture()
    const anchor = { threadId: 'T3', messageId: 'T3-85', offset: -8, blockId: 'paragraph' }
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
      captureAnchor: () => anchor,
    })
    await controller.open()
    acknowledge(controller)
    const pages = controller.getSnapshot().pages
    data.setRevision(2)
    expect(await controller.loadOlder()).toBe(false)
    expect(controller.getSnapshot().pages).toBe(pages)
    expect(controller.getSnapshot().operation?.error).toBeInstanceOf(SessionRowConflictError)
    expect(await controller.retry()).toBe(true)
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().revision).toBe(2)
    expect(controller.getSnapshot().rows[0].messageId).toBe('T3-85')
    expect(controller.getSnapshot().layout).toMatchObject({ kind: 'preserve', anchor })
    expect(data.read).toHaveBeenLastCalledWith(expect.objectContaining({ origin: { messageId: 'T3-85' } }))
    expect(data.read.mock.lastCall?.[0].expectedRevision).toBeUndefined()
    acknowledge(controller)
    expect(await controller.loadOlder()).toBe(true)
    expect(controller.getSnapshot().pages).toHaveLength(2)
    expect(controller.getSnapshot().pages.every((page) => page.revision === 2)).toBe(true)
  })

  it('searches an already loaded message with one centered replacement page and target layout', async () => {
    const data = fixture()
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    await controller.loadOlder()
    acknowledge(controller)
    expect(controller.getSnapshot().rows.some((row) => row.messageId === 'T3-70')).toBe(true)
    expect(await controller.openSearch('T3-70')).toBe(true)
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().rows[0].messageId).toBe('T3-61')
    expect(controller.getSnapshot().layout).toMatchObject({ kind: 'anchor', anchor: { messageId: 'T3-70' } })
    expect(data.read).toHaveBeenCalledTimes(3)
  })

  it('rejects pages with a different page-size cursor', async () => {
    const data = fixture()
    const source = {
      readTranscriptWindow: async (request: SessionTranscriptRequest) => {
        const result = await data.read(request)
        return { ...result, older: result.older ? { ...result.older, limit: 50 } : null }
      },
    }
    const controller = new SessionTranscriptWindowController({ sessionId: 's', pageSize: 20, source })
    expect(await controller.open()).toBe(false)
    expect(controller.getSnapshot().pages).toEqual([])
    expect(controller.getSnapshot().operation?.error?.message).toMatch(/cursor/)
  })

  it.each(['maxBytes', 'scope'] as const)('rejects a cursor with another %s identity', async (field) => {
    const data = fixture()
    const source = {
      readTranscriptWindow: async (request: SessionTranscriptRequest) => {
        const result = await data.read(request)
        return {
          ...result,
          older: result.older
            ? {
                ...result.older,
                ...(field === 'maxBytes'
                  ? { maxBytes: 100 }
                  : { scope: 'invalid' as SessionTranscriptCursor['scope'] }),
              }
            : null,
        }
      },
    }
    const controller = new SessionTranscriptWindowController({ sessionId: 's', pageSize: 20, source })
    expect(await controller.open()).toBe(false)
    expect(controller.getSnapshot().pages).toEqual([])
    expect(controller.getSnapshot().operation?.error?.message).toMatch(/cursor/)
  })

  it('accepts a byte-limited short page and keeps a single oversized message loadable', async () => {
    const data = fixture([1])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      maxBytes: 50,
      source: { readTranscriptWindow: data.read },
    })
    expect(await controller.open()).toBe(true)
    expect(controller.getSnapshot().rows).toHaveLength(1)
    expect(controller.getSnapshot().pages[0].payloadBytes).toBe(100)
    expect(controller.getSnapshot().maxBytes).toBe(50)
    expect(data.read).toHaveBeenLastCalledWith(expect.objectContaining({ maxBytes: 50 }))
  })

  it('does not accept multiple messages over the byte budget', async () => {
    const data = fixture([2])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      maxBytes: 150,
      source: { readTranscriptWindow: data.read },
    })
    expect(await controller.open()).toBe(false)
    expect(controller.getSnapshot().operation?.error?.message).toMatch(/byte budget/)
  })

  it('keeps the mounted window available when a committed thread switch read fails', async () => {
    const data = fixture()
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    data.setRevision(2)
    data.read.mockRejectedValueOnce(new Error('read failed'))
    const commit = { record: { ...data.record, activeThreadId: 'T2' }, revision: 2 }
    expect(await controller.showSwitchedThread(commit)).toBe(false)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T3-100')
    expect(controller.getSnapshot().pages.length).toBeGreaterThan(0)
    expect(controller.getSnapshot().revision).toBe(2)
    expect(await controller.retry()).toBe(true)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T2-100')
  })

  it('retries a committed thread switch at its target tail when storage has advanced again', async () => {
    const data = fixture()
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    data.setRevision(3)
    expect(await controller.showSwitchedThread({ record: { ...data.record, activeThreadId: 'T2' }, revision: 2 })).toBe(
      false
    )
    expect(await controller.retry()).toBe(true)
    expect(controller.getSnapshot().revision).toBe(3)
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T2-100')
    expect(controller.getSnapshot().layout?.kind).toBe('tail')
  })

  it.each(['older', 'newer'] as const)(
    'retains loaded pages and the visible point when a metadata commit restarts %s',
    async (direction) => {
      const data = fixture([200])
      const anchor = { threadId: 'T1', messageId: 'T1-90', blockId: 'paragraph:0', offset: -12 }
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize: 20,
        source: { readTranscriptWindow: data.read },
        captureAnchor: () => anchor,
      })
      await controller.open({ messageId: 'T1-89' })
      acknowledge(controller)
      await controller.loadNewer(1)
      acknowledge(controller)
      const retained = controller.getSnapshot().rows
      const epoch = controller.getSnapshot().windowEpoch
      const oldPage = await data.read({
        sessionId: 's',
        limit: 20,
        cursor:
          direction === 'older' ? controller.getSnapshot().pages[0].older! : controller.getSnapshot().pages[1].newer!,
      })
      const obsolete = deferred<SessionTranscriptPage>()
      data.read.mockImplementationOnce(() => obsolete.promise)
      const original = direction === 'older' ? controller.loadOlder(2) : controller.loadNewer(2)
      data.setRevision(2)
      data.record.name = 'Renamed'
      const commit = { record: data.record, revision: 2 }
      const updated = {
        ...retained[0],
        message: { ...retained[0].message, contentParts: [{ type: 'text' as const, text: 'checkpoint' }] },
      }
      expect(controller.applyRows(commit, 1, [updated], [], false)).toBe(false)
      expect(controller.getSnapshot().rows).toHaveLength(40)
      const calls = data.read.mock.calls.length
      expect(await controller.refresh([], [], commit)).toBe(true)
      const state = controller.getSnapshot()
      expect(state.pages).toHaveLength(3)
      expect(state.rows.map((row) => row.messageId)).toEqual(
        Array.from({ length: 60 }, (_, i) => `T1-${(direction === 'older' ? 60 : 80) + i}`)
      )
      expect(state.windowEpoch).toBe(epoch)
      expect(state.layout).toMatchObject({ kind: 'preserve', anchor })
      expect(state.rows.find((row) => row.messageId === updated.messageId)?.message).toBe(updated.message)
      expect(state.pages.every((page) => page.revision === 2 && page.record.name === 'Renamed')).toBe(true)
      expect(
        state.pages.flatMap((page) => [page.older, page.newer]).every((cursor) => !cursor || cursor.revision === 2)
      ).toBe(true)
      expect(data.read).toHaveBeenCalledTimes(calls + 1)
      expect(data.read.mock.lastCall?.[0]).toMatchObject({
        expectedRevision: 2,
        cursor: { revision: 2, direction: direction === 'older' ? 'before' : 'after' },
      })
      obsolete.resolve(oldPage)
      expect(await original).toBe(false)
      acknowledge(controller)
      expect(await (direction === 'older' ? controller.loadOlder(2) : controller.loadNewer(2))).toBe(false)
      expect(data.read).toHaveBeenCalledTimes(calls + 1)
    }
  )

  it.each(['navigate', 'close', 'branch'] as const)('cancels a metadata-resumed page on %s', async (nextIntent) => {
    const data = fixture([200])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open({ messageId: 'T1-89' })
    acknowledge(controller)
    const obsolete = deferred<SessionTranscriptPage>()
    data.read.mockImplementationOnce(() => obsolete.promise)
    const original = controller.loadOlder(1)
    data.setRevision(2)
    const commit = { record: data.record, revision: 2 }
    expect(controller.applyRows(commit, 1, [], [], false)).toBe(false)
    const resumedPage = await data.read({ sessionId: 's', limit: 20, cursor: controller.getSnapshot().pages[0].older! })
    const resumed = deferred<SessionTranscriptPage>()
    data.read.mockImplementationOnce(() => resumed.promise)
    const recovery = controller.refresh([], [], commit)
    if (nextIntent === 'close') controller.close()
    else if (nextIntent === 'navigate') await controller.openSearch('T1-140')
    else {
      data.setRevision(3)
      await controller.applyBranchCommit({
        record: data.record,
        revision: 3,
        previousRevision: 2,
        sharedPrefixEnd: { threadId: 'T1', messageId: 'T1-89' },
        origin: { messageId: 'T1-140' },
      })
    }
    const current = controller.getSnapshot()
    resumed.resolve(resumedPage)
    obsolete.resolve(resumedPage)
    expect(await recovery).toBe(false)
    expect(await original).toBe(false)
    expect(controller.getSnapshot()).toBe(current)
    expect(current.rows.map((row) => row.messageId)).toEqual(
      nextIntent === 'close'
        ? []
        : [
            ...(nextIntent === 'branch' ? Array.from({ length: 10 }, (_, i) => `T1-${80 + i}`) : []),
            ...Array.from({ length: 20 }, (_, i) => `T1-${(nextIntent === 'branch' ? 140 : 131) + i}`),
          ]
    )
  })

  it('replays a pending search after a header commit instead of abandoning it on the old page', async () => {
    const data = fixture([200])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const page = await data.read({ sessionId: 's', limit: 20, origin: { messageId: 'T1-20' } })
    const delayed = deferred<SessionTranscriptPage>()
    data.read.mockImplementationOnce(() => delayed.promise)
    const searching = controller.openSearch('T1-20')
    data.setRevision(2)
    const commit = { record: data.record, revision: 2 }
    expect(controller.applyRows(commit, 1, [], [], false)).toBe(false)
    expect(controller.getSnapshot().operation?.phase).toBe('reading')
    await controller.refresh([], [], commit)
    expect(controller.getSnapshot().rows[0].messageId).toBe('T1-11')
    expect(controller.getSnapshot().layout).toMatchObject({ kind: 'anchor', anchor: { messageId: 'T1-20' } })
    delayed.resolve(page)
    expect(await searching).toBe(false)
    expect(controller.getSnapshot().revision).toBe(2)
  })

  it.each(['origin', 'cursor'] as const)(
    'retains five prefix pages when a content commit restarts an in-flight branch %s read',
    async (mode) => {
      const data = fixture([200])
      const anchor = { threadId: 'T1', messageId: 'T1-20', offset: -4 }
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize: 20,
        source: { readTranscriptWindow: data.read },
        captureAnchor: () => anchor,
      })
      await controller.open('head')
      acknowledge(controller)
      for (let i = 0; i < 4; i++) {
        await controller.loadNewer()
        acknowledge(controller)
      }
      const prefix = controller.getSnapshot().rows
      data.setRevision(2)
      const continuation =
        mode === 'origin'
          ? { origin: { messageId: 'T1-101' } }
          : { cursor: { ...controller.getSnapshot().pages.at(-1)!.newer!, revision: 2 } }
      const oldPage = await data.read({ sessionId: 's', limit: 20, ...continuation, expectedRevision: 2 })
      const delayed = deferred<SessionTranscriptPage>()
      data.read.mockImplementationOnce(() => delayed.promise)
      const branching = controller.applyBranchCommit({
        record: data.record,
        revision: 2,
        previousRevision: 1,
        sharedPrefixEnd: { threadId: 'T1', messageId: 'T1-100' },
        ...continuation,
      })
      const branchOperationId = controller.getSnapshot().operation?.branchOperationId
      const initialRequestId = controller.getSnapshot().operation?.requestId
      expect(branchOperationId).toBe(initialRequestId)
      const updated = {
        ...data.rows[79],
        message: { ...data.rows[79].message, contentParts: [{ type: 'text' as const, text: 'checkpoint' }] },
      }
      data.rows[79] = updated
      data.setRevision(3)
      const commit = { record: data.record, revision: 3 }
      expect(controller.applyRows(commit, 2, [updated], [], false)).toBe(false)
      expect(controller.getSnapshot().pages).toHaveLength(5)
      await controller.refresh([], [], commit)
      const state = controller.getSnapshot()
      expect(state.operation).toMatchObject({ kind: 'branch', branchOperationId })
      expect(state.operation?.requestId).not.toBe(initialRequestId)
      expect(state.pages).toHaveLength(6)
      expect(state.rows.slice(0, 100).map((row) => row.messageId)).toEqual(prefix.map((row) => row.messageId))
      expect(state.rows[0].message).toBe(prefix[0].message)
      expect(state.rows[79].message).toBe(updated.message)
      expect(state.pages.every((page) => page.revision === 3)).toBe(true)
      expect(state.layout).toMatchObject({ kind: 'preserve', anchor })
      expect(data.read.mock.lastCall?.[0].expectedRevision).toBe(3)
      if (mode === 'cursor') expect(data.read.mock.lastCall?.[0].cursor?.revision).toBe(3)
      delayed.resolve(oldPage)
      expect(await branching).toBe(false)
      expect(controller.getSnapshot().pages).toBe(state.pages)
      data.setRevision(5)
      const afterGap = { record: data.record, revision: 5 }
      expect(controller.applyRows(afterGap, 4, [], [], false)).toBe(false)
      await controller.refresh([], [], afterGap)
      expect(controller.getSnapshot().pages).toHaveLength(1)
      expect(controller.getSnapshot().revision).toBe(5)
      expect(controller.getSnapshot().operation).toMatchObject({ kind: 'branch', branchOperationId })
      await controller.navigate('head')
      expect(controller.getSnapshot().operation?.kind).toBe('navigate')
      expect(controller.getSnapshot().operation?.branchOperationId).toBeUndefined()
    }
  )

  it.each(['reading', 'refreshed', 'layout', 'superseded'] as const)(
    'cancels only the owned tail navigation after a newer reading intent (%s)',
    async (phase) => {
      const data = fixture([40])
      const controller = new SessionTranscriptWindowController({
        sessionId: 's',
        pageSize: 20,
        source: { readTranscriptWindow: data.read },
      })
      await controller.open()
      acknowledge(controller)
      const mounted = controller.getSnapshot()
      const tail = await data.read({ sessionId: 's', limit: 20, origin: 'tail' })
      const delayed = deferred<SessionTranscriptPage>()
      const refreshed = deferred<SessionTranscriptPage>()
      data.read.mockImplementationOnce(() => delayed.promise)
      const owner = {}
      const navigating = controller.navigate('tail', undefined, { forceRead: true, owner })
      expect(controller.cancelNavigation({})).toBe(false)
      let refreshing: Promise<boolean> | undefined
      if (phase === 'refreshed') {
        data.read.mockImplementationOnce(() => refreshed.promise)
        refreshing = controller.refresh()
      } else if (phase === 'layout') {
        delayed.resolve(tail)
        expect(await navigating).toBe(true)
        expect(controller.getSnapshot().layout?.kind).toBe('tail')
      } else if (phase === 'superseded') {
        await controller.navigate('head')
      }
      const beforeCancel = controller.getSnapshot()
      expect(controller.cancelNavigation(owner)).toBe(phase !== 'superseded')
      const cancelled = controller.getSnapshot()
      expect(cancelled.pages).toBe(beforeCancel.pages)
      expect(cancelled.firstWindowReady).toBe(mounted.firstWindowReady)
      if (phase !== 'superseded') {
        expect(cancelled.layout).toBeNull()
        expect(cancelled.operation).toBeNull()
      } else expect(cancelled).toBe(beforeCancel)
      delayed.resolve(tail)
      refreshed.resolve(tail)
      expect(await navigating).toBe(phase === 'layout')
      if (refreshing) expect(await refreshing).toBe(false)
      expect(controller.getSnapshot()).toBe(cancelled)
      expect(controller.cancelNavigation(owner)).toBe(false)
    }
  )

  it('reads the committed tail over an in-flight append refresh without resetting readiness', async () => {
    const data = fixture([2])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
      captureAnchor: () => ({ threadId: 'T1', messageId: 'T1-2', offset: -200 }),
    })
    await controller.open()
    acknowledge(controller)
    controller.updateMessage('T1-2', { contentParts: [{ type: 'text', text: 'Streamed answer' }] })
    await controller.navigate('tail')
    acknowledge(controller)
    const appended = [message('T1', 3), message('T1', 4)]
    data.rows.push(...appended)
    data.threads[0].activeLeafMessageId = 'T1-4'
    data.setRevision(2)
    const commit = { record: data.record, revision: 2 }
    expect(controller.applyRows(commit, 1, appended, ['T1-3', 'T1-4'], false)).toBe(false)
    const preservedPage = await data.read({ sessionId: 's', limit: 20, origin: { messageId: 'T1-2' } })
    const delayed = deferred<SessionTranscriptPage>()
    data.read.mockImplementationOnce(() => delayed.promise)
    const refreshing = controller.refresh([], [], commit)
    const previousPages = controller.getSnapshot().pages
    const navigating = controller.navigate('tail', undefined, { forceRead: true })
    expect(controller.getSnapshot().firstWindowReady).toBe(true)
    expect(controller.getSnapshot().pages).toBe(previousPages)
    expect(await navigating).toBe(true)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T1-4')
    expect(controller.getSnapshot().layout?.kind).toBe('tail')
    expect(controller.getSnapshot().firstWindowReady).toBe(true)
    const tail = controller.getSnapshot()
    delayed.resolve(preservedPage)
    expect(await refreshing).toBe(false)
    expect(controller.getSnapshot()).toBe(tail)
    expect(data.read.mock.lastCall?.[0].origin).toBe('tail')
    expect(data.read.mock.lastCall?.[0].limit).toBe(20)
  })

  it('preserves a replacement branch through content refresh and cancels it on unrelated navigation', async () => {
    const data = fixture([200])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    data.setRevision(2)
    const oldPage = await data.read({ sessionId: 's', limit: 20, origin: { messageId: 'T1-20' } })
    const delayed = deferred<SessionTranscriptPage>()
    data.read.mockImplementationOnce(() => delayed.promise)
    const branching = controller.navigateBranch({ messageId: 'T1-20' }, 2)
    const initialOperation = controller.getSnapshot().operation!
    expect(initialOperation).toMatchObject({ kind: 'branch', branchOperationId: initialOperation.requestId })
    data.setRevision(3)
    const commit = { record: data.record, revision: 3 }
    expect(controller.applyRows(commit, 1, [], [], false)).toBe(false)
    await controller.refresh([], [], commit)
    const state = controller.getSnapshot()
    expect(state.rows[0].messageId).toBe('T1-20')
    expect(state.layout?.kind).toBe('head')
    expect(state.operation).toMatchObject({ kind: 'branch', branchOperationId: initialOperation.branchOperationId })
    expect(state.operation?.requestId).not.toBe(initialOperation.requestId)
    delayed.resolve(oldPage)
    expect(await branching).toBe(false)
    const requestId = state.layout!.requestId
    controller.rejectLayout(requestId, new Error('layout not ready'))
    expect(await controller.retry()).toBe(true)
    expect(controller.getSnapshot().operation).toMatchObject({
      kind: 'branch',
      branchOperationId: initialOperation.branchOperationId,
    })
    await controller.navigate('tail')
    expect(controller.getSnapshot().operation?.kind).toBe('navigate')
    expect(controller.getSnapshot().operation?.branchOperationId).toBeUndefined()
    await controller.navigateBranch({ messageId: 'T1-80' }, 3)
    expect(controller.getSnapshot().operation?.branchOperationId).not.toBe(initialOperation.branchOperationId)
  })

  it('rebuilds the visible prefix in the latest revision when a branch continuation conflicts', async () => {
    const data = fixture()
    const anchor = { threadId: 'T2', messageId: 'T2-85', offset: -12 }
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
      captureAnchor: () => anchor,
    })
    await controller.open({ messageId: 'T2-90' })
    acknowledge(controller)
    data.setRevision(3)
    expect(
      await controller.applyBranchCommit({
        record: data.record,
        revision: 2,
        previousRevision: 1,
        sharedPrefixEnd: { threadId: 'T2', messageId: 'T2-90' },
        origin: { messageId: 'T2-91' },
      })
    ).toBe(false)
    expect(controller.getSnapshot().rows).toHaveLength(20)
    const branchOperationId = controller.getSnapshot().operation?.branchOperationId
    expect(branchOperationId).toBeDefined()
    expect(await controller.retry()).toBe(true)
    expect(controller.getSnapshot().operation).toMatchObject({ kind: 'branch', branchOperationId })
    expect(controller.getSnapshot().revision).toBe(3)
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().rows[0].messageId).toBe('T2-85')
    expect(controller.getSnapshot().layout).toMatchObject({ kind: 'preserve', anchor })
    acknowledge(controller)
    expect(await controller.loadNewer()).toBe(true)
  })

  it('retains all loaded branch prefixes and subsequent pages', async () => {
    const data = fixture([200, 200, 200])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open({ messageId: 'T1-190' })
    acknowledge(controller)
    for (let index = 0; index < 4; index++) {
      await controller.loadNewer()
      acknowledge(controller)
    }
    const prefix = controller.getSnapshot().rows
    expect(prefix).toHaveLength(100)
    data.setRevision(2)
    expect(
      await controller.applyBranchCommit({
        record: data.record,
        revision: 2,
        previousRevision: 1,
        sharedPrefixEnd: { threadId: 'T2', messageId: 'T2-80' },
        origin: { messageId: 'T2-81' },
      })
    ).toBe(true)
    const state = controller.getSnapshot()
    expect(state.pages).toHaveLength(6)
    expect(state.rows.slice(0, 100)).toEqual(prefix)
    expect(state.pages.every((page) => page.revision === 2)).toBe(true)
    expect(state.rows[0].threadId).toBe('T1')
    acknowledge(controller)
    await controller.loadNewer()
    expect(controller.getSnapshot().pages).toHaveLength(7)
    expect(controller.getSnapshot().rows).toHaveLength(140)
    expect(controller.getSnapshot().rows.slice(0, 100)).toEqual(prefix)
  })

  it.each([20, 50])('retains the branch prefix and all repeated appends at page size %i', async (pageSize) => {
    const data = fixture([pageSize * 6])
    const visibleAnchor = { threadId: 'T1', messageId: `T1-${pageSize * 5 + 1}`, offset: -9 }
    let anchor: typeof visibleAnchor | null = null
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize,
      source: { readTranscriptWindow: data.read },
      captureAnchor: () => anchor,
    })
    await controller.open('head')
    acknowledge(controller)
    for (let index = 0; index < 4; index++) {
      await controller.loadNewer()
      acknowledge(controller)
    }
    data.setRevision(2)
    expect(
      await controller.applyBranchCommit({
        record: data.record,
        revision: 2,
        previousRevision: 1,
        sharedPrefixEnd: { threadId: 'T1', messageId: `T1-${pageSize * 5}` },
        origin: { messageId: `T1-${pageSize * 5 + 1}` },
      })
    ).toBe(true)
    acknowledge(controller)
    anchor = visibleAnchor
    const retained = controller.getSnapshot().rows
    expect(retained).toHaveLength(pageSize * 6)
    expect(controller.getSnapshot().hasNewer).toBe(false)
    for (let index = 1; index <= pageSize * 2; index++) {
      const row = message('T1', pageSize * 6 + index)
      data.rows.push(row)
      data.threads[0].activeLeafMessageId = row.messageId
      data.setRevision(2 + index)
      expect(
        controller.applyRows({ record: data.record, revision: 2 + index }, 1 + index, [row], [row.messageId], false)
      ).toBe(true)
      expect(controller.getSnapshot().pages).toHaveLength(6 + Math.ceil(index / pageSize))
      expect(controller.getSnapshot().rows.slice(0, retained.length)).toEqual(retained)
      expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe(row.messageId)
      expect(controller.getSnapshot().hasNewer).toBe(false)
    }
    expect(data.read).toHaveBeenCalledTimes(6)
    expect(controller.getSnapshot().pages.at(-1)?.newer).toBeNull()
    expect(await controller.loadNewer()).toBe(false)
    expect(controller.getSnapshot().pages).toHaveLength(8)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe(`T1-${pageSize * 8}`)
  })

  it('keeps branch content mounted after a failed read and replaces the suffix on retry', async () => {
    const data = fixture()
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open({ messageId: 'T2-90' })
    acknowledge(controller)
    data.setRevision(2)
    data.read.mockRejectedValueOnce(new Error('read failed'))
    expect(
      await controller.applyBranchCommit({
        record: data.record,
        revision: 2,
        previousRevision: 1,
        sharedPrefixEnd: { threadId: 'T2', messageId: 'T2-90' },
        origin: { messageId: 'T2-91' },
      })
    ).toBe(false)
    expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(
      Array.from({ length: 20 }, (_, index) => `T2-${index + 81}`)
    )
    expect(controller.getSnapshot().revision).toBe(2)
    expect(controller.getSnapshot().pages[0].payloadBytes).toBe(2000)
    expect(controller.getSnapshot().operation?.phase).toBe('error')
    expect(await controller.retry()).toBe(true)
    expect(controller.getSnapshot().rows).toHaveLength(30)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T3-10')
  })

  it('retains earlier threads when the selected thread branches at its root', async () => {
    const data = fixture()
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open({ messageId: 'T1-100' })
    acknowledge(controller)
    data.setRevision(2)
    await controller.applyBranchCommit({
      record: data.record,
      revision: 2,
      previousRevision: 1,
      sharedPrefixEnd: { threadId: 'T2', messageId: null },
      origin: { messageId: 'T2-1' },
    })
    expect(
      controller
        .getSnapshot()
        .rows.slice(0, 10)
        .map((row) => row.messageId)
    ).toEqual(Array.from({ length: 10 }, (_, index) => `T1-${index + 91}`))
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T2-20')
  })
  it('keeps root branch content mounted until its replacement has been read', async () => {
    const data = fixture([4])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open()
    acknowledge(controller)
    const before = controller.getSnapshot()
    data.setRevision(2)
    const replacement = await data.read({ sessionId: 's', origin: 'head', limit: 20 })
    const pending = deferred<SessionTranscriptPage>()
    data.read.mockImplementationOnce(() => pending.promise)
    const operation = controller.applyBranchCommit({
      record: data.record,
      revision: 2,
      previousRevision: 1,
      sharedPrefixEnd: { threadId: 'T1', messageId: null },
      origin: { messageId: 'T1-1' },
    })
    expect(controller.getSnapshot().rows).toEqual(before.rows)
    expect(controller.getSnapshot().pages.length).toBeGreaterThan(0)
    pending.resolve(replacement)
    expect(await operation).toBe(true)
    expect(controller.getSnapshot().windowEpoch).toBe(before.windowEpoch)
    expect(controller.getSnapshot().layout?.rebase).toBeUndefined()
  })

  it('interrupts a pending navigation read when the user starts reading', async () => {
    const data = fixture([100])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open('tail')
    acknowledge(controller)
    const mounted = controller.getSnapshot()
    const page = await data.read({ sessionId: 's', limit: 20, origin: 'head' })
    const pending = deferred<SessionTranscriptPage>()
    data.read.mockImplementationOnce(() => pending.promise)
    const navigation = controller.navigate('head')
    expect(controller.interruptNavigation()).toBe(true)
    const interrupted = controller.getSnapshot()
    expect(interrupted.pages).toBe(mounted.pages)
    expect(interrupted.firstWindowReady).toBe(true)
    pending.resolve(page)
    expect(await navigation).toBe(false)
    expect(controller.getSnapshot()).toBe(interrupted)
  })

  it('keeps a history page read alive when reading intent interrupts navigation', async () => {
    const data = fixture([100])
    const controller = new SessionTranscriptWindowController({
      sessionId: 's',
      pageSize: 20,
      source: { readTranscriptWindow: data.read },
    })
    await controller.open('tail')
    acknowledge(controller)
    const loading = controller.loadOlder()
    expect(controller.interruptNavigation()).toBe(false)
    expect(await loading).toBe(true)
  })
})
