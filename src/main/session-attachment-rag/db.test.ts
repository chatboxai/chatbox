import os from 'node:os'
import path from 'node:path'
import * as fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The vector store is the only non-libsql collaborator db.ts touches. Back it
// with an in-memory index-name set so listIndexes/deleteIndex behave for real
// while the actual metadata SQL runs against a real temp libsql file.
const vec = vi.hoisted(() => ({ indexes: new Set<string>() }))

vi.mock('@mastra/libsql', () => ({
  LibSQLVector: class {
    listIndexes(): Promise<string[]> {
      return Promise.resolve([...vec.indexes])
    }
    deleteIndex({ indexName }: { indexName: string }): Promise<void> {
      vec.indexes.delete(indexName)
      return Promise.resolve()
    }
  },
}))

// Mutable state read by the electron mock (userData path only needs to exist so
// module-load ensureDbDir on the *default* path doesn't fail; the actual db
// paths come from the env vars set in beforeEach).
const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => state.userDataDir },
}))

vi.mock('../util', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

type DbModule = typeof import('./db')

let tmpDir: string
let db: DbModule

// Loads db.ts fresh so its module-level dbPath/vectorDbPath are captured against
// the current env vars, then initializes the real libsql database.
async function loadAndInit(): Promise<DbModule> {
  vi.resetModules()
  const mod = await import('./db')
  await mod.initializeDatabase()
  return mod
}

const baseAttachment = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  attachmentStorageKey: 'key-1',
  filename: 'doc.md',
  mimeType: 'text/markdown',
  fileSize: 1234,
  tokenEstimate: 42,
  parserType: 'text',
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-rag-db-'))
  state.userDataDir = tmpDir
  vec.indexes = new Set<string>()
  process.env.SESSION_ATTACHMENT_RAG_DB_PATH = path.join(tmpDir, 'meta.db')
  process.env.SESSION_ATTACHMENT_RAG_VECTOR_DB_PATH = path.join(tmpDir, 'vec.db')
  db = await loadAndInit()
})

afterEach(() => {
  process.env.SESSION_ATTACHMENT_RAG_DB_PATH = undefined
  process.env.SESSION_ATTACHMENT_RAG_VECTOR_DB_PATH = undefined
  try {
    fs.removeSync(tmpDir)
  } catch {
    // best effort
  }
})

describe('initialization & accessors', () => {
  it('initializes the schema at the current SCHEMA_VERSION', async () => {
    const rs = await db.getDatabase().execute('PRAGMA user_version')
    expect(Number(rs.rows[0]?.user_version)).toBe(2)
  })

  it('exposes the configured db paths', () => {
    expect(db.getSessionAttachmentRagDbPath()).toBe(path.join(tmpDir, 'meta.db'))
    expect(db.getSessionAttachmentRagVectorDbPath()).toBe(path.join(tmpDir, 'vec.db'))
  })

  it('getDatabase/getVectorStore throw before initialization', async () => {
    vi.resetModules()
    const fresh = await import('./db')
    expect(() => fresh.getDatabase()).toThrow(/not initialized/)
    expect(() => fresh.getVectorStore()).toThrow(/not initialized/)
  })

  it('is idempotent across a second initialization', async () => {
    await expect(db.initializeDatabase()).resolves.toBeUndefined()
  })
})

describe('createSessionAttachment & getSessionAttachment', () => {
  it('inserts a pending/queued row and reads it back', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    expect(id).toBeGreaterThan(0)
    const rec = await db.getSessionAttachment(id)
    expect(rec).toMatchObject({
      id,
      sessionId: 'sess-1',
      messageId: 'msg-1',
      filename: 'doc.md',
      status: 'pending',
      indexingStage: 'queued',
      chunkCount: 0,
    })
  })

  it('returns null for a missing id', async () => {
    expect(await db.getSessionAttachment(999999)).toBeNull()
  })

  it('persists a null parserType as undefined', async () => {
    const id = await db.createSessionAttachment({ ...baseAttachment, parserType: undefined })
    const rec = await db.getSessionAttachment(id)
    expect(rec?.parserType).toBeUndefined()
  })
})

