import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionEventBus } from '../application/session/session-events'
import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import { SessionRowWriteQueue } from '../application/session/SessionRowWriteQueue'
import { SessionService } from '../application/session/SessionService'
import { SessionWriteCoordinator } from '../application/session/SessionWriteCoordinator'
import type { SessionRepositoryPort } from '../ports'
import { InMemorySessionRepository } from '../testing/InMemorySessionRepository'
import { InMemorySessionRecordStore } from './memory-session-record-store'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

/** Session rows persisted in SQLite, with list metadata kept in memory. */
function sqlBackedService() {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const rows = new RowBackedSessionRepository({
    rows: new SqlSessionRowStore(database, undefined, { readByteBudget: 'none' }),
    records: new InMemorySessionRecordStore(),
    writes: new SessionRowWriteQueue((_id, run) => run()),
  })
  const metadata = new InMemorySessionRepository()
  const repository: SessionRepositoryPort = Object.assign(Object.create(rows) as RowBackedSessionRepository, {
    meta: metadata.meta,
  })
  let id = 0
  const service = new SessionService(repository, new SessionWriteCoordinator(repository), new SessionEventBus(), {
    createId: () => `id-${++id}`,
    now: () => 100,
  })
  return { metadata, repository, service }
}

describe('archive state with SQLite session rows', () => {
  it('clears the archive timestamp from list metadata when a session is restored', async () => {
    const { metadata, repository, service } = sqlBackedService()
    const session = await service.createSession({ name: 'Archived', type: 'chat', messages: [], settings: {} })

    await service.archiveSession(session.id)
    expect(metadata.records.get(session.id)).toMatchObject({ hidden: true, archivedAt: 100 })
    expect((await service.listArchivedSessionsMetaPage(0, 10)).items.map((item) => item.id)).toEqual([session.id])

    await service.restoreSession(session.id)
    expect((await repository.getSessionHeader(session.id))?.header).toMatchObject({ hidden: false })
    expect(metadata.records.get(session.id)?.archivedAt).toBeUndefined()
    expect((await service.listArchivedSessionsMetaPage(0, 10)).items).toEqual([])
  })

  it('clears the folder from list metadata when a session leaves its folder', async () => {
    const { metadata, service } = sqlBackedService()
    const session = await service.createSession({ name: 'Filed', type: 'chat', messages: [], settings: {} })

    await service.moveSessionToFolder(session.id, 'folder-1')
    expect(metadata.records.get(session.id)?.folderId).toBe('folder-1')

    await service.moveSessionToFolder(session.id, undefined)
    expect(metadata.records.get(session.id)?.folderId).toBeUndefined()
  })

  it('reconciles stale archived metadata once and keeps recovery archives', async () => {
    const { metadata, repository, service } = sqlBackedService()
    const restored = await service.createSession({ name: 'Restored', type: 'chat', messages: [], settings: {} })
    const recovery = await service.createSession({ name: 'Recovery', type: 'chat', messages: [], settings: {} })
    const archived = await service.createSession({ name: 'Archived', type: 'chat', messages: [], settings: {} })
    await service.archiveSession(archived.id)
    await service.archiveSessionWithoutLoading(recovery.id)
    // Metadata left behind by a restore whose projection kept the old archive and folder.
    await metadata.meta.update(restored.id, { hidden: false, archivedAt: 300, folderId: 'old-folder' })
    const headerReads = vi.spyOn(repository, 'getSessionHeader')

    // The stale row sorts first; dropping it shifts the following rows up by one.
    const first = await service.listArchivedSessionsMetaPage(0, 2)
    expect(first).toMatchObject({ nextCursor: 1, total: 2 })
    const second = await service.listArchivedSessionsMetaPage(first.nextCursor ?? 0, 2)
    expect([...first.items, ...second.items].map((item) => item.id).sort()).toEqual([archived.id, recovery.id].sort())
    expect(metadata.records.get(restored.id)?.hidden).toBeFalsy()
    expect(metadata.records.get(restored.id)?.archivedAt).toBeUndefined()
    expect(metadata.records.get(restored.id)?.folderId).toBeUndefined()
    expect(metadata.records.get(recovery.id)).toMatchObject({ hidden: true, archivedAt: 100, recoveryArchived: true })

    headerReads.mockClear()
    const again = await service.listArchivedSessionsMetaPage(0, 2)
    expect(again.items.map((item) => item.id).sort()).toEqual([archived.id, recovery.id].sort())
    expect(headerReads).not.toHaveBeenCalled()
  })
})
