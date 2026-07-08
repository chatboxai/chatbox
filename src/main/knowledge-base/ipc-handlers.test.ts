import os from 'node:os'
import path from 'node:path'
import * as fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Drives the registered kb:* handlers against the REAL libsql-backed db.ts
// (temp userData dir via the electron mock — same harness as db.test.ts).
// Heavy collaborators (file-loaders, MinerU parser) are mocked; the vector
// store mock hands back a REAL client as `.turso` so the vector-purge SQL in
// kb:file:delete runs for real against a seeded kb_<id> table.
const state = vi.hoisted(() => ({
  userDataDir: '',
  deleteIndexCalls: [] as string[],
  deleteIndexError: null as Error | null,
}))

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => state.userDataDir },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      ipc.handlers.set(channel, handler)
    },
  },
}))

vi.mock('@mastra/libsql', () => ({
  LibSQLVector: class {
    turso: unknown
    constructor({ connectionUrl }: { connectionUrl: string }) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = require('@libsql/client')
      this.turso = createClient({ url: connectionUrl })
    }
    deleteIndex({ indexName }: { indexName: string }): Promise<void> {
      state.deleteIndexCalls.push(indexName)
      if (state.deleteIndexError) return Promise.reject(state.deleteIndexError)
      return Promise.resolve()
    }
  },
}))

vi.mock('../util', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const collab = vi.hoisted(() => ({
  searchResults: [] as unknown[],
}))

vi.mock('./file-loaders', () => ({
  readChunks: vi.fn(() => Promise.resolve([])),
  searchKnowledgeBase: vi.fn(() => Promise.resolve(collab.searchResults)),
}))

vi.mock('./parsers', () => ({
  MineruParser: class {},
  testMineruConnection: vi.fn(() => Promise.resolve({ success: true })),
}))

type DbModule = typeof import('./db')

let tmpDir: string
let db: DbModule

async function loadAndRegister(): Promise<DbModule> {
  vi.resetModules()
  ipc.handlers.clear()
  const mod = await import('./db')
  await mod.initializeDatabase()
  const handlers = await import('./ipc-handlers')
  handlers.registerKnowledgeBaseHandlers()
  return mod
}

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipc.handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler({}, ...args) as Promise<T>
}

const baseKb = { name: 'My KB', embeddingModel: 'mock-embedding', rerankModel: 'mock-rerank' }
const baseFile = { name: 'doc.md', path: '/tmp/doc.md', type: 'text/markdown', size: 100 }

async function fileStatus(fileId: number) {
  const rs = await db.getDatabase().execute({ sql: 'SELECT status, error FROM kb_file WHERE id = ?', args: [fileId] })
  return rs.rows[0]
}

async function setFileStatus(fileId: number, status: string) {
  await db.getDatabase().execute({ sql: 'UPDATE kb_file SET status = ? WHERE id = ?', args: [status, fileId] })
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ipc-'))
  state.userDataDir = tmpDir
  state.deleteIndexCalls = []
  state.deleteIndexError = null
  collab.searchResults = []
  db = await loadAndRegister()
})

afterEach(() => {
  try {
    fs.removeSync(tmpDir)
  } catch {
    // best effort
  }
})

