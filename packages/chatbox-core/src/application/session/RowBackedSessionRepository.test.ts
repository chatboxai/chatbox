import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SessionRepositoryError, type SessionRepositoryPort, type StoredSessionRecord } from '../../ports'
import type { SessionRowSnapshot, SessionRows } from '../../ports/session-row-store'
import { createSessionRepositoryContract } from '../../ports/testing/session-repository-contract'
import { buildSwitchForkToPatch } from '../../session/message-forks'
import {
  normalizeSessionV1,
  type SessionRecordV2,
  type VerifySessionTreeRoundTripResult,
} from '../../session/session-tree'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import type { Message, Session } from '../../types/session'
import { migrateSession } from './compatibility/session-load'
import { applyMessageRemoval } from './message-tree'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'

const NOW = 1_000

/** Counts the encodes a write performs, so a fast path can be told from an empty diff. */
const encoding = vi.hoisted(() => ({ calls: 0 }))

vi.mock('../../session/session-tree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../session/session-tree')>()
  return {
    ...actual,
    verifySessionTreeRoundTrip: (
      ...args: Parameters<typeof actual.verifySessionTreeRoundTrip>
    ): VerifySessionTreeRoundTripResult => {
      encoding.calls += 1
      return actual.verifySessionTreeRoundTrip(...args)
    },
  }
})

function message(id: string, role: Message['role'], timestamp: number): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }], timestamp }
}

function summaryMessage(id: string, timestamp: number): Message {
  return { ...message(id, 'assistant', timestamp), isSummary: true }
}

/**
 * A session exercising every structure the codec has to carry: a fork on the
 * active path whose saved branch holds a message, an archived thread with its
 * own summary and compaction point, and a session-level field.
 */
function createRichSession(id = 'session-rich'): Session {
  return {
    id,
    type: 'chat',
    name: 'Rich session',
    threadName: 'Current thread',
    starred: true,
    settings: { temperature: 0.4 },
    messages: [message('user-1', 'user', 100), message('assistant-1', 'assistant', 200)],
    threads: [
      {
        id: 'history-1',
        name: 'Earlier thread',
        createdAt: 10,
        messages: [message('history-user', 'user', 11), summaryMessage('history-summary', 12)],
        compactionPoints: [{ summaryMessageId: 'history-summary', boundaryMessageId: 'history-user', createdAt: 12 }],
      },
    ],
    messageForksHash: {
      'user-1': {
        position: 0,
        createdAt: 150,
        lists: [
          { id: 'active-branch', messages: [] },
          { id: 'answer-branch', messages: [message('fork-answer', 'assistant', 410)] },
        ],
      },
    },
  }
}

function createPlainSession(id = 'session-plain'): Session {
  return {
    id,
    type: 'chat',
    name: 'Plain session',
    messages: [message('user-1', 'user', 100), message('assistant-1', 'assistant', 200)],
  }
}

function normalized(session: Session): Session {
  const result = normalizeSessionV1(migrateSession(session))
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return migrateSession(result.session)
}

interface Harness {
  records: InMemorySessionRecordStore
  rows: InMemorySessionRowStore
  repository: RowBackedSessionRepository
  migrationSkipped: ReturnType<typeof vi.fn>
}

async function createHarness(now: () => number = () => NOW): Promise<Harness> {
  const records = new InMemorySessionRecordStore()
  const rows = new InMemorySessionRowStore()
  const migrationSkipped = vi.fn()
  const repository = new RowBackedSessionRepository({
    records,
    rows,
    now,
    onMigrationSkipped: migrationSkipped,
  })
  await repository.initialize()
  return { records, rows, repository, migrationSkipped }
}

function storedRecord(harness: Harness, id: string): SessionRecordV2 {
  const record = harness.records.snapshot().find((candidate) => candidate.id === id)
  if (!record) {
    throw new Error(`no record for ${id}`)
  }
  return record as SessionRecordV2
}

function storedRows(harness: Harness, id: string): SessionRows {
  const snapshot = harness.rows.snapshot().find((candidate) => candidate.rows.sessionId === id)
  if (!snapshot) {
    throw new Error(`no rows for ${id}`)
  }
  return snapshot.rows
}

function committedRecord(harness: Harness, id: string): SessionRecordV2 {
  const snapshot = harness.rows.snapshot().find((candidate) => candidate.rows.sessionId === id)
  if (!snapshot) {
    throw new Error(`no committed record for ${id}`)
  }
  return snapshot.record
}

function rowSnapshot(rows: SessionRows, revision: number): SessionRowSnapshot {
  const activeThreadId = rows.threads.find((thread) => thread.seq === -1)?.threadId
  if (!activeThreadId) throw new Error(`no active thread for ${rows.sessionId}`)
  return {
    rows,
    revision,
    record: {
      id: rows.sessionId,
      type: 'chat',
      name: rows.sessionId,
      activeThreadId,
      storageFormat: 'rows',
    },
  }
}