describe('status state machine', () => {
  it('markIndexing only advances a pending row', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    expect(await db.markSessionAttachmentIndexing(id)).toBe(true)
    expect((await db.getSessionAttachment(id))?.status).toBe('indexing')
    // second attempt is a no-op because it is no longer pending
    expect(await db.markSessionAttachmentIndexing(id)).toBe(false)
  })

  it('markReady only advances an indexing row and back-fills embedded_chunks', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    // ready is rejected while still pending
    expect(await db.markSessionAttachmentReady(id)).toBe(false)
    await db.markSessionAttachmentIndexing(id)
    await db.updateSessionAttachmentIndexingProgress(id, { indexingStage: 'embedding', totalChunks: 5 })
    expect(await db.markSessionAttachmentReady(id)).toBe(true)
    const rec = await db.getSessionAttachment(id)
    expect(rec?.status).toBe('ready')
    expect(rec?.indexingStage).toBe('ready')
    expect(rec?.embeddedChunks).toBe(5)
    expect(rec?.completedAt).toBeTruthy()
  })

  it('updateIndexingProgress only writes provided fields and only while indexing', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.markSessionAttachmentIndexing(id)
    await db.updateSessionAttachmentIndexingProgress(id, { indexingStage: 'chunking', totalChunks: 8 })
    let rec = await db.getSessionAttachment(id)
    expect(rec?.indexingStage).toBe('chunking')
    expect(rec?.totalChunks).toBe(8)
    expect(rec?.embeddedChunks).toBe(0)
    await db.updateSessionAttachmentIndexingProgress(id, { indexingStage: 'embedding', embeddedChunks: 3 })
    rec = await db.getSessionAttachment(id)
    expect(rec?.embeddedChunks).toBe(3)
    expect(rec?.totalChunks).toBe(8) // untouched
  })

  it('markFailed sets error for any status except canceled', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.markSessionAttachmentFailed(id, 'boom')
    let rec = await db.getSessionAttachment(id)
    expect(rec?.status).toBe('failed')
    expect(rec?.error).toBe('boom')

    // canceled rows are protected from being marked failed
    const id2 = await db.createSessionAttachment(baseAttachment)
    await db.cancelSessionAttachment(id2)
    await db.markSessionAttachmentFailed(id2, 'nope')
    rec = await db.getSessionAttachment(id2)
    expect(rec?.status).toBe('canceled')
  })

  it('cancel moves pending/indexing/failed rows to canceled', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.cancelSessionAttachment(id)
    expect((await db.getSessionAttachment(id))?.status).toBe('canceled')
  })
})

describe('retrySessionAttachment', () => {
  it('resets a failed attachment back to pending/queued', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.markSessionAttachmentFailed(id, 'boom')
    await db.retrySessionAttachment(id)
    const rec = await db.getSessionAttachment(id)
    expect(rec?.status).toBe('pending')
    expect(rec?.indexingStage).toBe('queued')
    expect(rec?.error).toBeUndefined()
  })

  it('throws for a missing attachment', async () => {
    await expect(db.retrySessionAttachment(424242)).rejects.toThrow(/not found/)
  })

  it('throws when the attachment is not in a failed state', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await expect(db.retrySessionAttachment(id)).rejects.toThrow(/Only failed/)
  })
})

describe('listing queries', () => {
  it('listPending returns pending rows oldest-first and respects the limit', async () => {
    const a = await db.createSessionAttachment(baseAttachment)
    const b = await db.createSessionAttachment(baseAttachment)
    await db.createSessionAttachment(baseAttachment)
    await db.markSessionAttachmentIndexing(b) // b is no longer pending
    const pending = await db.listPendingSessionAttachments(10)
    const ids = pending.map((r) => r.id)
    expect(ids).toContain(a)
    expect(ids).not.toContain(b)
    expect(await db.listPendingSessionAttachments(1)).toHaveLength(1)
  })

  it('listByIds returns [] for an empty id list and maps found rows', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    expect(await db.listSessionAttachmentsByIds([])).toEqual([])
    const rows = await db.listSessionAttachmentsByIds([id, 999999])
    expect(rows.map((r) => r.id)).toEqual([id])
  })

  it('rebind updates session and message ownership', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.rebindSessionAttachment(id, 'sess-2', 'msg-2')
    const rec = await db.getSessionAttachment(id)
    expect(rec?.sessionId).toBe('sess-2')
    expect(rec?.messageId).toBe('msg-2')
  })
})

