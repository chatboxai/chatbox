import { afterEach, describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { importBackupV3 } from '../backup-v3/archive'
import { getBackupImportPartialResult } from '../backup-v3/errors'
import { createSessionMetaRecord } from '../application/session/session-metadata'
import { toBackupMessage, toBackupSession, toBackupThread } from '../backup-v3/records'
import type {
  BackupBusinessRecord,
  BackupImportProjections,
  BackupImportIssue,
  BackupManifest,
  BackupResourceRecord,
  BackupWorkspace,
  BackupWarningRecord,
} from '../backup-v3/types'
import { mergeSettingsWithDefaults } from '../domain/settings'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { InMemorySessionRecordStore } from '../persistence/memory-session-record-store'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import type { SessionMetaRepositoryPort } from '../ports/session-repository'
import { InMemoryKeyValueStorage } from '../testing/InMemoryKeyValueStorage'
import type { SessionMetaRecord } from '../types'
import { cleanupBackupImport, createBackupExportSource, createBackupImportTarget } from './host'
import { GLOBAL_KEYS } from './globals'
import type { BackupHostOptions, BackupHostResources } from './types'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
})
const manifest: BackupManifest = {
  format: 'chatbox-backup',
  formatVersion: 3,
  layout: 'rows',
  archiveId: 'archive',
  createdAt: '2026-10-21T00:00:00Z',
  producer: 'test',
  selection: { sessions: true, settings: false, copilots: false, credentials: false },
}
const fixture = (id = 's', text = 'body') =>
  contextSnapshot({
    id,
    name: text,
    messages: [
      { id: `${id}:a`, role: 'user', contentParts: [{ type: 'text', text }] },
      { id: `${id}:b`, role: 'assistant', contentParts: [{ type: 'text', text: 'reply' }] },
    ],
  })
const backupRecords = (snapshot: ReturnType<typeof fixture>): BackupBusinessRecord[] => [
  { type: 'session', session: toBackupSession(snapshot.record) },
  ...snapshot.rows.threads.map((thread) => ({ type: 'thread' as const, thread: toBackupThread(thread) })),
  ...snapshot.rows.messages.map((message) => ({ type: 'message' as const, message: toBackupMessage(message) })),
]
const descriptor = (key: string): BackupResourceRecord => ({
  type: 'resource',
  resourceId: key,
  path: 'resources/000000.bin',
  mimeType: 'text/plain',
  contentType: 'text',
  size: 3,
})
function setup() {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const rows = new SqlSessionRowStore(database),
    storage = new InMemoryKeyValueStorage(),
    records = new InMemorySessionRecordStore()
  const meta = new Map<string, SessionMetaRecord>(),
    tables = new Map<string, Map<string, string>>()
  const metadata: SessionMetaRepositoryPort = {
    async initialize() {},
    async create(row) {
      if (meta.has(row.id)) throw new Error('Session metadata already exists')
      meta.set(row.id, structuredClone(row))
    },
    async createMany(rows) {
      for (const row of rows) meta.set(row.id, structuredClone(row))
    },
    async update(id, updates) {
      const previous = meta.get(id)
      if (!previous) return null
      const next = { ...previous, ...updates }
      meta.set(id, next)
      return next
    },
    async getById(id) {
      return structuredClone(meta.get(id) ?? null)
    },
    async delete(id) {
      meta.delete(id)
    },
    async deleteMany(ids) {
      for (const id of ids) meta.delete(id)
    },
    async getAll() {
      return [...meta.values()]
    },
    async getAllIncludingHidden() {
      return [...meta.values()]
    },
    async getArchived() {
      return []
    },
    async getArchivedPage() {
      return { items: [], nextCursor: null, total: 0 }
    },
    async getPage() {
      return { items: [...meta.values()], nextCursor: null, total: meta.size }
    },
    async getTotal() {
      return meta.size
    },
    async getAllTotal() {
      return meta.size
    },
    async getArchivedTotal() {
      return 0
    },
    async clear() {
      meta.clear()
    },
  }
  const workspace: BackupWorkspace = {
    async createFile() {
      throw new Error('File operation not used by host fixture')
    },
    async openFile() {
      throw new Error('File operation not used by host fixture')
    },
    async put(table, key, value) {
      let map = tables.get(table)
      if (!map) {
        map = new Map()
        tables.set(table, map)
      }
      if (map.has(key)) return false
      map.set(key, value)
      return true
    },
    async get(table, key) {
      return tables.get(table)?.get(key) ?? null
    },
    async *entries(table) {
      for (const [key, value] of tables.get(table) ?? []) yield { key, value }
    },
    async dispose() {
      tables.clear()
    },
  }
  const liveResources = new Map<string, Uint8Array>(),
    candidates = new Map<string, Uint8Array>()
  const resources: BackupHostResources = {
    async open() {
      return null
    },
    async stage(_job, resource) {
      const chunks: Uint8Array[] = []
      return {
        async write(chunk) {
          chunks.push(chunk.slice())
        },
        async close() {
          const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0))
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.length
          }
          candidates.set(resource.resourceId, bytes)
        },
        async abort() {
          candidates.delete(resource.resourceId)
        },
      }
    },
    async publish(_job, key) {
      const value = candidates.get(key)
      if (!value) throw new Error('Resource candidate missing')
      liveResources.set(key, value.slice())
    },
    async cleanup() {
      candidates.clear()
    },
  }
  const options: BackupHostOptions = {
    jobId: 'job',
    workspace,
    storage,
    rows,
    records,
    metadata,
    resources,
    async ensureRows() {},
    async *listSessionIds() {
      yield* await rows.listSessionIds()
    },
    getSettings: () => mergeSettingsWithDefaults({}),
    async refresh() {},
  }
  const seed = async (snapshot: ReturnType<typeof fixture>) => {
    await rows.writeRows(snapshot)
    await metadata.create(createSessionMetaRecord(snapshot.record, 5, 123))
  }
  return { database, options, rows, storage, records, metadata, workspace, tables, resources, liveResources, seed }
}
async function resource(target: ReturnType<typeof createBackupImportTarget>, key: string, text: string) {
  const sink = await target.createResource(descriptor(key))
  await sink.write(new TextEncoder().encode(text))
  await sink.close()
}