describe('kb CRUD', () => {
  it('kb:create validates required fields', async () => {
    await expect(invoke('kb:create', { ...baseKb, name: '  ' })).rejects.toThrow(/name is required/)
    await expect(invoke('kb:create', { ...baseKb, embeddingModel: '' })).rejects.toThrow(/Embedding model/)
  })

  it('kb:create + kb:list round-trips including documentParser JSON', async () => {
    const created = await invoke<{ id: number | bigint; name: string }>('kb:create', {
      ...baseKb,
      name: '  Trimmed KB  ',
      documentParser: { type: 'mineru', mineru: { apiToken: 'tok' } },
      providerMode: 'custom',
    })
    expect(created.name).toBe('Trimmed KB')

    const listed = await invoke<Array<Record<string, unknown>>>('kb:list')
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      name: 'Trimmed KB',
      embeddingModel: 'mock-embedding',
      rerankModel: 'mock-rerank',
      providerMode: 'custom',
      documentParser: { type: 'mineru', mineru: { apiToken: 'tok' } },
    })
  })

  it('kb:delete removes the kb, its files, and the vector index', async () => {
    const created = await invoke<{ id: number | bigint }>('kb:create', baseKb)
    const kbId = Number(created.id)
    await invoke('kb:file:upload', kbId, baseFile)

    const res = await invoke<{ success: boolean }>('kb:delete', kbId)
    expect(res.success).toBe(true)
    expect(state.deleteIndexCalls).toEqual([`kb_${kbId}`])

    expect(await invoke('kb:list')).toEqual([])
    const files = await db.getDatabase().execute('SELECT COUNT(*) AS n FROM kb_file')
    expect(Number(files.rows[0].n)).toBe(0)
  })

  it('kb:delete returns a failure envelope for a missing kb and rolls back on vector-index failure', async () => {
    const missing = await invoke<{ success: boolean; error?: string }>('kb:delete', 12345)
    expect(missing.success).toBe(false)
    expect(missing.error).toMatch(/not found/)

    const created = await invoke<{ id: number | bigint }>('kb:create', baseKb)
    const kbId = Number(created.id)
    await invoke('kb:file:upload', kbId, baseFile)

    state.deleteIndexError = new Error('vector store down')
    const res = await invoke<{ success: boolean; error?: string }>('kb:delete', kbId)
    expect(res.success).toBe(false)

    // the transaction rolled back: kb and file records are still there
    expect(await invoke('kb:list')).toHaveLength(1)
    const files = await db.getDatabase().execute('SELECT COUNT(*) AS n FROM kb_file')
    expect(Number(files.rows[0].n)).toBe(1)
  })
})

describe('kb:file:upload', () => {
  let kbId: number
  beforeEach(async () => {
    const created = await invoke<{ id: number | bigint }>('kb:create', baseKb)
    kbId = Number(created.id)
  })

  it('rejects invalid metadata, oversized files, and unknown kbs', async () => {
    await expect(invoke('kb:file:upload', kbId, { ...baseFile, name: '' })).rejects.toThrow(/Invalid file metadata/)
    await expect(invoke('kb:file:upload', kbId, { ...baseFile, size: Number.MAX_SAFE_INTEGER })).rejects.toThrow(
      /Invalid file size/
    )
    await expect(invoke('kb:file:upload', 999, baseFile)).rejects.toThrow(/not found/)
  })

  it('creates a pending file record', async () => {
    const { id } = await invoke<{ id: number }>('kb:file:upload', kbId, baseFile)
    expect(id).toBeGreaterThan(0)
    expect((await fileStatus(id)).status).toBe('pending')

    const listed = await invoke<Array<Record<string, unknown>>>('kb:file:list', kbId)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ filename: 'doc.md', status: 'pending', parser_type: 'local' })
    expect(typeof listed[0].createdAt).toBe('number')

    expect(await invoke('kb:file:count', kbId)).toBe(1)
  })

  it('kb:file:list-paginated validates pagination parameters', async () => {
    await expect(invoke('kb:file:list-paginated', kbId, -1, 20)).rejects.toThrow(/Invalid pagination/)
    await expect(invoke('kb:file:list-paginated', kbId, 0, 101)).rejects.toThrow(/Invalid pagination/)
  })
})