describe('replaceAttachmentParentsAndChunks', () => {
  const parents = [
    { parentOrder: 0, sectionPath: 'Intro', text: 'parent zero', tokenEstimate: 3, charCount: 11 },
    { parentOrder: 1, text: 'parent one', tokenEstimate: 3, charCount: 10 },
  ]
  const chunks = [
    { parentOrder: 0, chunkOrder: 0, rawText: 'c0', embeddedText: '[doc] c0', tokenEstimate: 1 },
    { parentOrder: 1, chunkOrder: 1, rawText: 'c1', embeddedText: '[doc] c1', tokenEstimate: 1 },
  ]

  it('inserts parents and chunks and returns the parentOrder→id map', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    const map = await db.replaceAttachmentParentsAndChunks(id, parents, chunks)
    expect(map.size).toBe(2)
    const rec = await db.getSessionAttachment(id)
    expect(rec?.chunkCount).toBe(2)
    const parentIds = [...map.values()]
    const read = await db.readSessionAttachmentParents(parentIds, [id])
    expect(read).toHaveLength(2)
  })

  it('replaces previous parents/chunks on a second call', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.replaceAttachmentParentsAndChunks(id, parents, chunks)
    await db.replaceAttachmentParentsAndChunks(
      id,
      [{ parentOrder: 0, text: 'only one', tokenEstimate: 2, charCount: 8 }],
      [{ parentOrder: 0, chunkOrder: 0, rawText: 'x', embeddedText: 'x', tokenEstimate: 1 }]
    )
    expect((await db.getSessionAttachment(id))?.chunkCount).toBe(1)
  })

  it('rolls back the whole transaction when a chunk references a missing parent', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await expect(
      db.replaceAttachmentParentsAndChunks(
        id,
        [{ parentOrder: 0, text: 'p', tokenEstimate: 1, charCount: 1 }],
        [{ parentOrder: 9, chunkOrder: 0, rawText: 'x', embeddedText: 'x', tokenEstimate: 1 }]
      )
    ).rejects.toThrow(/Parent order 9 not found/)
    // rollback: no parents/chunks committed
    expect((await db.getSessionAttachment(id))?.chunkCount).toBe(0)
  })
})

describe('readSessionAttachmentParents scoping', () => {
  it('returns [] when parentIds or allowedAttachmentIds is empty', async () => {
    expect(await db.readSessionAttachmentParents([], [1])).toEqual([])
    expect(await db.readSessionAttachmentParents([1], [])).toEqual([])
  })

  it('does not leak parents belonging to a disallowed attachment', async () => {
    const idA = await db.createSessionAttachment(baseAttachment)
    const idB = await db.createSessionAttachment(baseAttachment)
    const mapA = await db.replaceAttachmentParentsAndChunks(
      idA,
      [{ parentOrder: 0, text: 'a', tokenEstimate: 1, charCount: 1 }],
      [{ parentOrder: 0, chunkOrder: 0, rawText: 'x', embeddedText: 'x', tokenEstimate: 1 }]
    )
    const parentIdA = [...mapA.values()][0]
    // ask for A's parent but only allow attachment B
    expect(await db.readSessionAttachmentParents([parentIdA], [idB])).toEqual([])
    expect(await db.readSessionAttachmentParents([parentIdA], [idA])).toHaveLength(1)
  })
})

