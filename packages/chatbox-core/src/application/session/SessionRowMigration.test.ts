import { describe, expect, it, vi } from 'vitest'
import { type SessionRowCommit, type SessionRowSnapshot, SessionRowConflictError } from '../../ports/session-row-store'
import { verifySessionTreeRoundTrip } from '../../session/session-tree/verify'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import type { Session } from '../../types/session'
import { convertLegacyTreeToRowFormat } from './compatibility/row-format'
import { SessionRowMigration } from './SessionRowMigration'
import { SessionRowWriteQueue } from './SessionRowWriteQueue'

const source: Session = {
  id: 'session',
  type: 'chat',
  name: 'Conversation',
  messages: [{ id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] }],
}

function snapshot(session = source, revision = 1): SessionRowSnapshot {
  const result = verifySessionTreeRoundTrip(session, { activeThreadId: session.id, now: 1 })
  if (!result.ok) throw new Error(result.reason)
  return {
    record: result.tree.session,
    revision,
    rows: { sessionId: session.id, threads: result.tree.threads, messages: result.tree.messages },
  }
}

function setup() {
  const records = new InMemorySessionRecordStore()
  const storage = new InMemorySessionRowStore()
  // The fixture exposes commit metadata independently from the migration's row-write port.
  const rows = {
    readCommit: vi.fn(async (id: string): Promise<SessionRowCommit | null> => {
      const current = await storage.readSnapshot(id)
      return current ? { record: current.record, revision: current.revision } : null
    }),
    getRevision: vi.fn(storage.getRevision.bind(storage)),
    writeRows: vi.fn(storage.writeRows.bind(storage)),
    readSnapshot: vi.fn(storage.readSnapshot.bind(storage)),
  }
  const writes = new SessionRowWriteQueue((_sessionId, operation) => operation())
  const migration = new SessionRowMigration(records, rows, writes, () => 1)
  return { records, storage, rows, writes, migration }
}

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('row publication and migration', () => {
  it('reports unpublished rows whose original input is missing', async () => {
    const { storage, migration, rows } = setup()
    await storage.writeRows(snapshot())
    await expect(migration.ensureRows(source.id)).rejects.toMatchObject({ stage: 'source' })
    expect(rows.writeRows).not.toHaveBeenCalled()
  })

  it('repairs duplicate IDs and unreachable branch records at the conversion boundary', async () => {
    const { records, storage, migration } = setup()
    const legacy: Session = {
      ...source,
      threads: [{ id: source.id, name: 'Earlier', createdAt: 1, messages: source.messages }],
      messageForksHash: {
        missing: { createdAt: 1, position: 0, lists: [{ id: 'orphan', messages: source.messages }] },
      },
    }
    await records.setRecord(legacy)
    await migration.ensureRows(source.id)
    const current = await storage.readSnapshot(source.id)
    expect(current?.rows.threads).toHaveLength(2)
    expect(current?.rows.messages).toHaveLength(2)
    expect(new Set(current?.rows.messages.map((row) => row.messageId)).size).toBe(2)
    expect(current?.rows.messages.map((row) => row.message.contentParts)).toEqual([
      source.messages[0].contentParts,
      source.messages[0].contentParts,
    ])
  })

  it('keeps invalid legacy message content unpublished and preserves its source', async () => {
    const { records, rows, storage, migration } = setup()
    const invalid = {
      ...source,
      messages: [{ id: 'user', role: 'user', contentParts: [{ type: 'text', text: 99 }] }],
    } as unknown as Session
    await records.setRecord(invalid)
    await expect(migration.ensureRows(source.id)).rejects.toMatchObject({
      stage: 'validation',
      cause: { message: expect.stringContaining('invalid message user') },
    })
    expect(rows.writeRows).not.toHaveBeenCalled()
    expect(await storage.readSnapshot(source.id)).toBeNull()
    expect(await records.getRecord(source.id)).toEqual(invalid)
  })

  it('normalizes old content before message validation and retains extension fields', async () => {
    const { records, storage, migration } = setup()
    const legacy = {
      ...source,
      messages: [{ id: 'user', role: 'user', content: 99, extension: { preserved: true } }],
    } as unknown as Session
    await records.setRecord(legacy)
    await migration.ensureRows(source.id)
    const current = await storage.readSnapshot(source.id)
    expect(current?.rows.messages[0].message).toMatchObject({
      contentParts: [{ type: 'text', text: '99' }],
      extension: { preserved: true },
    })
  })

  it('publishes valid legacy input into real row storage before projecting the record', async () => {
    const { records, rows, storage, migration } = setup()
    await records.setRecord(source)
    const result = await migration.ensureRows(source.id)
    expect(result).toMatchObject({ revision: 1, record: { id: source.id, rowAuthority: 1 } })
    expect((await storage.readSnapshot(source.id))?.rows.messages[0].message).toEqual(source.messages[0])
    expect(await records.getRecord(source.id)).toEqual(result?.record)
    expect(rows.writeRows).toHaveBeenCalledTimes(1)
  })

  it('rebuilds an unpublished candidate from the original input with fresh CAS', async () => {
    const { records, rows, storage, migration } = setup()
    await records.setRecord(source)
    await storage.writeRows(snapshot({ ...source, name: 'Incomplete candidate', messages: [] }, 4))
    const result = await migration.ensureRows(source.id)
    expect(result).toMatchObject({ revision: 5, record: { name: source.name, rowAuthority: 1 } })
    expect(rows.writeRows.mock.calls[0][1]).toBe(4)
    expect((await storage.readSnapshot(source.id))?.rows.messages).toHaveLength(1)
  })

  it.each([undefined, 1] as const)(
    'upgrades unversioned published rows once with rowAuthority %s',
    async (rowAuthority) => {
      const { records, rows, storage, migration } = setup()
      const published = snapshot()
      if (rowAuthority !== undefined) published.record.rowAuthority = rowAuthority
      expect(published.record.rowFormatVersion).toBeUndefined()
      await storage.writeRows(published)
      await records.setRecord(published.record)

      const result = await migration.ensureRows(source.id)
      expect(result).toMatchObject({ revision: 2, record: { rowAuthority: 1, rowFormatVersion: 3 } })
      expect(rows.readSnapshot).toHaveBeenCalledTimes(1)
      expect(rows.writeRows).toHaveBeenCalledTimes(1)
      expect(rows.writeRows.mock.calls[0][1]).toBe(1)
      expect((await storage.readSnapshot(source.id))?.rows.messages[0].message).toEqual(source.messages[0])
      expect(await records.getRecord(source.id)).toEqual(result?.record)

      rows.readSnapshot.mockClear()
      rows.writeRows.mockClear()
      expect(await migration.ensureRows(source.id)).toMatchObject({ revision: 2 })
      expect(rows.readSnapshot).not.toHaveBeenCalled()
      expect(rows.writeRows).not.toHaveBeenCalled()
    }
  )

  it('keeps committed rows authoritative if the external projection fails', async () => {
    const { records, rows, storage, migration } = setup()
    await records.setRecord(source)
    const setRecord = vi.spyOn(records, 'setRecord').mockRejectedValueOnce(new Error('Projection unavailable'))
    expect(await migration.ensureRows(source.id)).toMatchObject({
      revision: 1,
      recordProjectionError: expect.any(Error),
    })
    const committed = await storage.readSnapshot(source.id)
    if (!committed) throw new Error('Missing commit')
    await storage.applyDiff(
      { sessionId: source.id, threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
      { record: { ...committed.record, name: 'New name' }, revision: 2 },
      1
    )
    const readRecord = vi.spyOn(records, 'getRecord')
    expect(await migration.ensureRows(source.id)).toMatchObject({ revision: 2, record: { name: 'New name' } })
    expect(readRecord).not.toHaveBeenCalled()
    expect(rows.writeRows).toHaveBeenCalledTimes(1)
    expect(await migration.repairRecordProjection(source.id)).toMatchObject({ revision: 2 })
    expect(setRecord).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'New name' }))
  })

  it('recognizes an atomic write whose acknowledgement failed', async () => {
    const { records, rows, storage, migration } = setup()
    await records.setRecord(source)
    rows.writeRows.mockImplementationOnce(async (candidate, revision) => {
      await storage.writeRows(candidate, revision)
      throw new Error('Acknowledgement lost')
    })
    expect(await migration.ensureRows(source.id)).toMatchObject({ revision: 1, record: { rowAuthority: 1 } })
  })

  it('returns the concurrent published winner after CAS without overwriting it', async () => {
    const { records, rows, storage, migration } = setup()
    await records.setRecord(source)
    rows.writeRows.mockImplementationOnce(async () => {
      const winner = snapshot({ ...source, name: 'Winner' })
      const converted = convertLegacyTreeToRowFormat({ session: winner.record, ...winner.rows })
      await storage.writeRows(
        {
          ...winner,
          record: converted.session,
          rows: { sessionId: source.id, threads: converted.threads, messages: converted.messages },
        },
        null
      )
      throw new SessionRowConflictError(source.id, null, 1)
    })
    expect(await migration.ensureRows(source.id)).toMatchObject({ record: { name: 'Winner' } })
    expect(rows.writeRows).toHaveBeenCalledTimes(1)
  })

  it('preserves the source on failed publication and rereads it on retry', async () => {
    const { records, rows, migration } = setup()
    await records.setRecord(source)
    rows.writeRows.mockRejectedValueOnce(new Error('Disk full'))
    await expect(migration.ensureRows(source.id)).rejects.toMatchObject({ stage: 'publication' })
    expect(await records.getRecord(source.id)).toEqual(source)
    await records.setRecord({ ...source, name: 'Updated original' })
    expect(await migration.ensureRows(source.id)).toMatchObject({ record: { name: 'Updated original' } })
  })

  it('does not replace a published marker when its rows are missing', async () => {
    const { records, rows, migration } = setup()
    const marker = snapshot().record
    await records.setRecord(marker)
    await expect(migration.ensureRows(source.id)).rejects.toMatchObject({ stage: 'source' })
    expect(await records.getRecord(source.id)).toEqual(marker)
    expect(rows.writeRows).not.toHaveBeenCalled()
  })

  it('serializes a delayed projection with later header updates', async () => {
    const { records, storage, migration, writes } = setup()
    await records.setRecord(source)
    await migration.ensureRows(source.id)
    const entered = deferred()
    const release = deferred()
    const original = records.setRecord.bind(records)
    vi.spyOn(records, 'setRecord').mockImplementationOnce(async (record) => {
      entered.resolve()
      await release.promise
      await original(record)
    })
    const repair = migration.repairRecordProjection(source.id)
    await entered.promise
    const edit = writes.run(source.id, async () => {
      const current = await storage.readSnapshot(source.id)
      if (!current) throw new Error('Missing commit')
      const commit = { record: { ...current.record, name: 'Latest' }, revision: 2 }
      await storage.applyDiff(
        { sessionId: source.id, threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
        commit,
        1
      )
      await records.setRecord(commit.record)
    })
    release.resolve()
    await Promise.all([repair, edit])
    expect(await records.getRecord(source.id)).toMatchObject({ name: 'Latest' })
  })

  it('does not resurrect a record when deletion follows a delayed repair', async () => {
    const { records, storage, migration, writes } = setup()
    await records.setRecord(source)
    await migration.ensureRows(source.id)
    const entered = deferred()
    const release = deferred()
    const original = records.setRecord.bind(records)
    vi.spyOn(records, 'setRecord').mockImplementationOnce(async (record) => {
      entered.resolve()
      await release.promise
      await original(record)
    })
    const repair = migration.repairRecordProjection(source.id)
    await entered.promise
    const deletion = writes.run(source.id, async () => {
      await storage.deleteRows(source.id)
      await records.removeRecord(source.id)
    })
    release.resolve()
    await Promise.all([repair, deletion])
    expect(await migration.repairRecordProjection(source.id)).toBeNull()
    expect(await records.getRecord(source.id)).toBeNull()
  })
})