describe('RowBackedSessionRepository', () => {
  test('persists a deleted fork pivot by reparenting every child and only deleting the selected row', async () => {
    const harness = await createHarness()
    const source = createRichSession()
    source.messages.unshift(message('parent', 'system', 50))
    await harness.repository.setSession(source)
    const apply = vi.spyOn(harness.rows, 'applyDiff')
    const updated = applyMessageRemoval(source, source.id, 'user-1', () => 'new-root')
    await harness.repository.setSession(updated)
    expect(apply.mock.calls[0][0].messages.delete).toEqual(['user-1'])
    const children = storedRows(harness, source.id).messages.filter((row) => row.parentMessageId === 'parent')
    expect(children.map((row) => row.messageId).sort()).toEqual(['assistant-1', 'fork-answer'])

    const reopened = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
    await reopened.initialize()
    const loaded = await reopened.getSession(source.id)
    expect(loaded).not.toBeNull()
    if (!loaded) throw new Error('missing session')
    expect(loaded.messages.map(({ id }) => id)).toEqual(['parent', 'assistant-1'])
    const switched = { ...loaded, ...buildSwitchForkToPatch(loaded, 'parent', 1) }
    await reopened.setSession(switched)
    expect((await reopened.getSession(source.id))?.messages.map(({ id }) => id)).toEqual(['parent', 'fork-answer'])
    expect((await reopened.getSession(source.id))?.threads).toEqual(normalized(source).threads)
  })

  test('removes a saved branch without renumbering the active or archived paths', async () => {
    const harness = await createHarness()
    const source = createRichSession()
    await harness.repository.setSession(source)
    const before = new Map(storedRows(harness, source.id).messages.map((row) => [row.messageId, row.seq]))
    const apply = vi.spyOn(harness.rows, 'applyDiff')
    await harness.repository.setSession({ ...source, messageForksHash: {} })
    const diff = apply.mock.calls[0][0]
    expect(diff.messages.delete).toEqual(['fork-answer'])
    for (const row of storedRows(harness, source.id).messages) expect(row.seq).toBe(before.get(row.messageId))
    expect((await harness.repository.getSession(source.id))?.threads).toEqual(normalized(source).threads)
  })

  test.each([0, 500, 999])('deletes message %i without rewriting the surviving suffix', async (index) => {
    const harness = await createHarness()
    const source: Session = {
      ...createPlainSession(),
      messages: Array.from({ length: 1000 }, (_, index) => message(`m${index}`, 'user', index + 1)),
    }
    await harness.repository.setSession(source)
    const apply = vi.spyOn(harness.rows, 'applyDiff')
    const next = { ...source, messages: source.messages.filter((_, at) => at !== index) }
    await harness.repository.setSession(next)
    const diff = apply.mock.calls[0][0]
    expect(diff.messages.delete).toEqual([`m${index}`])
    expect(diff.messages.upsert.length).toBeLessThanOrEqual(2)
    expect(diff.unchangedPayloadMessageIds?.length).toBe(diff.messages.upsert.length)
    expect(storedRows(harness, source.id).messages.map((row) => row.seq)).toEqual(
      next.messages.map((message) => Number(message.id.slice(1)))
    )

    const reopened = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
    await reopened.initialize()
    const loaded = await reopened.getSession(source.id)
    expect(loaded?.messages.map((message) => message.id)).toEqual(next.messages.map((message) => message.id))
    if (!loaded) throw new Error('missing session')
    apply.mockClear()
    await reopened.setSession({ ...loaded, messages: [...loaded.messages, message('appended', 'assistant', 2000)] })
    expect(apply.mock.calls[0][0].messages.upsert).toHaveLength(2)
    expect(storedRows(harness, source.id).messages.at(-1)?.seq).toBe(index === 999 ? 999 : 1000)
  })

  test('keeps a session created between startup record and row enumeration', async () => {
    const harness = await createHarness()
    const session = createPlainSession('created-during-startup')
    const listRows = harness.rows.listSessionIds.bind(harness.rows)
    vi.spyOn(harness.records, 'listIds').mockResolvedValueOnce([])
    vi.spyOn(harness.rows, 'listSessionIds').mockImplementationOnce(async () => {
      await harness.repository.setSession(session)
      return listRows()
    })
    const restarted = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows })

    await restarted.initialize()

    await expect(harness.rows.hasRows(session.id)).resolves.toBe(true)
    await expect(restarted.getSession(session.id)).resolves.toMatchObject({ messages: session.messages })
  })

  test('accepts a V1 snapshot edit after migrating an empty active fork', async () => {
    const harness = await createHarness()
    const session = createRichSession()
    session.messages = session.messages.slice(0, 1)
    await harness.records.setRecord(session)
    const loaded = await harness.repository.getSession(session.id)
    if (!loaded) throw new Error('Expected legacy session')

    await expect(harness.repository.migrateSession(session.id)).resolves.toBe('migrated')
    await expect(
      harness.repository.setSession({ ...loaded, name: 'Renamed' }, { baseSession: loaded })
    ).resolves.toBeUndefined()
    await expect(harness.repository.getSession(session.id)).resolves.toMatchObject({
      name: 'Renamed',
      messages: session.messages,
    })
  })

  test('checks and removes orphaned rows inside the shared session operation lock', async () => {
    const harness = await createHarness()
    const session = createPlainSession('orphan')
    await harness.repository.setSession(session)
    await harness.records.removeRecord(session.id)
    let locked = false
    const lockedIds: string[] = []
    const readRecord = harness.records.getRecord.bind(harness.records)
    vi.spyOn(harness.records, 'getRecord').mockImplementation((id) => {
      expect(locked).toBe(true)
      return readRecord(id)
    })
    const deleteRows = harness.rows.deleteRows.bind(harness.rows)
    const remove = vi.spyOn(harness.rows, 'deleteRows').mockImplementation((id, revision) => {
      expect(locked).toBe(true)
      return deleteRows(id, revision)
    })
    const restarted = new RowBackedSessionRepository({
      records: harness.records,
      rows: harness.rows,
      serializeSessionOperation: async (id, action) => {
        lockedIds.push(id)
        locked = true
        try {
          return await action()
        } finally {
          locked = false
        }
      },
    })

    await restarted.initialize()

    expect(lockedIds).toEqual([session.id])
    expect(remove).toHaveBeenCalledExactlyOnceWith(session.id, 1)
    await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
  })

  test('reads a bounded window while full context is hydrating, without releasing queued writes', async () => {
    const { repository, rows } = await createHarness()
    const session = createPlainSession()
    await repository.setSession(session)
    const readContext = rows.readContext.bind(rows)
    let release: (() => void) | undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = vi.fn()
    vi.spyOn(rows, 'readContext').mockImplementation(async (request) => {
      started()
      await barrier
      return readContext(request)
    })
    const context = repository.getSessionContextSource({ sessionId: session.id })
    await vi.waitFor(() => expect(started).toHaveBeenCalled())
    let written = false
    const write = repository.setSession({ ...session, name: 'Updated' }).then(() => {
      written = true
    })
    try {
      const head = await repository.readSessionMessageWindow({ sessionId: session.id, edge: 'head', limit: 1 })
      expect(head?.messages.map((row) => row.messageId)).toEqual([session.messages[0].id])
      expect(written).toBe(false)
    } finally {
      release?.()
      await context
      await write
    }
    expect(written).toBe(true)
  })
  describe('SessionRepositoryPort contract', () => {
    const createRepository = (): SessionRepositoryPort => {
      const meta = new InMemorySessionRepository().meta
      const data = new RowBackedSessionRepository({
        records: new InMemorySessionRecordStore(),
        rows: new InMemorySessionRowStore(),
        now: () => NOW,
      })
      return {
        meta,
        initialize: async () => {
          await data.initialize()
          await meta.initialize()
        },
        getSession: (id) => data.getSession(id),
        setSession: (session) => data.setSession(session),
        deleteSession: (id) => data.deleteSession(id),
        getAllSessionIds: () => data.getAllSessionIds(),
      }
    }

    for (const contractCase of createSessionRepositoryContract(createRepository)) {
      test(contractCase.name, async () => {
        await contractCase.run()
      })
    }
  })

  describe('legacy and row-backed reads', () => {
    let harness: Harness

    beforeEach(async () => {
      harness = await createHarness()
    })

    test('reuses a decoded row snapshot only while its persisted revision is unchanged', async () => {
      const session = createRichSession()
      await harness.repository.setSession(session)
      const readSnapshot = vi.spyOn(harness.rows, 'readSnapshot')
      const getRevision = vi.spyOn(harness.rows, 'getRevision')

      const first = await harness.repository.getSession(session.id)
      expect(first).toEqual(normalized(session))
      expect(await harness.repository.getSession(session.id)).toBe(first)
      expect(readSnapshot).toHaveBeenCalledTimes(1)
      expect(getRevision).toHaveBeenCalledTimes(2)

      const writer = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows })
      const current = await writer.getSession(session.id)
      await writer.setSession({ ...current!, name: 'Changed elsewhere' }, { baseSession: current! })
      readSnapshot.mockClear()

      const refreshed = await harness.repository.getSession(session.id)
      expect(refreshed?.name).toBe('Changed elsewhere')
      expect(refreshed).not.toBe(first)
      expect(readSnapshot).toHaveBeenCalledTimes(1)
      expect(await harness.repository.getSession(session.id)).toBe(refreshed)
      expect(readSnapshot).toHaveBeenCalledTimes(1)

      await harness.records.removeRecord(session.id)
      expect(await harness.repository.getSession(session.id)).toBeNull()
    })

    test('keeps normalized reads after a representation-equivalent write', async () => {
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const loaded = await harness.repository.getSession(session.id)
      const raw = { ...session, threads: [], messageForksHash: {} }
      await harness.repository.setSession(raw, { baseSession: loaded! })

      expect(await harness.repository.getSession(session.id)).toEqual(normalized(session))
      expect((await harness.repository.getSession(session.id))?.threads).toBeUndefined()
    })

    test('returns a V1 record without waiting for row promotion', async () => {
      const session = createRichSession()
      await harness.records.setRecord(session)
      const writeRows = vi.spyOn(harness.rows, 'writeRows').mockImplementation(() => new Promise(() => {}))

      const loaded = await harness.repository.getSession(session.id)

      expect(writeRows).not.toHaveBeenCalled()
      expect(loaded).toEqual(migrateSession(session))
      await expect(harness.records.getRecord(session.id)).resolves.toEqual(session)
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
      expect(harness.migrationSkipped).not.toHaveBeenCalled()
    })

    test('background migration keeps a recovery anchor until row publication completes', async () => {
      const session = createPlainSession()
      await harness.records.setRecord(session)
      const order: string[] = []
      vi.spyOn(harness.rows, 'writeRows').mockImplementation(() => {
        order.push('writeRows')
        return Promise.resolve()
      })
      vi.spyOn(harness.records, 'setRecord').mockImplementation(() => {
        order.push('setRecord')
        return Promise.resolve()
      })

      await expect(harness.repository.migrateSession(session.id)).resolves.toBe('migrated')

      expect(order).toEqual(['setRecord', 'writeRows', 'setRecord'])
    })

    test('reads a session that cannot be row-encoded without mutating it', async () => {
      const session = createRichSession()
      const fork = session.messageForksHash?.['user-1']
      if (!fork) {
        throw new Error('fixture is missing its fork')
      }
      fork.lists[fork.position].messages = [message('stray', 'assistant', 420)]
      await harness.records.setRecord(session)

      const loaded = await harness.repository.getSession(session.id)

      expect(loaded).toEqual(migrateSession(session))
      expect(harness.migrationSkipped).not.toHaveBeenCalled()
      expect(storedRecord(harness, session.id)).not.toHaveProperty('storageFormat')
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
    })

    test('replaces rows left behind by an interrupted migration', async () => {
      const session = createPlainSession()
      await harness.rows.writeRows(
        rowSnapshot(
          {
            sessionId: session.id,
            threads: [
              {
                sessionId: session.id,
                threadId: session.id,
                seq: -1,
                name: 'stale',
                createdAt: 1,
                rootMessageId: 'stale-message',
                activeLeafMessageId: 'stale-message',
                compactionPoints: [],
              },
            ],
            messages: [
              {
                sessionId: session.id,
                threadId: session.id,
                messageId: 'stale-message',
                parentMessageId: null,
                activeChildId: null,
                seq: 0,
                kind: 'message',
                status: 'settled',
                createdAt: 1,
                updatedAt: 1,
                branchId: null,
                message: message('stale-message', 'user', 1),
              },
            ],
          },
          1
        )
      )
      await harness.records.setRecord(session)

      await expect(harness.repository.migrateSession(session.id)).resolves.toBe('migrated')

      expect(
        storedRows(harness, session.id)
          .messages.map((row) => row.messageId)
          .sort()
      ).toEqual(['assistant-1', 'user-1'])
    })

    test('reports missing rows behind a rows record', async () => {
      const session = createPlainSession()
      await harness.repository.setSession(session)
      await harness.rows.deleteRows(session.id)
      harness.repository.forgetBaseline(session.id)

      await expect(harness.repository.getSession(session.id)).rejects.toMatchObject({
        name: 'SessionRepositoryError',
        operation: 'get-session',
        sessionId: session.id,
      })
    })

    test('reports damaged rows behind a rows record', async () => {
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const rows = storedRows(harness, session.id)
      await harness.rows.writeRows(
        rowSnapshot({ ...rows, messages: rows.messages.filter((row) => row.messageId !== 'user-1') }, 2),
        1
      )
      harness.repository.forgetBaseline(session.id)

      const error = await harness.repository.getSession(session.id).catch((thrown: unknown) => thrown)
      expect(error).toBeInstanceOf(SessionRepositoryError)
      expect((error as SessionRepositoryError).operation).toBe('get-session')
    })
  })

  describe('writes', () => {
    let harness: Harness

    beforeEach(async () => {
      harness = await createHarness()
    })

    test.each(['legacy-shape', 'row-write-failure', 'marker-write-failure'] as const)(
      'can delete immediately after an accepted %s V1 write',
      async (fallback) => {
        const acceptTextTokens =
          vi.fn<NonNullable<import('../../ports').SessionRowStorePort['acceptTextTokenResults']>>()
        Object.assign(harness.rows, { acceptTextTokenResults: acceptTextTokens })
        const original = createPlainSession()
        original.messages[0] = {
          ...original.messages[0],
          tokenCountMap: { default: 3 },
          tokenCalculatedAt: { default: 1 },
        }
        if (fallback === 'legacy-shape') original.messages.push({ ...original.messages[0] })
        await harness.records.setRecord(original)
        const loaded = await harness.repository.getSession(original.id)
        if (!loaded) throw new Error('expected session')
        if (fallback === 'row-write-failure') {
          vi.spyOn(harness.rows, 'writeRows').mockRejectedValueOnce(new Error('Row store unavailable'))
        }
        if (fallback === 'marker-write-failure') {
          const setRecord = harness.records.setRecord.bind(harness.records)
          vi.spyOn(harness.records, 'setRecord').mockImplementation(async (record) => {
            if ('storageFormat' in record) throw new Error('Marker could not be saved')
            await setRecord(record)
          })
        }
        await harness.repository.setSession({ ...loaded, name: 'Saved' }, { baseSession: loaded })
        expect(await harness.records.getRecord(original.id)).toMatchObject({ name: 'Saved', messages: loaded.messages })
        await expect(harness.repository.deleteSession(original.id)).resolves.toBeUndefined()
        await expect(harness.records.getRecord(original.id)).resolves.toBeNull()
        await expect(harness.rows.hasRows(original.id)).resolves.toBe(false)
        expect(acceptTextTokens).not.toHaveBeenCalled()
      }
    )

    test('appending a message only touches the new row, its parent and the thread row', async () => {
      const session = createPlainSession()
      await harness.records.setRecord(session)
      await harness.repository.migrateSession(session.id)
      const loaded = await harness.repository.getSession(session.id)
      if (!loaded) {
        throw new Error('session was not loaded')
      }
      const applyDiff = vi.spyOn(harness.rows, 'applyDiff')
      const writeRows = vi.spyOn(harness.rows, 'writeRows')
      const setRecord = vi.spyOn(harness.records, 'setRecord')

      await harness.repository.setSession({
        ...loaded,
        messages: [...loaded.messages, message('user-2', 'user', 500)],
      })

      expect(writeRows).not.toHaveBeenCalled()
      expect(setRecord).not.toHaveBeenCalled()
      expect(applyDiff).toHaveBeenCalledOnce()
      const diff = applyDiff.mock.calls[0][0]
      expect(diff.messages.upsert.map((row) => row.messageId).sort()).toEqual(['assistant-1', 'user-2'])
      expect(diff.messages.delete).toEqual([])
      expect(diff.threads.upsert.map((row) => row.threadId)).toEqual([session.id])
      expect(diff.threads.delete).toEqual([])
    })

    test('does not rewrite legacy messages without timestamps when the clock advances', async () => {
      let clock = 1_000
      harness = await createHarness(() => clock)
      const session = {
        ...createPlainSession(),
        messages: createPlainSession().messages.map(({ timestamp: _timestamp, ...item }) => item),
      }
      await harness.records.setRecord(session)
      await harness.repository.migrateSession(session.id)
      const loaded = await harness.repository.getSession(session.id)
      if (!loaded) throw new Error('session was not loaded')
      clock = 2_000
      const applyDiff = vi.spyOn(harness.rows, 'applyDiff')

      await harness.repository.setSession({
        ...loaded,
        messages: [...loaded.messages, message('user-2', 'user', clock)],
      })

      expect(applyDiff).toHaveBeenCalledOnce()
      expect(applyDiff.mock.calls[0][0].messages.upsert.map((row) => row.messageId).sort()).toEqual([
        'assistant-1',
        'user-2',
      ])
    })

    test('switching a fork only touches the branch point and the thread row', async () => {
      const session = createRichSession()
      await harness.records.setRecord(session)
      await harness.repository.migrateSession(session.id)
      const loaded = await harness.repository.getSession(session.id)
      if (!loaded) {
        throw new Error('session was not loaded')
      }
      const patch = buildSwitchForkToPatch(loaded, 'user-1', 1)
      if (!patch) {
        throw new Error('fork switch produced no patch')
      }
      const applyDiff = vi.spyOn(harness.rows, 'applyDiff')

      await harness.repository.setSession({ ...loaded, ...patch })

      expect(applyDiff).toHaveBeenCalledOnce()
      const diff = applyDiff.mock.calls[0][0]
      expect(diff.messages.upsert.map((row) => row.messageId)).toEqual(['user-1'])
      expect(diff.messages.upsert[0].activeChildId).toBe('fork-answer')
      expect(diff.messages.delete).toEqual([])
      expect(diff.threads.upsert.map((row) => row.threadId)).toEqual([session.id])
    })

    test('renaming a session commits row metadata without encoding the tree', async () => {
      const session = createRichSession()
      await harness.records.setRecord(session)
      await harness.repository.migrateSession(session.id)
      const loaded = await harness.repository.getSession(session.id)
      if (!loaded) {
        throw new Error('session was not loaded')
      }
      const applyDiff = vi.spyOn(harness.rows, 'applyDiff')
      const writeRows = vi.spyOn(harness.rows, 'writeRows')
      const setRecord = vi.spyOn(harness.records, 'setRecord')
      encoding.calls = 0

      await harness.repository.setSession({ ...loaded, name: 'Renamed' })

      expect(encoding.calls).toBe(0)
      expect(applyDiff).toHaveBeenCalledOnce()
      expect(applyDiff.mock.calls[0][0].messages.upsert).toEqual([])
      expect(applyDiff.mock.calls[0][0].threads.upsert).toEqual([])
      expect(applyDiff.mock.calls[0][1].record.name).toBe('Renamed')
      expect(writeRows).not.toHaveBeenCalled()
      expect(setRecord).not.toHaveBeenCalled()
      expect(committedRecord(harness, session.id).name).toBe('Renamed')
      await expect(harness.repository.getSession(session.id)).resolves.toEqual({
        ...normalized(session),
        name: 'Renamed',
      })
    })

    test('a record-only write leaves the baseline able to diff the next message change', async () => {
      const session = createPlainSession()
      await harness.records.setRecord(session)
      await harness.repository.migrateSession(session.id)
      const loaded = await harness.repository.getSession(session.id)
      if (!loaded) {
        throw new Error('session was not loaded')
      }
      const renamed = { ...loaded, name: 'Renamed' }
      await harness.repository.setSession(renamed)
      const applyDiff = vi.spyOn(harness.rows, 'applyDiff')
      const writeRows = vi.spyOn(harness.rows, 'writeRows')

      await harness.repository.setSession({
        ...renamed,
        messages: [...renamed.messages, message('user-2', 'user', 500)],
      })

      expect(writeRows).not.toHaveBeenCalled()
      expect(applyDiff).toHaveBeenCalledOnce()
      expect(applyDiff.mock.calls[0][0].messages.upsert.map((row) => row.messageId).sort()).toEqual([
        'assistant-1',
        'user-2',
      ])
    })

    test('encodes the tree when no baseline session is cached', async () => {
      const session = createPlainSession()
      await harness.repository.setSession(session)
      harness.repository.forgetBaseline(session.id)
      encoding.calls = 0

      await harness.repository.setSession({ ...normalized(session), name: 'Renamed' }, { baseSession: session })

      expect(encoding.calls).toBe(1)
      expect(committedRecord(harness, session.id).name).toBe('Renamed')
    })

    test('a hinted message change upserts one row and re-derives its status', async () => {
      const session = createRichSession()
      await harness.records.setRecord(session)
      const loaded = await harness.repository.getSession(session.id)
      if (!loaded) {
        throw new Error('session was not loaded')
      }
      const streaming = { ...loaded.messages[1], contentParts: [{ type: 'text' as const, text: 'partial' }] }
      const generating = { ...streaming, generating: true }
      await harness.repository.setSession(
        { ...loaded, messages: [loaded.messages[0], generating] },
        { changedMessageId: 'assistant-1' }
      )
      const applyDiff = vi.spyOn(harness.rows, 'applyDiff')
      const writeRows = vi.spyOn(harness.rows, 'writeRows')
      const setRecord = vi.spyOn(harness.records, 'setRecord')
      encoding.calls = 0

      const settled = { ...generating, generating: false }
      await harness.repository.setSession(
        { ...loaded, messages: [loaded.messages[0], settled] },
        { changedMessageId: 'assistant-1' }
      )

      expect(encoding.calls).toBe(0)
      expect(applyDiff).toHaveBeenCalledOnce()
      expect(writeRows).not.toHaveBeenCalled()
      expect(setRecord).not.toHaveBeenCalled()
      expect(applyDiff.mock.calls[0][0].threads.upsert).toEqual([])
      expect(applyDiff.mock.calls[0][0].messages.upsert.map((entry) => entry.messageId)).toEqual(['assistant-1'])
      const row = storedRows(harness, session.id).messages.find((candidate) => candidate.messageId === 'assistant-1')
      expect(row).toMatchObject({ status: 'settled', parentMessageId: 'user-1', branchId: 'active-branch' })
      expect(row?.message).toEqual(settled)
      await expect(harness.repository.getSession(session.id)).resolves.toEqual({
        ...normalized(session),
        messages: [loaded.messages[0], settled],
      })
    })

    test('falls back to the full path when the write did more than the hint claims', async () => {
      const session = createPlainSession()
      await harness.records.setRecord(session)
      await harness.repository.migrateSession(session.id)
      const loaded = await harness.repository.getSession(session.id)
      if (!loaded) {
        throw new Error('session was not loaded')
      }
      const edited = { ...loaded.messages[1], contentParts: [{ type: 'text' as const, text: 'edited' }] }
      const applyDiff = vi.spyOn(harness.rows, 'applyDiff')
      encoding.calls = 0

      await harness.repository.setSession(
        { ...loaded, messages: [loaded.messages[0], edited, message('user-2', 'user', 500)] },
        { changedMessageId: 'assistant-1' }
      )

      expect(encoding.calls).toBe(1)
      expect(applyDiff).toHaveBeenCalledOnce()
      await expect(harness.repository.getSession(session.id)).resolves.toEqual({
        ...normalized(session),
        messages: [loaded.messages[0], edited, message('user-2', 'user', 500)],
      })
    })

    test('falls back to the full path when the hint names a message outside the active path', async () => {
      const session = createRichSession()
      await harness.records.setRecord(session)
      const loaded = await harness.repository.getSession(session.id)
      if (!loaded) {
        throw new Error('session was not loaded')
      }
      const fork = loaded.messageForksHash?.['user-1']
      if (!fork) {
        throw new Error('loaded session is missing its fork')
      }
      const edited = { ...fork.lists[1].messages[0], contentParts: [{ type: 'text' as const, text: 'edited' }] }
      encoding.calls = 0

      await harness.repository.setSession(
        {
          ...loaded,
          messageForksHash: {
            ...loaded.messageForksHash,
            'user-1': { ...fork, lists: [fork.lists[0], { ...fork.lists[1], messages: [edited] }] },
          },
        },
        { changedMessageId: 'fork-answer' }
      )

      expect(encoding.calls).toBe(1)
      expect(
        storedRows(harness, session.id).messages.find((candidate) => candidate.messageId === 'fork-answer')?.message
      ).toEqual(edited)
    })

    test('rebuilds a missing baseline from storage instead of rewriting every row', async () => {
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const detached = new RowBackedSessionRepository({
        records: harness.records,
        rows: harness.rows,
        now: () => NOW,
      })
      await detached.initialize()
      const readRows = vi.spyOn(harness.rows, 'readSnapshot')
      const applyDiff = vi.spyOn(harness.rows, 'applyDiff')
      const writeRows = vi.spyOn(harness.rows, 'writeRows')

      const detachedSnapshot = await detached.getSession(session.id)
      if (!detachedSnapshot) throw new Error('session was not loaded')
      await detached.setSession({ ...detachedSnapshot, name: 'Renamed elsewhere' }, { baseSession: detachedSnapshot })

      expect(readRows).toHaveBeenCalledWith(session.id)
      expect(writeRows).not.toHaveBeenCalled()
      expect(applyDiff).toHaveBeenCalledOnce()
      expect(committedRecord(harness, session.id).name).toBe('Renamed elsewhere')
    })

    test('rejects a stale cross-instance snapshot without deleting a newer message', async () => {
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const other = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await other.initialize()
      const stale = await other.getSession(session.id)
      const current = await harness.repository.getSession(session.id)
      if (!stale || !current) {
        throw new Error('session was not loaded')
      }

      await harness.repository.setSession({
        ...current,
        messages: [...current.messages, message('user-2', 'user', 500)],
      })
      await expect(
        other.setSession({ ...stale, messages: [stale.messages[0]] }, { baseSession: stale })
      ).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: 1,
        actualRevision: 2,
      })

      const detached = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await detached.initialize()
      await expect(detached.getSession(session.id)).resolves.toMatchObject({
        messages: [{ id: 'user-1' }, { id: 'assistant-1' }, { id: 'user-2' }],
      })
      expect(storedRows(harness, session.id).messages.map((row) => row.messageId)).toEqual([
        'user-1',
        'assistant-1',
        'user-2',
      ])
    })

    test('loads the authoritative record committed atomically with its rows', async () => {
      const session = createPlainSession()
      const snapshot = {
        version: 1 as const,
        soul: 'committed prompt',
        memories: [],
        workspaceInstructions: '',
        workspaceDirectories: [],
        capturedAt: 600,
        scope: 'agent' as const,
      }
      await harness.repository.setSession(session)
      await harness.repository.setSession({
        ...normalized(session),
        name: 'Committed name',
        settings: { sessionPromptContextSnapshot: snapshot },
        messages: [message('replacement', 'user', 600)],
      })

      expect(storedRecord(harness, session.id).name).toBe('Plain session')
      const detached = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await detached.initialize()
      await expect(detached.getSession(session.id)).resolves.toMatchObject({
        name: 'Committed name',
        settings: { sessionPromptContextSnapshot: snapshot },
        messages: [{ id: 'replacement' }],
      })
    })

    test('migrates a never-read V1 session on write', async () => {
      const session = createRichSession()
      await harness.records.setRecord(session)
      const writeRows = vi.spyOn(harness.rows, 'writeRows')

      await harness.repository.setSession(session)

      expect(writeRows).toHaveBeenCalledOnce()
      expect(storedRecord(harness, session.id).storageFormat).toBe('rows')
      await expect(harness.repository.getSession(session.id)).resolves.toEqual(normalized(session))
    })

    test('keeps a complete V1 recovery record when marker publication fails after rows commit', async () => {
      const session = createPlainSession()
      const setRecord = harness.records.setRecord.bind(harness.records)
      let writeCount = 0
      vi.spyOn(harness.records, 'setRecord').mockImplementation(async (record) => {
        writeCount += 1
        if (writeCount === 2) throw new Error('marker write failed')
        await setRecord(record)
      })

      await expect(harness.repository.setSession(session)).resolves.toBeUndefined()

      await expect(harness.records.getRecord(session.id)).resolves.toEqual(session)
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(true)
      expect(harness.migrationSkipped).toHaveBeenCalledWith(
        session.id,
        'row-backed publish failed; kept the complete V1 session record'
      )

      const restarted = new RowBackedSessionRepository({
        records: harness.records,
        rows: harness.rows,
        now: () => NOW,
      })
      await restarted.initialize()
      await expect(restarted.getSession(session.id)).resolves.toEqual(normalized(session))
      await expect(restarted.migrateSession(session.id)).resolves.toBe('migrated')
      await expect(harness.records.getRecord(session.id)).resolves.toMatchObject({ storageFormat: 'rows' })
      await expect(harness.rows.getRevision(session.id)).resolves.toBe(1)
    })

    test('commits a foreground edit while recovering an interrupted promotion', async () => {
      const session = createPlainSession()
      const setRecord = harness.records.setRecord.bind(harness.records)
      let writeCount = 0
      const setRecordSpy = vi.spyOn(harness.records, 'setRecord').mockImplementation(async (record) => {
        writeCount += 1
        if (writeCount === 2) throw new Error('marker write failed')
        await setRecord(record)
      })
      await harness.repository.setSession(session)
      setRecordSpy.mockRestore()

      const restarted = new RowBackedSessionRepository({
        records: harness.records,
        rows: harness.rows,
        now: () => NOW,
      })
      await restarted.initialize()
      const base = await restarted.getSession(session.id)
      if (!base) throw new Error('session was not loaded')

      await restarted.setSession({ ...base, name: 'Recovered edit' }, { baseSession: base })

      await expect(restarted.getSession(session.id)).resolves.toMatchObject({ name: 'Recovered edit' })
      await expect(harness.rows.getRevision(session.id)).resolves.toBe(2)
    })

    test('recovers the baseline when initial marker publication commits before its response is lost', async () => {
      const session = createPlainSession()
      const setRecord = harness.records.setRecord.bind(harness.records)
      let writeCount = 0
      vi.spyOn(harness.records, 'setRecord').mockImplementation(async (record) => {
        writeCount += 1
        await setRecord(record)
        if (writeCount === 2) throw new Error('marker response was lost')
      })

      await expect(harness.repository.setSession(session)).resolves.toBeUndefined()
      await expect(
        harness.repository.setSession({ ...normalized(session), name: 'Saved after uncertain marker response' })
      ).resolves.toBeUndefined()

      await expect(harness.repository.getSession(session.id)).resolves.toMatchObject({
        name: 'Saved after uncertain marker response',
      })
      await expect(harness.rows.getRevision(session.id)).resolves.toBe(2)
      expect(harness.migrationSkipped).not.toHaveBeenCalled()
    })

    test('keeps an unencodable new session in V1 form', async () => {
      const session = createRichSession()
      const fork = session.messageForksHash?.['user-1']
      if (!fork) {
        throw new Error('fixture is missing its fork')
      }
      fork.lists[fork.position].messages = [message('stray', 'assistant', 420)]

      await harness.repository.setSession(session)

      expect(harness.migrationSkipped).toHaveBeenCalledWith(session.id, expect.stringContaining('user-1'))
      expect(storedRecord(harness, session.id)).not.toHaveProperty('storageFormat')
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
    })

    test('keeps a new session with duplicate archived thread ids in V1 form', async () => {
      const session = createRichSession()
      const archived = session.threads?.[0]
      if (!archived) throw new Error('fixture is missing its archived thread')
      session.threads = [archived, { ...archived, messages: [message('other-history-user', 'user', 13)] }]

      await harness.repository.setSession(session)

      expect(harness.migrationSkipped).toHaveBeenCalledWith(session.id, expect.stringContaining(archived.id))
      expect(storedRecord(harness, session.id)).not.toHaveProperty('storageFormat')
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
    })

    test('refuses to write a migrated session back in V1 form', async () => {
      const session = createRichSession()
      await harness.repository.setSession(session)
      const broken = normalized(session)
      const fork = broken.messageForksHash?.['user-1']
      if (!fork) {
        throw new Error('normalized session is missing its fork')
      }
      fork.lists[fork.position].messages = [message('stray', 'assistant', 420)]

      await expect(harness.repository.setSession(broken)).rejects.toMatchObject({
        name: 'SessionRepositoryError',
        operation: 'set-session',
        sessionId: session.id,
      })
    })

    test('forgetting a baseline makes the next write read rows again', async () => {
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const readRows = vi.spyOn(harness.rows, 'readSnapshot')

      const first = { ...normalized(session), name: 'First' }
      await harness.repository.setSession(first)
      expect(readRows).not.toHaveBeenCalled()

      harness.repository.forgetBaseline(session.id)
      await harness.repository.setSession({ ...normalized(session), name: 'Second' }, { baseSession: first })
      expect(readRows).toHaveBeenCalledWith(session.id)
    })

    test('advances the revision when an imported V1 record replaces existing rows', async () => {
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const staleSnapshot = await harness.repository.getSession(session.id)
      if (!staleSnapshot) throw new Error('session was not loaded')

      const imported = {
        ...createPlainSession(session.id),
        name: 'Imported session',
        messages: [message('imported-user', 'user', 300)],
      }
      await harness.records.setRecord(imported)
      harness.repository.forgetAllBaselines()

      await expect(harness.repository.getSession(session.id)).resolves.toMatchObject({ name: 'Imported session' })
      await expect(harness.repository.migrateSession(session.id)).resolves.toBe('migrated')
      expect(committedRecord(harness, session.id)).toMatchObject({ name: 'Imported session' })
      await expect(harness.rows.getRevision(session.id)).resolves.toBe(2)

      await expect(
        harness.repository.setSession({ ...staleSnapshot, name: 'Stale overwrite' }, { baseSession: staleSnapshot })
      ).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: 1,
        actualRevision: 2,
      })
      await expect(harness.repository.getSession(session.id)).resolves.toMatchObject({ name: 'Imported session' })
    })

    test('drops the least recently used baseline past the retention limit', async () => {
      const first = createPlainSession('session-0')
      await harness.repository.setSession(first)
      for (let index = 1; index <= 32; index += 1) {
        await harness.repository.setSession(createPlainSession(`session-${index}`))
      }
      const readRows = vi.spyOn(harness.rows, 'readSnapshot')

      await harness.repository.setSession({ ...normalized(createPlainSession('session-32')), name: 'Recent' })
      expect(readRows).not.toHaveBeenCalled()

      await harness.repository.setSession({ ...normalized(first), name: 'Evicted' }, { baseSession: first })
      expect(readRows).toHaveBeenCalledWith('session-0')
    })

    test('rejects a stale evicted snapshot when the revision advances while its baseline reloads', async () => {
      const first = createPlainSession('session-0')
      await harness.repository.setSession(first)
      const stale = await harness.repository.getSession(first.id)
      if (!stale) throw new Error('session was not loaded')
      for (let index = 1; index <= 32; index += 1) {
        await harness.repository.setSession(createPlainSession(`session-${index}`))
      }

      const other = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await other.initialize()
      const current = await other.getSession(first.id)
      if (!current) throw new Error('session was not loaded by the concurrent repository')
      const readRows = harness.rows.readSnapshot.bind(harness.rows)
      vi.spyOn(harness.rows, 'readSnapshot').mockImplementationOnce(async (sessionId) => {
        await other.setSession({ ...current, name: 'Concurrent commit' }, { baseSession: current })
        return readRows(sessionId)
      })

      await expect(
        harness.repository.setSession({ ...stale, name: 'Stale overwrite' }, { baseSession: stale })
      ).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: 1,
        actualRevision: 2,
      })
      await expect(other.getSession(first.id)).resolves.toMatchObject({ name: 'Concurrent commit' })
    })
  })

  describe('background migration', () => {
    test.each(['missing-root', 'unreadable-payload'] as const)(
      'restores an authoritative V1 backup over %s row remnants',
      async (damage) => {
        const harness = await createHarness()
        const original = createPlainSession()
        await harness.repository.setSession(original)
        const restored = { ...original, name: 'Restored backup' }
        await harness.records.setRecord(restored)
        const snapshot = await harness.rows.readSnapshot(original.id)
        if (!snapshot) throw new Error('expected rows')
        if (damage === 'missing-root') {
          await harness.rows.writeRows({ ...snapshot, rows: { ...snapshot.rows, messages: [] }, revision: 2 }, 1)
        }
        const readRows = vi.spyOn(harness.rows, 'readSnapshot')
        if (damage === 'unreadable-payload') readRows.mockRejectedValueOnce(new Error('Malformed message payload'))

        const reopened = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows })
        await reopened.initialize()
        await expect(reopened.getSession(original.id)).resolves.toMatchObject(restored)
        expect(readRows).not.toHaveBeenCalled()
        await expect(reopened.migrateSession(original.id)).resolves.toBe('migrated')
        await expect(reopened.getSession(original.id)).resolves.toMatchObject(restored)
      }
    )

    test('excludes protected sessions before loading any legacy record during enumeration', async () => {
      const harness = await createHarness()
      await harness.records.setRecord(createPlainSession('protected'))
      await harness.records.setRecord(createPlainSession('safe'))
      const readRecord = vi.spyOn(harness.records, 'getRecord')

      await expect(harness.repository.listUnmigratedSessionIds(async (id) => id === 'protected')).resolves.toEqual([
        'safe',
      ])

      expect(readRecord).toHaveBeenCalledExactlyOnceWith('safe')
    })

    let harness: Harness

    beforeEach(async () => {
      harness = await createHarness()
    })

    test('lists V1 records even when interrupted migration rows exist, leaving orphaned rows out', async () => {
      await harness.records.setRecord(createRichSession('session-legacy-b'))
      await harness.records.setRecord(createPlainSession('session-legacy-a'))
      await harness.repository.setSession(createPlainSession('session-rows'))
      const orphan = storedRows(harness, 'session-rows')
      await harness.rows.writeRows(
        rowSnapshot(
          {
            sessionId: 'session-orphan',
            threads: orphan.threads.map((row) => ({ ...row, sessionId: 'session-orphan' })),
            messages: orphan.messages.map((row) => ({ ...row, sessionId: 'session-orphan' })),
          },
          1
        )
      )
      await harness.records.setRecord(createPlainSession('session-interrupted'))
      await harness.rows.writeRows(
        rowSnapshot(
          {
            sessionId: 'session-interrupted',
            threads: orphan.threads.map((row) => ({ ...row, sessionId: 'session-interrupted' })),
            messages: orphan.messages.map((row) => ({ ...row, sessionId: 'session-interrupted' })),
          },
          1
        )
      )

      await expect(harness.repository.listUnmigratedSessionIds()).resolves.toEqual([
        'session-interrupted',
        'session-legacy-a',
        'session-legacy-b',
      ])
    })

    test('migrates a V1 record without reading the session back', async () => {
      const session = createRichSession()
      await harness.records.setRecord(session)

      await expect(harness.repository.migrateSession(session.id)).resolves.toBe('migrated')

      expect(storedRecord(harness, session.id).storageFormat).toBe('rows')
      await expect(harness.repository.getSession(session.id)).resolves.toEqual(normalized(session))
      await expect(harness.repository.listUnmigratedSessionIds()).resolves.toEqual([])
    })

    test('reports an already migrated session and touches nothing', async () => {
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const writeRows = vi.spyOn(harness.rows, 'writeRows')
      const setRecord = vi.spyOn(harness.records, 'setRecord')

      await expect(harness.repository.migrateSession(session.id)).resolves.toBe('already')

      expect(writeRows).not.toHaveBeenCalled()
      expect(setRecord).not.toHaveBeenCalled()
    })

    test('reports a missing session', async () => {
      await expect(harness.repository.migrateSession('session-unknown')).resolves.toBe('missing')
    })

    test('reports a record that is not a session object as missing', async () => {
      vi.spyOn(harness.records, 'getRecord').mockResolvedValue('not-a-session' as unknown as StoredSessionRecord)

      await expect(harness.repository.migrateSession('session-broken')).resolves.toBe('missing')
    })

    test('skips a session whose round-trip self-check fails and keeps it in V1 form', async () => {
      const session = createRichSession()
      const fork = session.messageForksHash?.['user-1']
      if (!fork) {
        throw new Error('fixture is missing its fork')
      }
      fork.lists[fork.position].messages = [message('stray', 'assistant', 420)]
      await harness.records.setRecord(session)

      await expect(harness.repository.migrateSession(session.id)).resolves.toBe('skipped')

      expect(harness.migrationSkipped).toHaveBeenCalledWith(session.id, expect.stringContaining('user-1'))
      expect(storedRecord(harness, session.id)).not.toHaveProperty('storageFormat')
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
    })

    test('keeps the baselines of the sessions in use', async () => {
      const first = createPlainSession('session-0')
      await harness.repository.setSession(first)
      for (let index = 1; index < 32; index += 1) {
        await harness.repository.setSession(createPlainSession(`session-${index}`))
      }
      await harness.records.setRecord(createPlainSession('session-legacy'))

      await expect(harness.repository.migrateSession('session-legacy')).resolves.toBe('migrated')

      const readRows = vi.spyOn(harness.rows, 'readSnapshot')
      await harness.repository.setSession({ ...normalized(first), name: 'Still cached' })
      expect(readRows).not.toHaveBeenCalled()

      const migrated = await harness.repository.getSession('session-legacy')
      if (!migrated) throw new Error('migrated session was not loaded')
      await harness.repository.setSession({ ...migrated, name: 'Renamed' }, { baseSession: migrated })
      expect(readRows).toHaveBeenCalledWith('session-legacy')
    })

    test('rebases a V1 foreground edit queued behind an unchanged in-flight migration', async () => {
      const session = createPlainSession()
      await harness.records.setRecord(session)
      const loaded = await harness.repository.getSession(session.id)
      if (!loaded) throw new Error('session was not loaded')
      const originalWriteRows = harness.rows.writeRows.bind(harness.rows)
      let releaseMigration: () => void = () => {}
      const migrationPaused = new Promise<void>((resolve) => {
        releaseMigration = resolve
      })
      const writeRows = vi.spyOn(harness.rows, 'writeRows').mockImplementationOnce(async (rows) => {
        await migrationPaused
        await originalWriteRows(rows)
      })

      const migration = harness.repository.migrateSession(session.id)
      await vi.waitFor(() => expect(writeRows).toHaveBeenCalledOnce())
      const edited = { ...loaded, name: 'Edited while migration was running' }
      const foregroundWrite = harness.repository.setSession(edited, { baseSession: loaded })

      releaseMigration()
      await expect(migration).resolves.toBe('migrated')
      await expect(foregroundWrite).resolves.toBeUndefined()
      await expect(harness.repository.getSession(session.id)).resolves.toEqual(edited)
      await expect(harness.rows.getRevision(session.id)).resolves.toBe(2)
    })

    test('rejects a stale V1 snapshot after another repository changes the recovery record', async () => {
      const session = createPlainSession()
      await harness.records.setRecord(session)
      const first = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      const second = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await Promise.all([first.initialize(), second.initialize()])
      const firstSnapshot = await first.getSession(session.id)
      const staleSnapshot = await second.getSession(session.id)
      if (!firstSnapshot || !staleSnapshot) throw new Error('session was not loaded')

      const setRecord = harness.records.setRecord.bind(harness.records)
      let markerWrite = 0
      vi.spyOn(harness.records, 'setRecord').mockImplementation(async (record) => {
        markerWrite += 1
        if (markerWrite === 2) throw new Error('marker write failed')
        await setRecord(record)
      })
      await first.setSession({ ...firstSnapshot, name: 'Current V1 recovery value' }, { baseSession: firstSnapshot })

      await expect(
        second.setSession({ ...staleSnapshot, name: 'Stale overwrite' }, { baseSession: staleSnapshot })
      ).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: null,
        actualRevision: 1,
      })
      await expect(harness.records.getRecord(session.id)).resolves.toMatchObject({ name: 'Current V1 recovery value' })
    })

    test('does not recreate a deleted V1 session from another repository stale snapshot', async () => {
      const session = createPlainSession()
      await harness.records.setRecord(session)
      const reader = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      const deleter = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await Promise.all([reader.initialize(), deleter.initialize()])
      const staleSnapshot = await reader.getSession(session.id)
      if (!staleSnapshot) throw new Error('session was not loaded')

      await deleter.deleteSession(session.id)

      await expect(
        reader.setSession({ ...staleSnapshot, name: 'Stale recreation' }, { baseSession: staleSnapshot })
      ).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: null,
        actualRevision: null,
      })
      await expect(harness.records.getRecord(session.id)).resolves.toBeNull()
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
    })

    test('serializes a foreground delete behind an in-flight migration of the same session', async () => {
      const session = createPlainSession()
      await harness.records.setRecord(session)
      const originalWriteRows = harness.rows.writeRows.bind(harness.rows)
      let releaseMigration: () => void = () => {}
      const migrationPaused = new Promise<void>((resolve) => {
        releaseMigration = resolve
      })
      const writeRows = vi.spyOn(harness.rows, 'writeRows').mockImplementationOnce(async (rows) => {
        await migrationPaused
        await originalWriteRows(rows)
      })

      const migration = harness.repository.migrateSession(session.id)
      await vi.waitFor(() => expect(writeRows).toHaveBeenCalledOnce())
      const foregroundDelete = harness.repository.deleteSession(session.id)

      releaseMigration()
      await expect(Promise.all([migration, foregroundDelete])).resolves.toEqual(['migrated', undefined])
      await expect(harness.repository.getSession(session.id)).resolves.toBeNull()
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
    })
  })

  describe('deletes', () => {
    test('deletes an unreadable rows marker without hydrating its missing message rows', async () => {
      const harness = await createHarness()
      await harness.records.setRecord({
        id: 'broken',
        name: 'Broken',
        type: 'chat',
        storageFormat: 'rows',
        activeThreadId: 'broken',
      })
      const readSnapshot = vi.spyOn(harness.rows, 'readSnapshot')

      await expect(harness.repository.deleteSession('broken')).resolves.toBeUndefined()

      expect(readSnapshot).not.toHaveBeenCalled()
      await expect(harness.records.getRecord('broken')).resolves.toBeNull()
    })

    test('deletes a known row revision even when its content can no longer be decoded', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const readSnapshot = vi.spyOn(harness.rows, 'readSnapshot').mockRejectedValue(new Error('Damaged payload'))

      await expect(harness.repository.deleteSession(session.id)).resolves.toBeUndefined()

      expect(readSnapshot).not.toHaveBeenCalled()
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
      await expect(harness.records.getRecord(session.id)).resolves.toBeNull()
    })

    test('removes rows and record and stays a no-op when repeated', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.repository.setSession(session)

      await harness.repository.deleteSession(session.id)

      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
      await expect(harness.records.getRecord(session.id)).resolves.toBeNull()
      await expect(harness.repository.getAllSessionIds()).resolves.not.toContain(session.id)
      await expect(harness.repository.deleteSession(session.id)).resolves.toBeUndefined()
    })

    test('keeps rows readable when removing the session record fails', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const deleteRows = vi.spyOn(harness.rows, 'deleteRows')
      vi.spyOn(harness.records, 'removeRecord').mockRejectedValueOnce(new Error('record delete failed'))

      await expect(harness.repository.deleteSession(session.id)).rejects.toMatchObject({
        name: 'SessionRepositoryError',
        operation: 'delete-session',
        sessionId: session.id,
      })

      expect(deleteRows).not.toHaveBeenCalled()
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(true)
    })

    test('finishes deleting rows when record removal commits before its response is lost', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const removeRecord = harness.records.removeRecord.bind(harness.records)
      vi.spyOn(harness.records, 'removeRecord').mockImplementationOnce(async (id) => {
        await removeRecord(id)
        throw new Error('record delete response was lost')
      })

      await expect(harness.repository.deleteSession(session.id)).resolves.toBeUndefined()

      await expect(harness.records.getRecord(session.id)).resolves.toBeNull()
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
    })

    test('cleans rows left by an interrupted record-first deletion on restart', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.repository.setSession(session)
      await harness.records.removeRecord(session.id)

      const restarted = new RowBackedSessionRepository({
        records: harness.records,
        rows: harness.rows,
        now: () => NOW,
      })
      await restarted.initialize()

      await expect(restarted.getSession(session.id)).resolves.toBeNull()
      await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
      await expect(harness.rows.getRevision(session.id)).resolves.toBe(2)
    })

    test('rejects deletion from a repository whose cached snapshot is stale', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const other = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await other.initialize()
      const stale = await other.getSession(session.id)
      const current = await harness.repository.getSession(session.id)
      if (!stale || !current) throw new Error('session was not loaded')

      await harness.repository.setSession({ ...current, name: 'Current' }, { baseSession: current })

      await expect(other.deleteSession(session.id)).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: 1,
        actualRevision: 2,
      })
      await expect(harness.repository.getSession(session.id)).resolves.toMatchObject({ name: 'Current' })
    })

    test('rejects a stale V1 deletion after another repository promotes an edited session', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.records.setRecord(session)
      const reader = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      const writer = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await Promise.all([reader.initialize(), writer.initialize()])
      const stale = await reader.getSession(session.id)
      const current = await writer.getSession(session.id)
      if (!stale || !current) throw new Error('session was not loaded')

      await writer.setSession({ ...current, name: 'Current' }, { baseSession: current })

      await expect(reader.deleteSession(session.id)).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: null,
        actualRevision: 1,
      })
      await expect(writer.getSession(session.id)).resolves.toMatchObject({ name: 'Current' })
    })

    test.each([false, true])(
      'allows deleting a V1 snapshot after representation-only promotion (restored: %s)',
      async (restored) => {
        const harness = await createHarness()
        const session = createPlainSession()
        if (restored) await harness.repository.setSession({ ...session, name: 'Before backup restore' })
        await harness.records.setRecord(session)
        harness.repository.forgetAllBaselines()
        const reader = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
        const migrator = new RowBackedSessionRepository({
          records: harness.records,
          rows: harness.rows,
          now: () => NOW,
        })
        await Promise.all([reader.initialize(), migrator.initialize()])
        await reader.getSession(session.id)
        await expect(migrator.migrateSession(session.id)).resolves.toBe('migrated')

        await expect(reader.deleteSession(session.id)).resolves.toBeUndefined()
        await expect(harness.records.getRecord(session.id)).resolves.toBeNull()
        await expect(harness.rows.hasRows(session.id)).resolves.toBe(false)
      }
    )

    test('rejects deleting restored V1 content after a concurrent edit and migration', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.repository.setSession({ ...session, name: 'Before backup restore' })
      await harness.records.setRecord(session)
      harness.repository.forgetAllBaselines()
      await harness.repository.getSession(session.id)
      await harness.records.setRecord({ ...session, name: 'Concurrent edit' })
      await harness.repository.migrateSession(session.id)

      await expect(harness.repository.deleteSession(session.id)).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
      })
      await expect(harness.repository.getSession(session.id)).resolves.toMatchObject({ name: 'Concurrent edit' })
    })

    test('retains the expected V1 version after many other session reads', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.records.setRecord(session)
      const reader = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      const writer = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await Promise.all([reader.initialize(), writer.initialize()])
      const stale = await reader.getSession(session.id)
      if (!stale) throw new Error('session was not loaded')
      for (let index = 0; index < 140; index += 1) {
        const other = createPlainSession(`other-${index}`)
        await harness.records.setRecord(other)
        await reader.getSession(other.id)
      }
      const current = await writer.getSession(session.id)
      if (!current) throw new Error('session was not loaded')

      await writer.setSession({ ...current, name: 'Current' }, { baseSession: current })

      await expect(reader.deleteSession(session.id)).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: null,
        actualRevision: 1,
      })
      await expect(writer.getSession(session.id)).resolves.toMatchObject({ name: 'Current' })
    })

    test('preserves a concurrent commit that lands after record removal but before row deletion', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const writer = new RowBackedSessionRepository({ records: harness.records, rows: harness.rows, now: () => NOW })
      await writer.initialize()
      const writerSnapshot = await writer.getSession(session.id)
      if (!writerSnapshot) throw new Error('session was not loaded')

      const originalApplyDiff = harness.rows.applyDiff.bind(harness.rows)
      let releaseWrite: () => void = () => {}
      let markWriteStarted: () => void = () => {}
      const writeStarted = new Promise<void>((resolve) => {
        markWriteStarted = resolve
      })
      const writePaused = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      vi.spyOn(harness.rows, 'applyDiff').mockImplementationOnce(async (diff, expectedRevision) => {
        markWriteStarted()
        await writePaused
        await originalApplyDiff(diff, expectedRevision)
      })

      const originalDeleteRows = harness.rows.deleteRows.bind(harness.rows)
      let releaseDelete: () => void = () => {}
      let markDeleteStarted: () => void = () => {}
      const deleteStarted = new Promise<void>((resolve) => {
        markDeleteStarted = resolve
      })
      const deletePaused = new Promise<void>((resolve) => {
        releaseDelete = resolve
      })
      vi.spyOn(harness.rows, 'deleteRows').mockImplementationOnce(async (id, expectedRevision) => {
        markDeleteStarted()
        await deletePaused
        await originalDeleteRows(id, expectedRevision)
      })

      const write = writer.setSession({ ...writerSnapshot, name: 'Concurrent commit' }, { baseSession: writerSnapshot })
      await writeStarted
      const deletion = harness.repository.deleteSession(session.id)
      await deleteStarted

      releaseWrite()
      await expect(write).resolves.toBeUndefined()
      releaseDelete()
      await expect(deletion).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: 1,
        actualRevision: 2,
      })
      await expect(harness.records.getRecord(session.id)).resolves.toMatchObject({ storageFormat: 'rows' })
      await expect(harness.repository.getSession(session.id)).resolves.toMatchObject({ name: 'Concurrent commit' })
    })

    test('does not reuse a revision when a deleted session id is imported again', async () => {
      const harness = await createHarness()
      const session = createPlainSession()
      await harness.repository.setSession(session)
      const staleSnapshot = await harness.repository.getSession(session.id)
      if (!staleSnapshot) throw new Error('session was not loaded')

      await harness.repository.deleteSession(session.id)
      await harness.records.setRecord({ ...createPlainSession(session.id), name: 'Restored generation' })
      await expect(harness.repository.getSession(session.id)).resolves.toMatchObject({ name: 'Restored generation' })
      await expect(harness.repository.migrateSession(session.id)).resolves.toBe('migrated')
      await expect(harness.rows.getRevision(session.id)).resolves.toBe(3)

      await expect(
        harness.repository.setSession({ ...staleSnapshot, name: 'Stale overwrite' }, { baseSession: staleSnapshot })
      ).rejects.toMatchObject({
        name: 'SessionWriteConflictError',
        expectedRevision: 1,
        actualRevision: 3,
      })
      await expect(harness.repository.getSession(session.id)).resolves.toMatchObject({ name: 'Restored generation' })
    })
  })
})
