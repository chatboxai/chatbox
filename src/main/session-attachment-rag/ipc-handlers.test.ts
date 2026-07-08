import os from 'node:os'
import path from 'node:path'
import * as fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Drives the registered ipcMain handlers against the REAL libsql-backed db.ts
// (temp file via the SESSION_ATTACHMENT_RAG_*_PATH env overrides — same harness
// as db.test.ts). Only the heavy collaborators are mocked: the vector store,
// the embedding/rerank model providers, and `ai`'s embedMany.

const vec = vi.hoisted(() => ({
  indexes: new Set<string>(),
  queryResults: [] as Array<{ score: number; metadata: Record<string, unknown> | null }>,
  queryCalls: [] as Array<{ indexName: string; topK: number }>,
}))

vi.mock('@mastra/libsql', () => ({
  LibSQLVector: class {
    listIndexes(): Promise<string[]> {
      return Promise.resolve([...vec.indexes])
    }
    deleteIndex({ indexName }: { indexName: string }): Promise<void> {
      vec.indexes.delete(indexName)
      return Promise.resolve()
    }
    query(params: { indexName: string; queryVector: number[]; topK: number }) {
      vec.queryCalls.push({ indexName: params.indexName, topK: params.topK })
      return Promise.resolve(vec.queryResults)
    }
  },
}))

// Captures ipcMain.handle registrations so tests can invoke handlers directly.
const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  userDataDir: '',
}))

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => ipc.userDataDir },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      ipc.handlers.set(channel, handler)
    },
  },
}))

