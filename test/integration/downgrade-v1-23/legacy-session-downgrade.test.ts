import 'fake-indexeddb/auto'
import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { createSessionMetaRecord } from '@chatbox/core/application/session'
import type { SessionMetaRepositoryPort, SessionRowStorePort } from '@chatbox/core/ports'
import type { ResourceReference } from '@chatbox/core/resources'
import type { Message, Session, SessionMetaRecord } from '@shared/types'
import localforage from 'localforage'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNodeSessionRowDatabase } from '../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../../../packages/chatbox-core/src/persistence/session-row-sql'
import type { Storage } from '../../../src/renderer/platform/interfaces'
import { importReleased, RELEASED_TAG, releasedCommit } from './released-source'

const backend = vi.hoisted(() => ({ current: null as Storage | null }))

vi.mock('@/platform', () => {
  const active = () => {
    if (!backend.current) throw new Error('No storage backend selected')
    return backend.current
  }
  return {
    default: {
      isDesktopLike: true,
      getStorageType: () => active().getStorageType(),
      getStoreValue: (key: string) => active().getStoreValue(key),
      setStoreValue: (key: string, value: unknown) => active().setStoreValue(key, value),
      delStoreValue: (key: string) => active().delStoreValue(key),
      getAllStoreKeys: () => active().getAllStoreKeys(),
    },
  }
})
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))

import { CurrentSessionRepository } from '@/adapters/CurrentSessionRepository'
import { IndexedDBStorage, MobileSQLiteStorage } from '@/platform/storages'
import BaseStorage from '@/storage/BaseStorage'
import { IndexedDBSessionRowStore } from '@/storage/SessionRowStorage'

interface ReleasedSessionUtils {
  migrateSession(session: Session): Session
}
interface ReleasedSearch {
  searchSessionMessages(session: Session, query: string): Message[]
}
interface ReleasedResources {
  collectSessionResourceReferences(session: Session): { references: Array<{ storageKey: string }> }
}

interface Backend {
  storage: Storage
  rows: SessionRowStorePort
  readRaw(key: string): Promise<string | null>
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  backend.current = null
})

async function desktopBackend(): Promise<Backend> {
  const storage = new IndexedDBStorage()
  const raw = localforage.createInstance({ name: 'chatboxstore' })
  await raw.clear()
  const rows = new IndexedDBSessionRowStore()
  cleanups.push(() => raw.clear())
  return { storage, rows, readRaw: (key) => raw.getItem<string>(key) }
}

async function capacitorBackend(): Promise<Backend> {
  const database = openNodeSessionRowDatabase()
  const rowDatabase = openNodeSessionRowDatabase()
  cleanups.push(() => database.close())
  cleanups.push(() => rowDatabase.close())
  const connection = {
    execute: async (sql: string) => {
      await database.execute(sql)
      return { changes: { changes: 0 } }
    },
    query: async (sql: string, values: Array<string | number | null> = []) => ({
      values: await database.query(sql, values),
    }),
    run: (sql: string, values: Array<string | number | null>) => database.query(sql, values),
    executeSet: (batch: Array<{ statement: string; values: Array<string | number | null> }>) =>
      database.executeBatch(batch.map(({ statement, values }) => ({ sql: statement, params: values }))),
  }
  const storage = new MobileSQLiteStorage(connection as unknown as SQLiteDBConnection)
  return {
    storage,
    rows: new SqlSessionRowStore(rowDatabase),
    readRaw: async (key) =>
      (await database.query<{ value: string }>('SELECT value FROM key_value WHERE key = ?', [key]))[0]?.value ?? null,
  }
}

function createMetaStorage(): SessionMetaRepositoryPort {
  const records = new Map<string, SessionMetaRecord>()
  const sorted = () => [...records.values()].sort((a, b) => a.sortOrder - b.sortOrder)
  return {
    initialize: async () => {},
    create: async (record) => {
      records.set(record.id, structuredClone(record))
    },
    createMany: async (list) => {
      for (const record of list) records.set(record.id, structuredClone(record))
    },
    update: async (id, updates) => {
      const previous = records.get(id)
      if (!previous) return null
      const next = { ...previous, ...updates }
      records.set(id, next)
      return next
    },
    getById: async (id) => structuredClone(records.get(id) ?? null),
    delete: async (id) => {
      records.delete(id)
    },
    deleteMany: async (ids) => {
      for (const id of ids) records.delete(id)
    },
    getAll: async () => sorted().filter((record) => !record.hidden),
    getAllIncludingHidden: async () => sorted(),
    getArchived: async () => [],
    getArchivedPage: async () => ({ items: [], nextCursor: null, total: 0 }),
    getPage: async (cursor, limit = 30) => {
      const visible = sorted().filter((record) => !record.hidden)
      const items = visible.slice(cursor, cursor + limit)
      return { items, nextCursor: cursor + limit < visible.length ? cursor + limit : null, total: visible.length }
    },
    getTotal: async () => [...records.values()].filter((record) => !record.hidden).length,
    getAllTotal: async () => records.size,
    getArchivedTotal: async () => 0,
    clear: async () => records.clear(),
  }
}