describe('incremental backup host import', () => {
  it.each(['complete', 'cancel'])('cleans import candidates and preserves published sessions (%s)', async (outcome) => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    const controller = new AbortController()
    await target.begin(manifest, undefined, controller.signal)
    for (const id of ['A', 'B', 'C']) await target.appendRecords(backupRecords(fixture(id)))
    if (outcome === 'complete') await target.prepare()
    else {
      controller.abort()
      await expect(target.prepare()).rejects.toThrow()
    }
    await cleanupBackupImport(f.options)
    expect(await f.rows.listSessionIds()).toEqual(outcome === 'complete' ? ['A', 'B', 'C'] : ['A', 'B'])
    expect(await f.database.query('SELECT * FROM session_row_imports')).toEqual([])
    expect(await f.database.query('SELECT * FROM session_messages_staging')).toEqual([])
    expect(await f.database.query('SELECT * FROM session_threads_staging')).toEqual([])
    expect(f.tables.size).toBe(0)
  })

  it('retries resource cleanup after candidate controls have been removed', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    await f.seed(fixture('A', 'old'))
    await target.begin(manifest)
    await target.appendRecords(backupRecords(fixture('A', 'new')))
    await target.prepare()
    const cleanup = vi.spyOn(f.resources, 'cleanup').mockRejectedValueOnce(new Error('cleanup unavailable'))
    await expect(cleanupBackupImport(f.options)).rejects.toThrow('cleanup unavailable')
    expect(f.tables.get('import-candidates')?.size).toBe(1)
    expect(await f.database.query('SELECT * FROM session_row_imports')).toEqual([])
    await cleanupBackupImport(f.options)
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect((await f.rows.readCommit('A'))?.record.name).toBe('new')
    expect(f.tables.size).toBe(0)
  })

  it('disposes unusable imports and retains the existing session', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    await f.seed(fixture('A', 'old'))
    const broken = fixture('A', 'unreachable')
    for (const row of broken.rows.messages) row.parentMessageId = 'absent'
    await target.begin(manifest)
    await target.appendRecords(backupRecords(broken))
    await target.prepare()
    expect(target.getSummary().importedSessions).toBe(0)
    expect(await f.database.query('SELECT * FROM session_row_imports')).toEqual([])
    expect(await f.database.query('SELECT * FROM session_messages_staging')).toEqual([])
    await cleanupBackupImport(f.options)
    expect((await f.rows.readCommit('A'))?.record.name).toBe('old')
  })

  it('forwards converted fork projections only for their active conversation', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options),
      stage = f.rows.stageImportRows.bind(f.rows),
      prepare = vi.fn()
    vi.spyOn(f.rows, 'stageImportRows').mockImplementation(async (...args) => {
      const writer = await stage(...args),
        original = writer.prepare
      writer.prepare = (...input) => {
        prepare(...input)
        return original(...input)
      }
      return writer
    })
    await target.begin(manifest)
    await target.appendRecords(backupRecords(fixture()))
    const forks: BackupImportProjections['forks'] = new Map()
    await expect(target.prepare({ sessionId: 'another', forks })).rejects.toThrow(
      'Import projections do not match the active conversation'
    )
    expect(prepare).not.toHaveBeenCalled()
    await target.prepare({ sessionId: 's', forks })
    expect(prepare).toHaveBeenCalledExactlyOnceWith(expect.any(Function), forks)
    expect(target.getSummary()).toMatchObject({ importedSessions: 1, importedMessages: 2 })
    await target.appendRecords(backupRecords(fixture('next')))
    await target.prepare()
    expect(prepare).toHaveBeenLastCalledWith(expect.any(Function), undefined)
    await target.cleanup()
  })

  it('publishes only the global keys present in an optional-collection input', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    const localMemories = [{ id: 'local-memory', content: 'Keep', createdAt: 1 }]
    const localOwners = [{ id: 'local', name: 'Local' }]
    const localTokens = [{ id: 'local', token: 'state', retirementToken: 'lifetime' }]
    await f.storage.set(GLOBAL_KEYS.settings, { language: 'zh-Hans' })
    await f.storage.set(GLOBAL_KEYS.memories, localMemories)
    await f.storage.set(GLOBAL_KEYS.copilotMemories, { local: localMemories })
    await f.storage.set(GLOBAL_KEYS.owners, localOwners)
    await f.storage.set(GLOBAL_KEYS.tokens, localTokens)
    const set = vi.spyOn(f.storage, 'set')
    await target.begin(
      { ...manifest, selection: { ...manifest.selection, settings: true, copilots: true } },
      undefined,
      undefined,
      { includedGlobalKeys: [GLOBAL_KEYS.copilots] }
    )
    await target.appendRecords(backupRecords(fixture()))
    await target.prepare()
    expect(set).toHaveBeenCalledExactlyOnceWith(GLOBAL_KEYS.copilots, [])
    expect(await f.storage.get(GLOBAL_KEYS.settings)).toEqual({ language: 'zh-Hans' })
    expect(await f.storage.get(GLOBAL_KEYS.memories)).toEqual(localMemories)
    expect(await f.storage.get(GLOBAL_KEYS.copilotMemories)).toEqual({ local: localMemories })
    expect(await f.storage.get(GLOBAL_KEYS.owners)).toEqual(localOwners)
    expect(await f.storage.get(GLOBAL_KEYS.tokens)).toEqual(localTokens)
    expect(target.getSummary()).toMatchObject({ importedSessions: 1, importedMessages: 2, importedGlobals: 1 })
    await target.cleanup()
  })

  it('publishes explicitly empty settings and memories independently of missing optional collections', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    await f.storage.set(GLOBAL_KEYS.settings, { language: 'zh-Hans' })
    await f.storage.set(GLOBAL_KEYS.memories, [{ id: 'local', content: 'Old', createdAt: 1 }])
    await target.begin({ ...manifest, selection: { ...manifest.selection, settings: true } }, undefined, undefined, {
      includedGlobalKeys: [GLOBAL_KEYS.settings, GLOBAL_KEYS.memories],
    })
    await target.appendRecords([{ type: 'global', category: 'settings', id: 'settings', value: {} }])
    await target.prepare()
    expect(await f.storage.get(GLOBAL_KEYS.settings)).toEqual({ memoryStateToken: expect.any(String) })
    expect(await f.storage.get(GLOBAL_KEYS.memories)).toEqual([])
    expect(target.getSummary().importedGlobals).toBe(2)
    await target.cleanup()
  })

  it('publishes each complete resource and retains it after a later failure', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    f.liveResources.set('key', new TextEncoder().encode('old'))
    await target.begin(manifest)
    const first = await target.createResource(descriptor('key'))
    await first.write(new TextEncoder().encode('new'))
    expect(new TextDecoder().decode(f.liveResources.get('key'))).toBe('old')
    await first.close()
    expect(new TextDecoder().decode(f.liveResources.get('key'))).toBe('new')
    await first.close()
    expect(target.getSummary().importedResources).toBe(1)
    await cleanupBackupImport(f.options)
    expect(new TextDecoder().decode(f.liveResources.get('key'))).toBe('new')
  })

  it('commits the preceding session at the next header and discards only the unfinished candidate', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    await f.seed(fixture('A', 'old A'))
    await f.seed(fixture('B', 'old B'))
    await target.begin(manifest)
    await target.appendRecords(backupRecords(fixture('A', 'new A')))
    expect((await f.rows.readCommit('A'))?.record.name).toBe('old A')
    await target.appendRecords(backupRecords(fixture('B', 'new B')))
    expect((await f.rows.readCommit('A'))?.record.name).toBe('new A')
    expect((await f.rows.readCommit('B'))?.record.name).toBe('old B')
    expect(target.getSummary()).toMatchObject({ importedSessions: 1, importedMessages: 2 })
    await cleanupBackupImport(f.options)
    expect((await f.rows.readCommit('A'))?.record.name).toBe('new A')
    expect((await f.rows.readCommit('B'))?.record.name).toBe('old B')
  })

  it('retains a published session and actual counts when its metadata projection fails', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    await f.seed(fixture('s', 'old'))
    await target.begin(manifest)
    await target.appendRecords(backupRecords(fixture('s', 'new')))
    vi.spyOn(f.metadata, 'createMany').mockRejectedValueOnce(new Error('projection failed'))
    await expect(target.prepare()).rejects.toThrow('list could not be updated')
    expect(target.getSummary()).toMatchObject({ importedSessions: 1, importedMessages: 2 })
    await cleanupBackupImport(f.options)
    expect((await f.rows.readCommit('s'))?.record.name).toBe('new')
  })

  it('imports over a whole-session record without rewriting it', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    const legacy = { id: 'legacy', name: 'before upgrade', type: 'chat' as const, messages: [] }
    await f.records.setRecord(legacy)
    const setRecord = vi.spyOn(f.records, 'setRecord')
    await target.begin(manifest)
    await target.appendRecords([
      ...backupRecords(fixture('legacy', 'imported')),
      ...backupRecords(fixture('new', 'saved rows')),
    ])
    await target.prepare()
    expect(setRecord).not.toHaveBeenCalled()
    expect(await f.records.getRecord('legacy')).toEqual(legacy)
    expect(await f.records.getRecord('new')).toBeNull()
    expect(await f.metadata.getById('new')).toMatchObject({ id: 'new', name: 'saved rows' })
    await cleanupBackupImport(f.options)
    expect((await f.rows.readCommit('new'))?.record.name).toBe('saved rows')
  })

  it('validates the global collection before writing and retains earlier keys on a storage failure', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    await target.begin({ ...manifest, selection: { ...manifest.selection, settings: true } })
    await target.appendRecords([{ type: 'global', category: 'settings', id: 'settings', value: { language: 'en' } }])
    const set = f.storage.set.bind(f.storage)
    vi.spyOn(f.storage, 'set').mockImplementation(async (key, value) => {
      if (key === GLOBAL_KEYS.memories) throw new Error('disk full')
      return set(key, value)
    })
    await expect(target.prepare()).rejects.toThrow('disk full')
    expect(await f.storage.get(GLOBAL_KEYS.settings)).toMatchObject({ language: 'en' })
    expect(target.getSummary().importedGlobals).toBe(1)
    await cleanupBackupImport(f.options)
    expect(await f.storage.get(GLOBAL_KEYS.settings)).toMatchObject({ language: 'en' })
  })

  it('keeps committed resources when cancellation prevents session publication', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options),
      controller = new AbortController()
    await target.begin(manifest, undefined, controller.signal)
    await resource(target, 'key', 'new')
    await target.appendRecords(backupRecords(fixture()))
    controller.abort()
    await expect(target.prepare()).rejects.toThrow()
    await cleanupBackupImport(f.options)
    expect(await f.rows.readCommit('s')).toBeNull()
    expect(new TextDecoder().decode(f.liveResources.get('key'))).toBe('new')
    expect(target.getSummary()).toMatchObject({ importedSessions: 0, importedResources: 1 })
  })

  it('reports committed sessions through the real importer when a later row is malformed', async () => {
    const f = setup()
    await f.seed(fixture('A', 'old A'))
    await f.seed(fixture('B', 'old B'))
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const rows = backupRecords(fixture('A', 'new A'))
    const bytes = zipSync({
      'manifest.json': encode(manifest),
      'resources.jsonl': new Uint8Array(),
      'sessions/A.jsonl': new TextEncoder().encode(rows.map((row) => JSON.stringify(row)).join('\n') + '\n'),
      'sessions/B.jsonl': new TextEncoder().encode(
        JSON.stringify(backupRecords(fixture('B', 'new B'))[0]) + '\n{bad json\n'
      ),
      'complete.json': encode({ archiveId: manifest.archiveId }),
    })
    const error = await importBackupV3({
      source: { size: bytes.length, readBytes: async (offset, length) => bytes.slice(offset, offset + length) },
      workspace: f.workspace,
      target: createBackupImportTarget(f.options),
    }).catch((error: unknown) => error)
    expect(getBackupImportPartialResult(error)?.importReport).toMatchObject({
      importedSessions: 1,
      importedMessages: 2,
    })
    expect((await f.rows.readCommit('A'))?.record.name).toBe('new A')
    expect((await f.rows.readCommit('B'))?.record.name).toBe('old B')
  })

  it('keeps the original session when its entry contains a duplicate header and a later malformed row', async () => {
    const f = setup()
    await f.seed(fixture('A', 'old A'))
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const incoming = backupRecords(fixture('A', 'new A'))
    const bytes = zipSync({
      'manifest.json': encode(manifest),
      'resources.jsonl': new Uint8Array(),
      'sessions/A.jsonl': new TextEncoder().encode(
        [...incoming, incoming[0]].map((row) => JSON.stringify(row)).join('\n') + '\n{bad json\n'
      ),
      'complete.json': encode({ archiveId: manifest.archiveId }),
    })
    const error = await importBackupV3({
      source: { size: bytes.length, readBytes: async (offset, length) => bytes.slice(offset, offset + length) },
      workspace: f.workspace,
      target: createBackupImportTarget(f.options),
    }).catch((error: unknown) => error)
    expect(getBackupImportPartialResult(error)?.importReport).toMatchObject({
      importedSessions: 0,
      importedMessages: 0,
    })
    expect((await f.rows.readCommit('A'))?.record.name).toBe('old A')
  })

  it('preserves imported metadata order and exports only selected conversations', async () => {
    const f = setup(),
      target = createBackupImportTarget(f.options)
    await f.seed(fixture('chosen'))
    await f.seed(fixture('other'))
    const incoming = backupRecords(fixture('chosen', 'updated'))
    if (incoming[0].type === 'session') incoming[0].meta = { sortOrder: 50, createdAt: 10 }
    await target.begin(manifest)
    await target.appendRecords(incoming)
    await target.prepare()
    await target.cleanup()
    expect(await f.metadata.getById('chosen')).toMatchObject({ sortOrder: 50, createdAt: 10 })
    const ensure = vi.spyOn(f.options, 'ensureRows'),
      records = []
    for await (const row of createBackupExportSource(f.options).records({
      ...manifest.selection,
      sessionIds: ['chosen'],
    }))
      records.push(row)
    expect(new Set(ensure.mock.calls.flat())).toEqual(new Set(['chosen']))
    expect(records.filter((row) => row.type === 'session')).toMatchObject([{ session: { id: 'chosen' } }])
  })
})

