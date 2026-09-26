import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileRagDatabase } from '../db'
import { MobileLocalRagEngine } from '../engine'
import { MobileRagIndexer } from '../indexer'
import { SQLiteBlobVectorStore, vectorToBase64 } from '../vector-store'

describe('MobileLocalRagEngine Integration', () => {
  let mockSqliteDb: any
  let mockConnection: any
  let database: MobileRagDatabase
  let vectorStore: SQLiteBlobVectorStore
  let engine: MobileLocalRagEngine

  // In-memory test state to simulate SQLite behavior accurately
  let attachmentsTable: Map<number, any>
  let parentsTable: Map<number, any>
  let chunksTable: Map<number, any>
  let vectorsTable: Map<number, any>
  let nextId: number

  beforeEach(() => {
    attachmentsTable = new Map()
    parentsTable = new Map()
    chunksTable = new Map()
    vectorsTable = new Map()
    nextId = 1

    mockSqliteDb = {
      open: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ changes: { changes: 0 } }),
      run: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes('INSERT INTO session_attachment (')) {
          const id = nextId++
          const rec = {
            id,
            session_id: params[0],
            message_id: params[1],
            attachment_storage_key: params[2],
            filename: params[3],
            mime_type: params[4],
            file_size: params[5],
            token_estimate: params[6],
            parser_type: params[7],
            status: 'pending',
            indexing_stage: 'queued',
            total_chunks: 0,
            embedded_chunks: 0,
            created_at: params[8],
          }
          attachmentsTable.set(id, rec)
          return { changes: { changes: 1, lastId: id } }
        }
        if (sql.includes('INSERT INTO session_attachment_parent')) {
          const id = nextId++
          const rec = {
            id,
            attachment_id: params[0],
            parent_order: params[1],
            section_path: params[2],
            doc_type: params[3],
            page_start: params[4],
            page_end: params[5],
            text: params[6],
            token_estimate: params[7],
            char_count: params[8],
            created_at: params[9],
          }
          parentsTable.set(id, rec)
          return { changes: { changes: 1, lastId: id } }
        }
        if (sql.includes('INSERT INTO session_attachment_chunk')) {
          const id = nextId++
          const rec = {
            id,
            attachment_id: params[0],
            parent_id: params[1],
            chunk_order: params[2],
            section_path: params[3],
            page_start: params[4],
            page_end: params[5],
            raw_text: params[6],
            embedded_text: params[7],
            token_estimate: params[8],
            created_at: params[9],
          }
          chunksTable.set(id, rec)
          return { changes: { changes: 1, lastId: id } }
        }
        if (sql.includes('UPDATE session_attachment SET')) {
          const id = params[params.length - 1]
          const existing = attachmentsTable.get(id) || {}
          if (sql.includes('status = ?') && sql.includes('indexing_stage = ?') && sql.includes('completed_at = ?')) {
            existing.status = params[0]
            existing.indexing_stage = params[1]
            existing.completed_at = params[2]
          } else if (sql.includes('indexing_stage = ?') && sql.includes('total_chunks = ?')) {
            existing.indexing_stage = params[0]
            existing.total_chunks = params[1]
            existing.embedded_chunks = params[2]
            if (sql.includes('embedding_model = ?')) {
              existing.embedding_model = params[3]
              existing.embedding_dimension = params[4]
            }
          } else if (sql.includes('status = ?') && sql.includes('indexing_stage = ?') && sql.includes('processing_started_at = ?')) {
            existing.status = params[0]
            existing.indexing_stage = params[1]
            existing.processing_started_at = params[2]
          }
          attachmentsTable.set(id, existing)
          return { changes: { changes: 1 } }
        }
        return { changes: { changes: 1 } }
      }),
      executeSet: vi.fn().mockImplementation(async (statements: any[]) => {
        for (const s of statements) {
          if (s.statement.includes('DELETE FROM session_attachment_vector WHERE attachment_id = ?')) {
            const attId = s.values[0]
            for (const [k, v] of [...vectorsTable.entries()]) {
              if (v.attachment_id === attId) vectorsTable.delete(k)
            }
          }
          if (s.statement.includes('INSERT OR REPLACE INTO session_attachment_vector')) {
            vectorsTable.set(s.values[0], {
              chunk_id: s.values[0],
              attachment_id: s.values[1],
              vector: s.values[2],
            })
          }
        }
        return { changes: { changes: statements.length } }
      }),
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes('SELECT * FROM session_attachment WHERE id = ?')) {
          const rec = attachmentsTable.get(params[0])
          return { values: rec ? [rec] : [] }
        }
        if (sql.includes('SELECT * FROM session_attachment WHERE id IN (')) {
          const values = params.map((id) => attachmentsTable.get(id)).filter(Boolean)
          return { values }
        }
        if (sql.includes('SELECT 1 FROM session_attachment_vector WHERE attachment_id = ?')) {
          const exists = [...vectorsTable.values()].some((v) => v.attachment_id === params[0])
          return { values: exists ? [{ 1: 1 }] : [] }
        }
        if (sql.includes('FROM session_attachment_chunk WHERE attachment_id = ?')) {
          const values = [...chunksTable.values()].filter((c) => c.attachment_id === params[0])
          return { values }
        }
        if (sql.includes('SELECT chunk_id, attachment_id, vector FROM session_attachment_vector')) {
          const values = [...vectorsTable.values()].filter((v) => params.includes(v.attachment_id))
          return { values }
        }
        if (sql.includes('FROM session_attachment_chunk c')) {
          if (sql.includes('LIKE')) {
            const values = [...chunksTable.values()].map((c) => {
              const a = attachmentsTable.get(c.attachment_id)
              return { ...c, filename: a?.filename ?? '' }
            })
            return { values }
          }
          // listChunksWithDetails
          const ids = params
          const values = ids
            .map((id) => {
              const c = chunksTable.get(id)
              if (!c) return null
              const a = attachmentsTable.get(c.attachment_id)
              return { ...c, filename: a?.filename ?? '' }
            })
            .filter(Boolean)
          return { values }
        }
        if (sql.includes('FROM session_attachment_parent p')) {
          // readParents
          const parentIds = params.slice(0, params.length / 2)
          const allowedAttachmentIds = params.slice(params.length / 2)
          const values = parentIds
            .map((pid) => {
              const p = parentsTable.get(pid)
              if (!p || !allowedAttachmentIds.includes(p.attachment_id)) return null
              const a = attachmentsTable.get(p.attachment_id)
              return { ...p, filename: a?.filename ?? '' }
            })
            .filter(Boolean)
          return { values }
        }
        return { values: [] }
      }),
    }

    mockConnection = {
      closeConnection: vi.fn(),
      createConnection: vi.fn().mockResolvedValue(mockSqliteDb),
    }

    database = new MobileRagDatabase(mockConnection)
    vectorStore = new SQLiteBlobVectorStore(database)

    const mockIndexerDeps = {
      getContent: vi.fn().mockResolvedValue(`
# Gu Zhen Ren Lore
Spring Autumn Cicada is a Rank 6 Time Path Immortal Gu.
It was created by Red Lotus Demon Venerable.

# Character Profile
Fang Yuan reincarnated using Spring Autumn Cicada 500 years into the past.
He started on Qing Mao Mountain in Southern Border.
`),
      resolveEmbeddingProvider: vi.fn().mockResolvedValue({
        provider: {} as any,
        modelString: 'openai:text-embedding-3-small',
      }),
      embedValues: vi.fn().mockImplementation(async (_model, values: string[]) => {
        // Return 3D mock embeddings based on text content
        return values.map((text) => {
          if (text.includes('Spring Autumn Cicada') || text.includes('Cicada')) {
            return [1.0, 0.0, 0.0]
          }
          if (text.includes('Qing Mao Mountain') || text.includes('Fang Yuan')) {
            return [0.0, 1.0, 0.0]
          }
          return [0.0, 0.0, 1.0]
        })
      }),
    }

    const indexer = new MobileRagIndexer(database, vectorStore, mockIndexerDeps)
    engine = new MobileLocalRagEngine({
      database,
      vectorStore,
      indexer,
      resolveEmbeddingProvider: mockIndexerDeps.resolveEmbeddingProvider,
      embedValues: mockIndexerDeps.embedValues,
    })
  })

  it('runs complete lifecycle: create -> index -> query -> readParents', async () => {
    // 1. Create attachment
    const attachment = await engine.createAttachment({
      sessionId: 'session_gzr',
      messageId: 'msg_001',
      attachmentStorageKey: 'gzr_blob_key',
      filename: 'gu_zhen_ren.md',
      mimeType: 'text/markdown',
      fileSize: 1000,
      tokenEstimate: 200,
    })

    expect(attachment.id).toBeGreaterThan(0)
    expect(attachment.status).toBe('pending')

    // Wait for the asynchronous background indexing queue to drain
    // engine.enqueueIndexing runs in background queue
    await (engine as any).queue

    // 2. Verify attachment is ready
    const [readyAttachment] = await engine.getAttachments([attachment.id])
    expect(readyAttachment.status).toBe('ready')
    expect(readyAttachment.indexStatus).toBe('ready')
    expect(readyAttachment.totalChunks).toBeGreaterThan(0)
    expect(readyAttachment.embeddedChunks).toBe(readyAttachment.totalChunks)
    expect(readyAttachment.embeddingModel).toBe('openai:text-embedding-3-small')

    // 3. Query for "Cicada"
    const results = await engine.query({
      attachmentIds: [attachment.id],
      query: 'Spring Autumn Cicada',
      plan: { recallTopK: 10, finalTopK: 5 },
    })

    expect(results.length).toBeGreaterThan(0)
    // The top hit should have matched the cicada vector ([1, 0, 0])
    expect(results[0].score).toBeGreaterThan(0.9)
    expect(results[0].filename).toBe('gu_zhen_ren.md')
    expect(results[0].parentId).toBeDefined()

    // 4. Read back parent context
    const parents = await engine.readParents({
      parentIds: [results[0].parentId],
      attachmentIds: [attachment.id],
    })

    expect(parents.length).toBe(1)
    expect(parents[0].text).toContain('Gu Zhen Ren')
    expect(parents[0].tokenEstimate).toBeGreaterThan(0)
    expect(parents[0].charCount).toBeGreaterThan(0)
  })
})
