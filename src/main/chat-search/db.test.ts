import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Drives the REAL @libsql/client against a throwaway temp file so the actual
// FTS5 trigram behavior is exercised (same pattern as session-attachment-rag's
// db.test.ts). The module reads CHAT_SEARCH_DB_PATH at load, so each test sets
// the env var and re-imports via resetModules.

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
  },
}))

vi.mock('../util', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}))

type DbModule = typeof import('./db')

let tempDir: string
let db: DbModule

async function loadDbModule(): Promise<DbModule> {
  vi.resetModules()
  const mod = await import('./db')
  await mod.initializeDatabase()
  return mod
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-search-test-'))
  process.env.CHAT_SEARCH_DB_PATH = path.join(tempDir, 'chat_search.db')
  db = await loadDbModule()
})

afterEach(() => {
  delete process.env.CHAT_SEARCH_DB_PATH
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('chat-search db', () => {
  it('indexes and finds case-insensitive substrings (trigram tokenizer)', async () => {
    await db.upsertSessionIndex('s1', [
      { messageId: 'm1', text: 'Hello WorkspAIce full-text search' },
      { messageId: 'm2', text: 'Another unrelated message' },
    ])

    expect(await db.queryIndex('orksp', 10)).toEqual([{ sessionId: 's1', messageId: 'm1' }])
    expect(await db.queryIndex('WORKSPAICE', 10)).toEqual([{ sessionId: 's1', messageId: 'm1' }])
    expect(await db.queryIndex('unrelated', 10)).toEqual([{ sessionId: 's1', messageId: 'm2' }])
    expect(await db.queryIndex('nomatchhere', 10)).toEqual([])
  })

  it('matches CJK substrings', async () => {
    await db.upsertSessionIndex('s1', [{ messageId: 'm1', text: '你好世界，这是一段中文消息内容' }])

    expect(await db.queryIndex('中文消息', 10)).toEqual([{ sessionId: 's1', messageId: 'm1' }])
    // Trigram needs >= 3 codepoints — 2-char CJK queries return nothing
    // (the renderer falls back to the brute-force scan below 3 chars).
    expect(await db.queryIndex('你好', 10)).toEqual([])
  })

  it('neutralizes FTS query operators (input is a plain phrase)', async () => {
    await db.upsertSessionIndex('s1', [{ messageId: 'm1', text: 'phrase with "quotes" AND operators' }])

    await expect(db.queryIndex('"quotes" AND', 10)).resolves.toEqual([{ sessionId: 's1', messageId: 'm1' }])
    await expect(db.queryIndex('foo OR bar', 10)).resolves.toEqual([])
  })

  it('upsert replaces the whole session and skips empty texts', async () => {
    await db.upsertSessionIndex('s1', [
      { messageId: 'm1', text: 'original message alpha' },
      { messageId: 'm2', text: '   ' },
    ])
    expect(await db.queryIndex('alpha', 10)).toHaveLength(1)

    await db.upsertSessionIndex('s1', [{ messageId: 'm3', text: 'replacement message beta' }])
    expect(await db.queryIndex('alpha', 10)).toEqual([])
    expect(await db.queryIndex('beta', 10)).toEqual([{ sessionId: 's1', messageId: 'm3' }])
  })

  it('deletes sessions selectively', async () => {
    await db.upsertSessionIndex('s1', [{ messageId: 'm1', text: 'session one keepword' }])
    await db.upsertSessionIndex('s2', [{ messageId: 'm2', text: 'session two keepword' }])

    await db.deleteSessionIndex(['s1'])
    expect(await db.queryIndex('keepword', 10)).toEqual([{ sessionId: 's2', messageId: 'm2' }])

    await db.deleteSessionIndex([])
    expect(await db.queryIndex('keepword', 10)).toHaveLength(1)
  })

  it('stores meta and clears everything on clearIndex', async () => {
    expect(await db.getMeta('backfill')).toBeNull()
    await db.setMeta('backfill', 'true')
    expect(await db.getMeta('backfill')).toBe('true')
    await db.setMeta('backfill', 'false')
    expect(await db.getMeta('backfill')).toBe('false')

    await db.upsertSessionIndex('s1', [{ messageId: 'm1', text: 'to be cleared' }])
    await db.clearIndex()
    expect(await db.queryIndex('cleared', 10)).toEqual([])
    expect(await db.getMeta('backfill')).toBeNull()
  })

  it('respects the query limit', async () => {
    await db.upsertSessionIndex(
      's1',
      Array.from({ length: 20 }, (_, i) => ({ messageId: `m${i}`, text: `common needle text ${i}` }))
    )
    expect(await db.queryIndex('needle', 5)).toHaveLength(5)
  })
})