it('exports conversation rows without reading excluded global configuration', async () => {
  const f = setup()
  await f.seed(fixture('chosen'))
  const readGlobal = vi.spyOn(f.storage, 'get').mockRejectedValue(new Error('Excluded configuration is unavailable'))
  const readSettings = vi.spyOn(f.options, 'getSettings').mockImplementation(() => {
    throw new Error('Excluded settings are unavailable')
  })
  const source = createBackupExportSource(f.options, { includeGlobals: false })
  const records = []
  for await (const record of source.records({ ...manifest.selection, sessionIds: ['chosen'] })) records.push(record)
  expect(records.map((record) => record.type)).toEqual(['session', 'thread', 'message', 'message'])
  expect(readGlobal).not.toHaveBeenCalled()
  expect(readSettings).not.toHaveBeenCalled()
})

it('imports healthy sessions while preserving an existing session whose candidate is unusable', async () => {
  const f = setup(),
    old = fixture('broken', 'existing'),
    broken = fixture('broken', 'unusable'),
    healthy = fixture('healthy', 'kept')
  await f.seed(old)
  const before = await f.rows.readSnapshot('broken')
  broken.rows.messages[0].parentMessageId = 'missing'
  const issues: BackupImportIssue[] = []
  const target = createBackupImportTarget(f.options)
  await target.begin(manifest, (issue) => issues.push(issue))
  await target.appendRecords([...backupRecords(broken), ...backupRecords(healthy)])
  expect(await target.prepare()).toMatchObject({ importedSessions: 1, importedMessages: 2, skippedRecords: 4 })
  await target.cleanup()
  expect(await f.rows.readSnapshot('broken')).toEqual(before)
  expect((await f.rows.readSnapshot('healthy'))?.rows.messages.map((row) => row.message)).toEqual(
    healthy.rows.messages.map((row) => row.message)
  )
  expect(issues.map((issue) => issue.code)).toContain('unusable-session')
})

