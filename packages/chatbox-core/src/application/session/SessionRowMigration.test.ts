import { describe, expect, it, vi } from 'vitest'
import { type SessionRowSnapshot, SessionRowConflictError } from '../../ports/session-row-store'
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
  const converted = convertLegacyTreeToRowFormat(result.tree, result.session.messageForksHash)
  return {
    record: converted.session,
    revision,
    rows: { sessionId: session.id, threads: converted.threads, messages: converted.messages },
  }
}

function setup() {
  const records = new InMemorySessionRecordStore()
  const storage = new InMemorySessionRowStore()
  const rows = {
    readCommit: vi.fn(storage.readCommit.bind(storage)),
    getRevision: vi.fn(storage.getRevision.bind(storage)),
    writeRows: vi.fn(storage.writeRows.bind(storage)),
  }
  const writes = new SessionRowWriteQueue((_sessionId, operation) => operation())
  const migration = new SessionRowMigration(records, rows, writes, () => 1)
  return { records, storage, rows, writes, migration }
}

describe('row publication and migration', () => {
  it.each(['rowAuthority', 'rowFormatVersion'] as const)(
    'rejects a commit missing %s before reading or overwriting legacy input',
    async (field) => {
      const { records, migration, rows } = setup()
      await records.setRecord(source)
      const candidate = snapshot()
      delete candidate.record[field]
      rows.readCommit.mockResolvedValue({ record: candidate.record, revision: candidate.revision })
      const readRecord = vi.spyOn(records, 'getRecord')
      await expect(migration.ensureRows(source.id)).rejects.toMatchObject({ stage: 'source' })
      expect(readRecord).not.toHaveBeenCalled()
      expect(rows.writeRows).not.toHaveBeenCalled()
      expect(await records.getRecord(source.id)).toEqual(source)
    }
  )

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

  it('publishes valid legacy input into real row storage and leaves the source record unchanged', async () => {
    const { records, rows, storage, migration } = setup()
    await records.setRecord(source)
    const result = await migration.ensureRows(source.id)
    expect(result).toMatchObject({ revision: 1, record: { id: source.id, rowAuthority: 1 } })
    expect((await storage.readSnapshot(source.id))?.rows.messages[0].message).toEqual(source.messages[0])
    expect(await records.getRecord(source.id)).toEqual(source)
    expect(rows.writeRows).toHaveBeenCalledTimes(1)
  })

  it('opens current rows from commit metadata without reading legacy input or all message bodies', async () => {
    const { records, rows, storage, migration } = setup()
    await storage.writeRows(snapshot())
    const readRecord = vi.spyOn(records, 'getRecord')
    const readSnapshot = vi.spyOn(storage, 'readSnapshot')
    expect(await migration.ensureRows(source.id)).toMatchObject({
      revision: 1,
      record: { rowAuthority: 1, rowFormatVersion: 3 },
    })
    expect(readRecord).not.toHaveBeenCalled()
    expect(readSnapshot).not.toHaveBeenCalled()
    expect(rows.writeRows).not.toHaveBeenCalled()
  })

  it('keeps committed rows authoritative over the unchanged source record', async () => {
    const { records, rows, storage, migration } = setup()
    await records.setRecord(source)
    const setRecord = vi.spyOn(records, 'setRecord')
    expect(await migration.ensureRows(source.id)).toMatchObject({ revision: 1 })
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
    expect(setRecord).not.toHaveBeenCalled()
    expect(await records.getRecord(source.id)).toEqual(source)
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
      await storage.writeRows(winner, null)
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
})