const text = (value: string) => [{ type: 'text' as const, text: value }]

/** Sessions as v1.23.5 stores them: whole blobs with threads, forks and attachment references. */
function releasedSessions(): Session[] {
  return [
    {
      id: 'pre',
      name: 'Before upgrade',
      type: 'chat',
      threadName: 'Current',
      messages: [
        {
          id: 'pre-user',
          role: 'user',
          timestamp: 1,
          contentParts: [...text('hello kept'), { type: 'image', storageKey: 'picture:pre' }],
        },
        { id: 'pre-assistant', role: 'assistant', timestamp: 2, contentParts: text('kept answer') },
      ],
      threads: [
        {
          id: 'pre-thread',
          name: 'Archived',
          createdAt: 0,
          messages: [
            {
              id: 'pre-thread-user',
              role: 'user',
              timestamp: 0,
              contentParts: text('archived'),
              files: [{ id: 'f', name: 'notes.pdf', fileType: 'application/pdf', storageKey: 'file:pre-thread' }],
            },
          ],
        },
      ],
      messageForksHash: {
        'pre-assistant': {
          position: 0,
          createdAt: 3,
          lists: [
            {
              id: 'fork',
              messages: [
                {
                  id: 'pre-fork',
                  role: 'assistant',
                  timestamp: 3,
                  contentParts: text('fork answer'),
                  links: [{ id: 'l', url: 'https://example.com', title: 'Example', storageKey: 'parseUrl-pre-fork' }],
                },
              ],
            },
          ],
        },
      },
    },
    {
      id: 'edited',
      name: 'Edited later',
      type: 'chat',
      threadName: '',
      messages: [
        {
          id: 'edited-user',
          role: 'user',
          timestamp: 10,
          contentParts: [...text('hello edited'), { type: 'image', storageKey: 'picture:edited-old' }],
        },
      ],
    },
    {
      id: 'deleted',
      name: 'Deleted later',
      type: 'chat',
      threadName: '',
      messages: [
        {
          id: 'deleted-user',
          role: 'user',
          timestamp: 20,
          contentParts: [...text('hello deleted'), { type: 'image', storageKey: 'picture:deleted' }],
        },
      ],
    },
  ]
}

/** The v1.23.5 reads a reinstalled release performs on this storage. */
async function releasedReader(storage: Storage, meta: SessionMetaRepositoryPort) {
  const sessionUtils = await importReleased<ReleasedSessionUtils>('src/renderer/utils/session-utils.ts')
  const search = await importReleased<ReleasedSearch>('src/shared/services/native-session-search.ts')
  const resources = await importReleased<ReleasedResources>('src/renderer/packages/backup/resources.ts')
  // v1.23.5 BaseStorage.getItem: a missing value is replaced by the initial value and written back.
  const getItem = async <T>(key: string, initialValue: T): Promise<T> => {
    const value = await storage.getStoreValue(key)
    if (value === undefined || value === null) {
      await storage.setStoreValue(key, initialValue)
      return initialValue
    }
    return value as T
  }
  return {
    // v1.23.5 CurrentSessionRepository.getSession
    async getSession(id: string) {
      const value = await getItem<Session | null>(`session:${id}`, null)
      return value ? sessionUtils.migrateSession(value) : null
    },
    async listIds() {
      return (await meta.getAll()).map((record) => record.id)
    },
    // v1.23.5 sessionHelpers.searchSessions without a session filter
    async search(query: string) {
      const hits: string[] = []
      let cursor: number | null = 0
      while (cursor !== null) {
        const page = await meta.getPage(cursor, 30)
        for (const record of page.items) {
          const session = await getItem<Session | null>(`session:${record.id}`, null)
          if (!session) continue
          for (const message of search.searchSessionMessages(sessionUtils.migrateSession(session), query))
            hits.push(message.id)
        }
        cursor = page.nextCursor
      }
      return hits
    },
    // v1.23.5 storage_clear reference scan: keys outside this set are deleted as orphans.
    async referencedKeys() {
      const keys = new Set<string>()
      for (const record of await meta.getAllIncludingHidden()) {
        const session = await getItem<Session | null>(`session:${record.id}`, null)
        if (!session) continue
        for (const reference of resources.collectSessionResourceReferences(session).references)
          keys.add(reference.storageKey)
      }
      return keys
    },
  }
}

function createRepository(meta: SessionMetaRepositoryPort, rows: SessionRowStorePort) {
  return new CurrentSessionRepository({ dataStorage: new BaseStorage(), metaStorage: meta, rowStore: rows })
}

/** One background migration pass, as the startup trickle runs it. */
async function migrateAll(repository: CurrentSessionRepository) {
  const migrated: string[] = []
  for (const candidate of await repository.listSessionMigrationCandidates()) {
    if (!(await repository.requiresSessionMigration(candidate))) continue
    await repository.migrateSession(candidate.id)
    migrated.push(candidate.id)
  }
  return migrated.sort()
}