describe('kb:file status state machine', () => {
  let kbId: number
  let fileId: number
  beforeEach(async () => {
    const created = await invoke<{ id: number | bigint }>('kb:create', baseKb)
    kbId = Number(created.id)
    const up = await invoke<{ id: number }>('kb:file:upload', kbId, baseFile)
    fileId = up.id
  })

  it('retry: only failed files can be retried; retry resets to pending', async () => {
    await expect(invoke('kb:file:retry', fileId)).rejects.toThrow(/Only failed files/)

    await db.getDatabase().execute({
      sql: "UPDATE kb_file SET status = 'failed', error = 'boom', chunk_count = 3 WHERE id = ?",
      args: [fileId],
    })
    const res = await invoke<{ success: boolean }>('kb:file:retry', fileId, true)
    expect(res.success).toBe(true)

    const rs = await db.getDatabase().execute({
      sql: 'SELECT status, error, chunk_count, use_remote_parsing FROM kb_file WHERE id = ?',
      args: [fileId],
    })
    expect(rs.rows[0]).toMatchObject({ status: 'pending', error: null, chunk_count: 0, use_remote_parsing: 1 })
  })

  it('pause: only processing files can be paused', async () => {
    await expect(invoke('kb:file:pause', fileId)).rejects.toThrow(/Only processing files/)
    await setFileStatus(fileId, 'processing')
    await expect(invoke('kb:file:pause', fileId)).resolves.toEqual({ success: true })
    expect((await fileStatus(fileId)).status).toBe('paused')
  })

  it('resume: only paused files can be resumed', async () => {
    await expect(invoke('kb:file:resume', fileId)).rejects.toThrow(/Only paused files/)
    await setFileStatus(fileId, 'paused')
    await expect(invoke('kb:file:resume', fileId)).resolves.toEqual({ success: true })
    expect((await fileStatus(fileId)).status).toBe('pending')
  })

  it('rejects unknown file ids across the state machine', async () => {
    await expect(invoke('kb:file:retry', 999)).rejects.toThrow(/File not found/)
    await expect(invoke('kb:file:pause', 999)).rejects.toThrow(/File not found/)
    await expect(invoke('kb:file:resume', 999)).rejects.toThrow(/File not found/)
  })
})

describe('kb:file:delete', () => {
  it('purges only the deleted file’s vectors and removes the record', async () => {
    const created = await invoke<{ id: number | bigint }>('kb:create', baseKb)
    const kbId = Number(created.id)
    const a = await invoke<{ id: number }>('kb:file:upload', kbId, baseFile)
    const b = await invoke<{ id: number }>('kb:file:upload', kbId, { ...baseFile, name: 'other.md' })

    // seed a real kb_<id> vector table the handler's purge SQL runs against
    const client = db.getDatabase()
    await client.execute(`CREATE TABLE kb_${kbId} (id INTEGER PRIMARY KEY, metadata TEXT)`)
    await client.execute({
      sql: `INSERT INTO kb_${kbId} (metadata) VALUES (?), (?), (?)`,
      args: [JSON.stringify({ fileId: a.id }), JSON.stringify({ fileId: a.id }), JSON.stringify({ fileId: b.id })],
    })

    await expect(invoke('kb:file:delete', a.id)).resolves.toEqual({ success: true })

    const vectors = await client.execute(`SELECT metadata FROM kb_${kbId}`)
    expect(vectors.rows).toHaveLength(1)
    expect(JSON.parse(String(vectors.rows[0].metadata)).fileId).toBe(b.id)

    const files = await invoke<Array<Record<string, unknown>>>('kb:file:list', kbId)
    expect(files.map((f) => f.id)).toEqual([b.id])
  })

  it('returns a failure envelope for a missing file', async () => {
    const res = await invoke<{ success: boolean; error?: string }>('kb:file:delete', 999)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/File not found/)
  })
})

describe('kb:search', () => {
  it('validates input and delegates to searchKnowledgeBase', async () => {
    await expect(invoke('kb:search', 0, 'query')).rejects.toThrow(/Invalid knowledge base ID/)
    await expect(invoke('kb:search', 1, '   ')).rejects.toThrow(/query is required/)
    await expect(invoke('kb:search', 1, 'x'.repeat(1001))).rejects.toThrow(/too long/)

    collab.searchResults = [{ text: 'hit' }]
    await expect(invoke('kb:search', 1, '  find this  ')).resolves.toEqual([{ text: 'hit' }])
    const { searchKnowledgeBase } = await import('./file-loaders')
    expect(searchKnowledgeBase).toHaveBeenCalledWith(1, 'find this')
  })
})