it.each(['missing-threads', 'message-identity'])(
  'preserves local data through the real ZIP importer when all incoming messages have %s',
  async (kind) => {
    const f = setup(),
      old = fixture('broken', 'existing'),
      damaged = fixture('broken', 'damaged'),
      healthy = fixture('healthy', 'restored')
    await f.seed(old)
    const before = await f.rows.readSnapshot('broken')
    const records = backupRecords(damaged).filter((record) => kind !== 'missing-threads' || record.type !== 'thread')
    if (kind === 'message-identity')
      for (const record of records) if (record.type === 'message') record.message.message.id = 'wrong'
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const bytes = zipSync({
      'manifest.json': encode(manifest),
      'resources.jsonl': new Uint8Array(),
      'sessions/broken.jsonl': new TextEncoder().encode(
        records.map((record) => JSON.stringify(record)).join('\n') + '\n'
      ),
      'sessions/healthy.jsonl': new TextEncoder().encode(
        backupRecords(healthy)
          .map((record) => JSON.stringify(record))
          .join('\n') + '\n'
      ),
      'complete.json': encode({ archiveId: manifest.archiveId }),
    })
    const result = await importBackupV3({
      source: { size: bytes.length, readBytes: async (offset, length) => bytes.slice(offset, offset + length) },
      workspace: f.options.workspace,
      target: createBackupImportTarget(f.options),
    })
    expect(result.importReport).toMatchObject({
      importedSessions: 1,
      importedMessages: 2,
      skippedRecords: kind === 'missing-threads' ? 3 : 4,
    })
    expect(await f.rows.readSnapshot('broken')).toEqual(before)
    expect((await f.rows.readSnapshot('healthy'))?.rows.messages.map((row) => row.message)).toEqual(
      healthy.rows.messages.map((row) => ({ ...row.message, generating: false }))
    )
  }
)

describe('backup folder selection', () => {
  it.each([
    { selected: ['A', 'B'], expected: ['work'] },
    { selected: ['B'], expected: [] },
    { selected: [], expected: [] },
    { selected: undefined, expected: ['work', 'empty'] },
  ])('exports only applicable folders for $selected', async ({ selected, expected }) => {
    const f = setup()
    const a = fixture('A')
    a.record.folderId = 'work'
    await f.seed(a)
    await f.seed(fixture('B'))
    await f.storage.set(GLOBAL_KEYS.folders, [
      { id: 'work', name: 'Work' },
      { id: 'empty', name: 'Empty' },
    ])
    const exported: Array<BackupBusinessRecord | BackupWarningRecord> = []
    for await (const row of createBackupExportSource(f.options).records({
      ...manifest.selection,
      sessionIds: selected,
    }))
      exported.push(row)
    expect(
      exported
        .filter((row) => row.type === 'global' && row.category === 'folder')
        .map((row) => (row.type === 'global' ? row.id : ''))
    ).toEqual(expected)
    const session = exported.find((row) => row.type === 'session' && row.session.id === 'A')
    if (selected === undefined || selected.includes('A')) {
      expect(session?.type === 'session' && session.session.folderId).toBe('work')
    }
  })
})