describe('deletion paths', () => {
  it('deleteSingleAttachment cancels a pending row instead of deleting it', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.deleteSingleAttachment(id)
    expect((await db.getSessionAttachment(id))?.status).toBe('canceled')
  })

  it('deleteSingleAttachment deletes the graph for a ready row and its vector index', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.markSessionAttachmentIndexing(id)
    await db.markSessionAttachmentReady(id)
    vec.indexes.add(`sa_${id}`)
    await db.deleteSingleAttachment(id)
    expect(await db.getSessionAttachment(id)).toBeNull()
    expect(vec.indexes.has(`sa_${id}`)).toBe(false)
  })

  it('deleteSingleAttachment is a no-op for a missing id', async () => {
    await expect(db.deleteSingleAttachment(999999)).resolves.toBeUndefined()
  })

  it('deleteMessageAttachments removes all rows for a message and cascades chunks', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.replaceAttachmentParentsAndChunks(
      id,
      [{ parentOrder: 0, text: 'p', tokenEstimate: 1, charCount: 1 }],
      [{ parentOrder: 0, chunkOrder: 0, rawText: 'x', embeddedText: 'x', tokenEstimate: 1 }]
    )
    const deleted = await db.deleteMessageAttachments('msg-1')
    expect(deleted).toContain(id)
    expect(await db.getSessionAttachment(id)).toBeNull()
    // FK cascade removed the parent/chunk rows
    const parentCount = await db.getDatabase().execute('SELECT COUNT(*) AS c FROM session_attachment_parent')
    expect(Number(parentCount.rows[0]?.c)).toBe(0)
  })

  it('deleteSessionAttachments removes every row in a session', async () => {
    await db.createSessionAttachment(baseAttachment)
    await db.createSessionAttachment({ ...baseAttachment, messageId: 'msg-2' })
    const deleted = await db.deleteSessionAttachments('sess-1')
    expect(deleted).toHaveLength(2)
    expect(await db.listSessionAttachmentsByIds(deleted)).toEqual([])
  })

  it('clearAll deletes rows and orphan sa_ vector indexes', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    vec.indexes.add(`sa_${id}`)
    vec.indexes.add('sa_orphan')
    vec.indexes.add('unrelated_index')
    const count = await db.clearAllSessionAttachments()
    expect(count).toBe(1)
    expect(vec.indexes.has(`sa_${id}`)).toBe(false)
    expect(vec.indexes.has('sa_orphan')).toBe(false)
    expect(vec.indexes.has('unrelated_index')).toBe(true) // non-sa_ indexes preserved
  })
})

describe('cleanup routines', () => {
  it('cleanupInterruptedIndexing marks stuck indexing rows failed', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.markSessionAttachmentIndexing(id)
    const affected = await db.cleanupInterruptedIndexingAttachments()
    expect(affected).toBe(1)
    expect((await db.getSessionAttachment(id))?.status).toBe('failed')
  })

  it('cleanupReadyAttachmentsMissingVectorIndexes fails ready rows without an index', async () => {
    const withIndex = await db.createSessionAttachment(baseAttachment)
    const withoutIndex = await db.createSessionAttachment(baseAttachment)
    for (const id of [withIndex, withoutIndex]) {
      await db.markSessionAttachmentIndexing(id)
      await db.markSessionAttachmentReady(id)
    }
    vec.indexes.add(`sa_${withIndex}`) // only one has a live index
    const count = await db.cleanupReadyAttachmentsMissingVectorIndexes()
    expect(count).toBe(1)
    expect((await db.getSessionAttachment(withoutIndex))?.status).toBe('failed')
    expect((await db.getSessionAttachment(withIndex))?.status).toBe('ready')
  })

  it('purgeCanceled removes canceled rows and reports the count', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.cancelSessionAttachment(id)
    expect(await db.listCanceledSessionAttachments()).toHaveLength(1)
    expect(await db.purgeCanceledSessionAttachments()).toBe(1)
    expect(await db.getSessionAttachment(id)).toBeNull()
    expect(await db.purgeCanceledSessionAttachments()).toBe(0) // nothing left
  })

  it('cleanupOrphanAttachments deletes rows whose session or message is gone', async () => {
    const keep = await db.createSessionAttachment(baseAttachment)
    const orphanSession = await db.createSessionAttachment({ ...baseAttachment, sessionId: 'gone' })
    const orphanMessage = await db.createSessionAttachment({ ...baseAttachment, messageId: 'gone' })
    const orphans = await db.cleanupOrphanAttachments(['sess-1'], ['msg-1'])
    expect(orphans).toEqual(expect.arrayContaining([orphanSession, orphanMessage]))
    expect(orphans).not.toContain(keep)
    expect(await db.getSessionAttachment(keep)).not.toBeNull()
  })
})