/** Keys the new version's orphan cleanup keeps: references of the listed sessions' rows only. */
async function currentReferencedKeys(repository: CurrentSessionRepository, meta: SessionMetaRepositoryPort) {
  const references: ResourceReference[] = []
  for (const record of await meta.getAllIncludingHidden())
    for await (const reference of repository.iterateSessionResourceReferences(record.id)) references.push(reference)
  return new Set(references.map((reference) => reference.storageKey))
}

describe.skipIf(!releasedCommit)(`downgrade to ${RELEASED_TAG} after upgrading`, () => {
  it.each([
    ['desktop and web (localforage / IndexedDB)', desktopBackend],
    ['Capacitor (SQLite key_value)', capacitorBackend],
  ])('%s keeps pre-upgrade sessions readable and post-upgrade changes safe', async (_name, createBackend) => {
    const { storage, rows, readRaw } = await createBackend()
    backend.current = storage
    const meta = createMetaStorage()

    // A v1.23.5 profile.
    const seeded = releasedSessions()
    for (const [index, session] of seeded.entries()) {
      await storage.setStoreValue(`session:${session.id}`, session)
      await meta.create(createSessionMetaRecord(session, index, index))
    }
    const before = await releasedReader(storage, meta)
    const expectedPre = await before.getSession('pre')
    const expectedEdited = await before.getSession('edited')
    const preBytes = await readRaw('session:pre')
    const editedBytes = await readRaw('session:edited')
    expect(preBytes).not.toBeNull()

    // Upgrade: migration, edits, a new session and a deletion.
    const writes = vi.spyOn(storage, 'setStoreValue')
    const repository = createRepository(meta, rows)
    await repository.initialize()
    expect(await migrateAll(repository)).toEqual(['deleted', 'edited', 'pre'])
    await repository.executeSessionCommand('edited', {
      type: 'update',
      messageId: 'edited-user',
      updater: (message) => ({ ...message, contentParts: text('hello edited without picture') }),
    })
    await repository.executeSessionCommand('edited', {
      type: 'append',
      messages: [
        {
          id: 'edited-new',
          role: 'user',
          timestamp: 30,
          contentParts: [...text('after upgrade'), { type: 'image', storageKey: 'picture:after-upgrade' }],
        },
      ],
    })
    await repository.executeSessionCommand('edited', { type: 'header', updater: { name: 'Renamed after upgrade' } })
    const created = await repository.createSessionRows({ id: 'created', name: 'Created after upgrade', type: 'chat' }, [
      { id: 'created-user', role: 'user', timestamp: 40, contentParts: text('hello created') },
    ])
    await meta.create(createSessionMetaRecord(created.header, 3, 40))
    await repository.deleteSession('deleted', () => meta.delete('deleted'))
    expect(await migrateAll(repository)).toEqual([])

    expect(writes.mock.calls.filter(([key]) => key.startsWith('session:'))).toEqual([])
    expect(await readRaw('session:pre')).toBe(preBytes)
    expect(await readRaw('session:edited')).toBe(editedBytes)
    expect(await readRaw('session:deleted')).toBeNull()
    expect(await readRaw('session:created')).toBeNull()

    const currentKeys = await currentReferencedKeys(repository, meta)
    // Attachments that only the frozen v1.23.5 record references (picture:edited-old) are not protected.
    for (const key of ['picture:pre', 'file:pre-thread', 'parseUrl-pre-fork', 'picture:after-upgrade'])
      expect(currentKeys).toContain(key)
    expect(currentKeys).not.toContain('picture:deleted')

    // Reinstall v1.23.5 over the same data.
    const released = await releasedReader(storage, meta)
    expect(await released.listIds()).toEqual(['pre', 'edited', 'created'])
    expect(await released.getSession('pre')).toEqual(expectedPre)
    expect(await released.getSession('edited')).toEqual(expectedEdited)
    expect(await released.getSession('created')).toBeNull()
    expect((await released.search('hello')).sort()).toEqual(['edited-user', 'pre-user'])
    const releasedKeys = await released.referencedKeys()
    for (const key of ['picture:pre', 'file:pre-thread', 'parseUrl-pre-fork', 'picture:edited-old'])
      expect(releasedKeys).toContain(key)

    // Upgrade again over what v1.23.5 left behind (it writes null for sessions it could not read).
    const reupgraded = createRepository(meta, rows)
    await reupgraded.initialize()
    expect(await migrateAll(reupgraded)).toEqual([])
    expect((await reupgraded.getSessionHeader('edited'))?.header.name).toBe('Renamed after upgrade')
    expect((await reupgraded.getSessionHeader('created'))?.header.name).toBe('Created after upgrade')
    expect(await reupgraded.getSessionHeader('deleted')).toBeNull()
    expect(await currentReferencedKeys(reupgraded, meta)).toEqual(currentKeys)
    expect(await readRaw('session:pre')).toBe(preBytes)
  })
})