vi.mock('../util', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const models = vi.hoisted(() => ({
  embedManyCalls: [] as unknown[],
  rerankImpl: undefined as undefined | ((...args: unknown[]) => unknown),
}))

vi.mock('ai', () => ({
  embedMany: vi.fn((params: unknown) => {
    models.embedManyCalls.push(params)
    return Promise.resolve({ embeddings: [[0.1, 0.2, 0.3]] })
  }),
}))

vi.mock('./model-providers', () => ({
  getSessionAttachmentEmbeddingProvider: vi.fn(() => Promise.resolve({ modelId: 'mock-embedding' })),
  getSessionAttachmentRerankProvider: vi.fn(() => Promise.resolve({ modelId: 'mock-rerank' })),
}))

vi.mock('../../shared/models/rerank', () => ({
  rerank: vi.fn((...args: unknown[]) => {
    if (models.rerankImpl) return models.rerankImpl(...args)
    return Promise.reject(new Error('rerank not stubbed'))
  }),
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
  handlers.registerSessionAttachmentRagHandlers()
  return mod
}

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipc.handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler({}, ...args) as Promise<T>
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-rag-ipc-'))
  ipc.userDataDir = tmpDir
  vec.indexes = new Set<string>()
  vec.queryResults = []
  vec.queryCalls = []
  models.embedManyCalls = []
  models.rerankImpl = undefined
  process.env.SESSION_ATTACHMENT_RAG_DB_PATH = path.join(tmpDir, 'meta.db')
  process.env.SESSION_ATTACHMENT_RAG_VECTOR_DB_PATH = path.join(tmpDir, 'vec.db')
  db = await loadAndRegister()
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

describe('create + get-attachments', () => {
  it('rejects unsupported file types', async () => {
    await expect(invoke('session-attachment-rag:create', { ...baseAttachment, filename: 'movie.mp4' })).rejects.toThrow(
      'session_attachment_rag_unsupported_file_type'
    )
  })

  it('creates an attachment and returns the UI shape with numeric timestamps', async () => {
    const created = await invoke<Record<string, unknown>>('session-attachment-rag:create', baseAttachment)
    expect(created).toMatchObject({
      sessionId: 'sess-1',
      messageId: 'msg-1',
      filename: 'doc.md',
      availability: 'allowed',
      indexStatus: 'pending',
      chunkCount: 0,
    })
    expect(typeof created.createdAt).toBe('number')

    const listed = await invoke<Record<string, unknown>[]>('session-attachment-rag:get-attachments', [created.id])
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: created.id, indexStatus: 'pending', availability: 'allowed' })
  })

  it('filters canceled attachments out of get-attachments', async () => {
    const created = await invoke<Record<string, unknown>>('session-attachment-rag:create', baseAttachment)
    // deleting a pending attachment cancels it rather than hard-deleting
    await invoke('session-attachment-rag:delete-attachment', created.id)
    const listed = await invoke<Record<string, unknown>[]>('session-attachment-rag:get-attachments', [created.id])
    expect(listed).toEqual([])
  })

  it('tolerates a missing ids argument', async () => {
    await expect(invoke('session-attachment-rag:get-attachments', undefined)).resolves.toEqual([])
  })
})

describe('lifecycle deletes', () => {
  it('delete-message-attachments removes only that message', async () => {
    const a = await invoke<Record<string, unknown>>('session-attachment-rag:create', baseAttachment)
    const b = await invoke<Record<string, unknown>>('session-attachment-rag:create', {
      ...baseAttachment,
      messageId: 'msg-2',
      attachmentStorageKey: 'key-2',
    })

    await invoke('session-attachment-rag:delete-message-attachments', 'msg-1')

    const listed = await invoke<Record<string, unknown>[]>('session-attachment-rag:get-attachments', [a.id, b.id])
    expect(listed.map((x) => x.id)).toEqual([b.id])
  })

  it('delete-session-attachments removes the whole session', async () => {
    const a = await invoke<Record<string, unknown>>('session-attachment-rag:create', baseAttachment)
    const other = await invoke<Record<string, unknown>>('session-attachment-rag:create', {
      ...baseAttachment,
      sessionId: 'sess-2',
      attachmentStorageKey: 'key-2',
    })

    await invoke('session-attachment-rag:delete-session-attachments', 'sess-1')

    const listed = await invoke<Record<string, unknown>[]>('session-attachment-rag:get-attachments', [a.id, other.id])
    expect(listed.map((x) => x.id)).toEqual([other.id])
  })
})

describe('retry', () => {
  it('resets a failed attachment back to pending', async () => {
    const created = await invoke<Record<string, unknown>>('session-attachment-rag:create', baseAttachment)
    await db.markSessionAttachmentIndexing(created.id as number)
    await db.markSessionAttachmentFailed(created.id as number, 'boom')

    await invoke('session-attachment-rag:retry', created.id)

    const listed = await invoke<Record<string, unknown>[]>('session-attachment-rag:get-attachments', [created.id])
    expect(listed[0].indexStatus).toBe('pending')
  })
})

describe('query', () => {
  async function createReadyAttachment(overrides: Partial<typeof baseAttachment> = {}) {
    const created = await invoke<Record<string, unknown>>('session-attachment-rag:create', {
      ...baseAttachment,
      ...overrides,
    })
    const id = created.id as number
    await db.markSessionAttachmentIndexing(id)
    await db.markSessionAttachmentReady(id)
    return id
  }

  function hit(parentId: number, score: number, text = `text-${parentId}`) {
    return {
      score,
      metadata: {
        attachmentId: 1,
        parentId,
        filename: 'doc.md',
        chunkOrder: 0,
        rawText: text,
      },
    }
  }

  it('returns [] for an empty query or empty attachment ids', async () => {
    await expect(invoke('session-attachment-rag:query', { attachmentIds: [], query: 'hello' })).resolves.toEqual([])
    await expect(invoke('session-attachment-rag:query', { attachmentIds: [1], query: '   ' })).resolves.toEqual([])
  })

  it('returns [] when no attachment is ready', async () => {
    const created = await invoke<Record<string, unknown>>('session-attachment-rag:create', baseAttachment)
    await expect(
      invoke('session-attachment-rag:query', { attachmentIds: [created.id], query: 'hello' })
    ).resolves.toEqual([])
    expect(models.embedManyCalls).toHaveLength(0)
  })

  it('embeds, queries the vector store, dedupes by parent, and caps at finalTopK', async () => {
    const id = await createReadyAttachment()
    vec.queryResults = [hit(1, 0.9), hit(1, 0.8), hit(2, 0.7), hit(3, 0.6)]

    const results = await invoke<Array<{ parentId: number; score: number }>>('session-attachment-rag:query', {
      attachmentIds: [id],
      query: 'find me',
      plan: { recallTopK: 10, finalTopK: 2 },
    })

    expect(models.embedManyCalls).toHaveLength(1)
    expect(vec.queryCalls).toEqual([{ indexName: `sa_${id}`, topK: 10 }])
    // duplicate parent 1 deduped; capped to finalTopK=2
    expect(results.map((r) => r.parentId)).toEqual([1, 2])
  })

  it('clamps an oversized plan to the server-side limits', async () => {
    const id = await createReadyAttachment()
    vec.queryResults = Array.from({ length: 30 }, (_, i) => hit(i + 1, 1 - i / 100))

    const results = await invoke<Array<{ parentId: number }>>('session-attachment-rag:query', {
      attachmentIds: [id],
      query: 'find me',
      plan: { recallTopK: 999, finalTopK: 999 },
    })

    expect(vec.queryCalls[0].topK).toBe(20) // QUERY_RECALL_TOP_K cap
    expect(results).toHaveLength(12) // QUERY_RETURN_TOP_K_MAX cap
  })

  it('applies reranking when enabled and survives a rerank failure', async () => {
    const id = await createReadyAttachment()
    vec.queryResults = [hit(1, 0.9), hit(2, 0.5)]

    // successful rerank flips the order
    models.rerankImpl = (results: unknown) =>
      Promise.resolve(
        (results as Array<{ metadata: { parentId: number } }>)
          .slice()
          .reverse()
          .map((r, i) => ({ result: r, score: 1 - i / 10 }))
      )
    const reranked = await invoke<Array<{ parentId: number }>>('session-attachment-rag:query', {
      attachmentIds: [id],
      query: 'find me',
      plan: { rerank: { enabled: true, model: 'mock-rerank' } },
    })
    expect(reranked.map((r) => r.parentId)).toEqual([2, 1])

    // a throwing rerank falls back to vector-score order instead of failing the query
    models.rerankImpl = () => Promise.reject(new Error('rerank down'))
    const fallback = await invoke<Array<{ parentId: number }>>('session-attachment-rag:query', {
      attachmentIds: [id],
      query: 'find me',
      plan: { rerank: { enabled: true, model: 'mock-rerank' } },
    })
    expect(fallback.map((r) => r.parentId)).toEqual([1, 2])
  })
})

describe('read-parents', () => {
  it('returns [] without attachmentIds (session isolation) and supports the legacy array form', async () => {
    await expect(invoke('session-attachment-rag:read-parents', [1, 2])).resolves.toEqual([])
    await expect(invoke('session-attachment-rag:read-parents', { parentIds: [1], attachmentIds: [] })).resolves.toEqual(
      []
    )
  })

  it('reads parent blocks scoped to the allowed attachments', async () => {
    const created = await invoke<Record<string, unknown>>('session-attachment-rag:create', baseAttachment)
    const id = created.id as number
    await db.replaceAttachmentParentsAndChunks(
      id,
      [{ parentOrder: 0, text: 'parent text', tokenEstimate: 10, charCount: 11, sectionPath: 'Intro' }],
      []
    )
    const rs = await db.getDatabase().execute({
      sql: 'SELECT id FROM session_attachment_parent WHERE attachment_id = ?',
      args: [id],
    })
    const parentId = Number(rs.rows[0].id)

    const rows = await invoke<Array<Record<string, unknown>>>('session-attachment-rag:read-parents', {
      parentIds: [parentId],
      attachmentIds: [id],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: parentId,
      attachmentId: id,
      filename: 'doc.md',
      sectionPath: 'Intro',
      text: 'parent text',
      tokenEstimate: 10,
      charCount: 11,
    })

    // parents of other attachments are not readable
    const denied = await invoke<Array<Record<string, unknown>>>('session-attachment-rag:read-parents', {
      parentIds: [parentId],
      attachmentIds: [id + 999],
    })
    expect(denied).toEqual([])
  })
})

describe('maintenance', () => {
  it('run-maintenance purges canceled attachments and reports orphan deletions', async () => {
    const keep = await invoke<Record<string, unknown>>('session-attachment-rag:create', baseAttachment)
    const cancel = await invoke<Record<string, unknown>>('session-attachment-rag:create', {
      ...baseAttachment,
      messageId: 'msg-2',
      attachmentStorageKey: 'key-2',
    })
    await invoke('session-attachment-rag:delete-attachment', cancel.id)

    const orphan = await invoke<Record<string, unknown>>('session-attachment-rag:create', {
      ...baseAttachment,
      sessionId: 'sess-gone',
      messageId: 'msg-gone',
      attachmentStorageKey: 'key-3',
    })

    const report = await invoke<{ canceledPurgedCount: number; orphanDeletedIds: number[] }>(
      'session-attachment-rag:run-maintenance',
      { sessionIds: ['sess-1'], messageIds: ['msg-1'] }
    )

    expect(report.canceledPurgedCount).toBeGreaterThanOrEqual(1)
    expect(report.orphanDeletedIds).toContain(orphan.id)
    expect(report.orphanDeletedIds).not.toContain(keep.id)
  })

  it('clear-all wipes everything', async () => {
    const created = await invoke<Record<string, unknown>>('session-attachment-rag:create', baseAttachment)
    await invoke('session-attachment-rag:clear-all')
    const listed = await invoke<Record<string, unknown>[]>('session-attachment-rag:get-attachments', [created.id])
    expect(listed).toEqual([])
  })
})
