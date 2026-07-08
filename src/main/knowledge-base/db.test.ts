import os from 'node:os'
import path from 'node:path'
import * as fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Drives the REAL libsql schema/transaction/state-machine behavior against a
// temp file. Unlike session-attachment-rag's db.ts there is NO env-var path
// override here — the path is derived from `app.getPath('userData')` at module
// load, so the electron mock redirects userData to a per-test temp dir and each
// test re-imports via resetModules (see ARCHITECTURE_NOTES).
//
// db.ts pulls its Client off `(vectorStore as any).turso`, so the LibSQLVector
// mock must return a REAL @libsql/client for the given connectionUrl.
const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => state.userDataDir },
}))

vi.mock('@mastra/libsql', () => ({
  LibSQLVector: class {
    turso: unknown
    constructor({ connectionUrl }: { connectionUrl: string }) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = require('@libsql/client')
      this.turso = createClient({ url: connectionUrl })
    }
  },
}))

vi.mock('../util', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

type DbModule = typeof import('./db')

let tmpDir: string
let db: DbModule

async function loadAndInit(): Promise<DbModule> {
  vi.resetModules()
  const mod = await import('./db')
  await mod.initializeDatabase()
  return mod
}

async function createKb(mod: DbModule, name = 'kb-1'): Promise<number> {
  const rs = await mod.getDatabase().execute({
    sql: 'INSERT INTO knowledge_base (name, embedding_model) VALUES (?, ?) RETURNING id',
    args: [name, 'mock-embedding'],
  })
  return Number(rs.rows[0].id)
}

async function createFile(mod: DbModule, kbId: number, status: string, processingStartedAt?: string): Promise<number> {
  const rs = await mod.getDatabase().execute({
    sql: `INSERT INTO kb_file (kb_id, filename, filepath, mime_type, status, processing_started_at)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [kbId, 'doc.md', '/tmp/doc.md', 'text/markdown', status, processingStartedAt ?? null],
  })
  return Number(rs.rows[0].id)
}

async function fileStatus(mod: DbModule, id: number) {
  const rs = await mod.getDatabase().execute({
    sql: 'SELECT status, error, processing_started_at FROM kb_file WHERE id = ?',
    args: [id],
  })
  return rs.rows[0]
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-db-'))
  state.userDataDir = tmpDir
  db = await loadAndInit()
})

afterEach(() => {
  try {
    fs.removeSync(tmpDir)
  } catch {
    // best effort
  }
})

describe('initialization', () => {
  it('creates the schema including all migration-added columns', async () => {
    const cols = await db.getDatabase().execute("SELECT name FROM pragma_table_info('kb_file')")
    const names = cols.rows.map((r) => String(r.name))
    expect(names).toEqual(
      expect.arrayContaining(['total_chunks', 'use_remote_parsing', 'parsed_remotely', 'parser_type', 'status'])
    )
    const kbCols = await db.getDatabase().execute("SELECT name FROM pragma_table_info('knowledge_base')")
    expect(kbCols.rows.map((r) => String(r.name))).toEqual(expect.arrayContaining(['document_parser', 'provider_mode']))
  })

  it('re-initializing against an existing database is idempotent (duplicate-column migrations tolerated)', async () => {
    const kbId = await createKb(db)
    // fresh module load against the SAME userData dir = app restart
    const again = await loadAndInit()
    const rs = await again.getDatabase().execute('SELECT COUNT(*) AS n FROM knowledge_base')
    expect(Number(rs.rows[0].n)).toBe(1)
    expect(kbId).toBeGreaterThan(0)
  })

  it('getDatabase/getVectorStore throw before initialization', async () => {
    vi.resetModules()
    const fresh = await import('./db')
    expect(() => fresh.getDatabase()).toThrow(/not initialized/)
    expect(() => fresh.getVectorStore()).toThrow(/not initialized/)
  })
})

describe('parseSQLiteTimestamp', () => {
  it('parses SQLite CURRENT_TIMESTAMP strings as UTC', () => {
    expect(db.parseSQLiteTimestamp('2026-01-02 03:04:05')).toBe(Date.UTC(2026, 0, 2, 3, 4, 5))
  })

  it('falls back to the current time for garbage input', () => {
    const before = Date.now()
    const parsed = db.parseSQLiteTimestamp('not-a-timestamp')
    expect(parsed).toBeGreaterThanOrEqual(before)
    expect(parsed).toBeLessThanOrEqual(Date.now())
  })
})

describe('withTransaction', () => {
  it('commits on success', async () => {
    const kbId = await createKb(db)
    await db.withTransaction(async () => {
      await createFile(db, kbId, 'pending')
    })
    const rs = await db.getDatabase().execute('SELECT COUNT(*) AS n FROM kb_file')
    expect(Number(rs.rows[0].n)).toBe(1)
  })

  it('rolls back everything when the operation throws', async () => {
    const kbId = await createKb(db)
    await expect(
      db.withTransaction(async () => {
        await createFile(db, kbId, 'pending')
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    const rs = await db.getDatabase().execute('SELECT COUNT(*) AS n FROM kb_file')
    expect(Number(rs.rows[0].n)).toBe(0)
  })
})

describe('startup cleanup (processing → paused)', () => {
  it('pauses files left in processing by a previous session', async () => {
    const kbId = await createKb(db)
    const processingId = await createFile(db, kbId, 'processing', '2026-01-01 00:00:00')
    const readyId = await createFile(db, kbId, 'ready')

    // app restart: cleanupProcessingFiles runs inside initializeDatabase
    const again = await loadAndInit()

    const paused = await fileStatus(again, processingId)
    expect(paused.status).toBe('paused')
    expect(paused.processing_started_at).toBeNull()
    expect((await fileStatus(again, readyId)).status).toBe('ready')
  })
})

describe('checkProcessingTimeouts', () => {
  it('fails files processing for more than 5 minutes and leaves recent ones alone', async () => {
    const kbId = await createKb(db)
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const fresh = new Date(Date.now() - 60 * 1000).toISOString()
    const staleId = await createFile(db, kbId, 'processing', stale)
    const freshId = await createFile(db, kbId, 'processing', fresh)

    await db.checkProcessingTimeouts()

    const failed = await fileStatus(db, staleId)
    expect(failed.status).toBe('failed')
    expect(String(failed.error)).toMatch(/timeout/i)
    expect(failed.processing_started_at).toBeNull()
    expect((await fileStatus(db, freshId)).status).toBe('processing')
  })
})