describe('getSessionAttachmentDebugSnapshot', () => {
  it('reports counts, status buckets and coalesces canceled → failed in recents', async () => {
    const ready = await db.createSessionAttachment(baseAttachment)
    await db.markSessionAttachmentIndexing(ready)
    await db.markSessionAttachmentReady(ready)
    const pending = await db.createSessionAttachment(baseAttachment)
    const canceled = await db.createSessionAttachment(baseAttachment)
    await db.cancelSessionAttachment(canceled)
    await db.replaceAttachmentParentsAndChunks(
      ready,
      [{ parentOrder: 0, text: 'p', tokenEstimate: 1, charCount: 1 }],
      [{ parentOrder: 0, chunkOrder: 0, rawText: 'x', embeddedText: 'x', tokenEstimate: 1 }]
    )
    vec.indexes.add(`sa_${ready}`)

    const snap = await db.getSessionAttachmentDebugSnapshot()
    expect(snap.attachmentCount).toBe(3)
    expect(snap.parentCount).toBe(1)
    expect(snap.chunkCount).toBe(1)
    expect(snap.statusCounts.ready).toBe(1)
    expect(snap.statusCounts.pending).toBe(1)
    expect(snap.vectorIndexNames).toContain(`sa_${ready}`)
    // canceled row is excluded from recents entirely (WHERE status != 'canceled')
    expect(snap.recentAttachments.map((r) => r.id)).not.toContain(canceled)
    expect(snap.recentAttachments.map((r) => r.id)).toEqual(expect.arrayContaining([ready, pending]))
  })
})

describe('withTransaction', () => {
  it('commits successful work', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await db.withTransaction(async () => {
      await db.getDatabase().execute({
        sql: 'UPDATE session_attachment SET filename = ? WHERE id = ?',
        args: ['renamed.md', id],
      })
    })
    expect((await db.getSessionAttachment(id))?.filename).toBe('renamed.md')
  })

  it('rolls back and rethrows when the operation fails', async () => {
    const id = await db.createSessionAttachment(baseAttachment)
    await expect(
      db.withTransaction(async () => {
        await db.getDatabase().execute({
          sql: 'UPDATE session_attachment SET filename = ? WHERE id = ?',
          args: ['half.md', id],
        })
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect((await db.getSessionAttachment(id))?.filename).toBe('doc.md')
  })
})

describe('runVectorWrite', () => {
  it('serializes operations in submission order even when they resolve out of order', async () => {
    const order: number[] = []
    const slow = db.runVectorWrite(async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push(1)
    })
    const fast = db.runVectorWrite(() => {
      order.push(2)
      return Promise.resolve()
    })
    await Promise.all([slow, fast])
    expect(order).toEqual([1, 2])
  })

  it('keeps the queue alive after a failed operation', async () => {
    await expect(db.runVectorWrite(() => Promise.reject(new Error('x')))).rejects.toThrow('x')
    await expect(db.runVectorWrite(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })
})

describe('parseSQLiteTimestamp', () => {
  it('parses a valid SQLite UTC timestamp', () => {
    const ts = db.parseSQLiteTimestamp('2026-07-06 12:00:00')
    expect(ts).toBe(Date.UTC(2026, 6, 6, 12, 0, 0))
  })

  it('falls back to now for an unparseable timestamp', () => {
    const before = Date.now()
    const ts = db.parseSQLiteTimestamp('not-a-date')
    expect(ts).toBeGreaterThanOrEqual(before)
  })
})

describe('deleteAttachmentIndex', () => {
  it('removes the matching vector index and swallows vector errors', async () => {
    vec.indexes.add('sa_7')
    await db.deleteAttachmentIndex(7)
    expect(vec.indexes.has('sa_7')).toBe(false)
    // deleting a non-existent index must not throw
    await expect(db.deleteAttachmentIndex(123)).resolves.toBeUndefined()
  })
})
