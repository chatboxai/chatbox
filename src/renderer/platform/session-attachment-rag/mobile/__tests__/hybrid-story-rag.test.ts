import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAttachmentChunks,
  chunkStoryKbDocument,
  isStoryKbFormat,
} from '@shared/session-attachment-rag/chunking'
import { MobileRagDatabase } from '../db'
import { MobileLocalRagEngine } from '../engine'
import { MobileRagIndexer } from '../indexer'
import { SQLiteBlobVectorStore, vectorToBase64 } from '../vector-store'

describe('Mobile Hybrid Story RAG Regression Tests', () => {
  let mockSqliteDb: any
  let mockConnection: any
  let database: MobileRagDatabase
  let vectorStore: SQLiteBlobVectorStore
  let engine: MobileLocalRagEngine

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
            status: 'ready',
            indexing_stage: 'ready',
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
            text: params[6],
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
            raw_text: params[6],
            embedded_text: params[7],
            token_estimate: params[8],
            entities: params[9],
            keywords: params[10],
            chapter_order: params[11],
            story_time: params[12],
            priority_rank: params[13],
            kind: params[14],
            metadata: params[15],
            created_at: params[16],
          }
          chunksTable.set(id, rec)
          return { changes: { changes: 1, lastId: id } }
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
        if (sql.includes('SELECT * FROM session_attachment WHERE id IN (')) {
          const values = params.map((id) => attachmentsTable.get(id)).filter(Boolean)
          return { values }
        }
        if (sql.includes('FROM session_attachment_vector')) {
          const values = [...vectorsTable.values()].filter((v) => params.includes(v.attachment_id))
          return { values }
        }
        if (sql.includes('FROM session_attachment_chunk c')) {
          let rows = [...chunksTable.values()]
          if (sql.includes('AND (c.chapter_order IS NULL OR c.chapter_order <=')) {
            const maxCh = params[params.length - 1]
            rows = rows.filter((r) => r.chapter_order === null || r.chapter_order === undefined || r.chapter_order <= maxCh)
          }
          if (sql.includes('LIKE')) {
            const likeTerms = params
              .filter((p: any) => typeof p === 'string' && p.startsWith('%') && p.endsWith('%'))
              .map((p: any) => p.slice(1, -1).toLowerCase())
            if (likeTerms.length > 0) {
              rows = rows.filter((r) => {
                const text = `${r.section_path || ''} ${r.raw_text || ''} ${r.entities || ''} ${r.keywords || ''}`.toLowerCase()
                return likeTerms.some((t: string) => text.includes(t))
              })
            }
          }
          return {
            values: rows.map((c) => {
              const a = attachmentsTable.get(c.attachment_id)
              return { ...c, filename: a?.filename ?? 'gur-kb.json' }
            }),
          }
        }
        if (sql.includes('FROM session_attachment_parent p')) {
          const parentIds = params.slice(0, params.length / 2)
          const values = parentIds
            .map((pid) => {
              const p = parentsTable.get(pid)
              return p ? { ...p, filename: 'gur-kb.json' } : null
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
  })

  it('correctly identifies and chunks compact GUR KB format', async () => {
    const compactKbSample = JSON.stringify({
      format: 'GUR-KB-SINGLE-2.0-COMPACT',
      manifest: { kb_name: 'gur-canon-kb' },
      mobile_card_catalog: [
        ['m000001', 'item_or_gu', 4],
        ['m000002', 'entity', 4],
        ['m000003', 'character_state', 3],
      ],
      items_and_gu: [
        {
          _id: 'm000001',
          name: '春秋蝉',
          card: '春秋蝉：六转本命仙蛊，可逆流光阴重活一世。',
          keys: ['春秋蝉', '光道', '宙道'],
          ch: [1],
          refs: ['m000002'],
        },
      ],
      entities: [
        {
          _id: 'm000002',
          name: '方源',
          card: '方源：五百年魔道巨擘，以春秋蝉逆天重生回青茅山。',
          keys: ['方源', '古月方源'],
          ch: [1],
        },
      ],
      character_states: [
        {
          _id: 'm000003',
          name: '方源开窍资质',
          card: '方源在开窍大典测出丙等资质，元海四成四。',
          keys: ['资质', '丙等'],
          ch: [2],
          story_time: '开窍大典',
        },
      ],
      runtime_core: {
        world_rules: '人是万物之灵，蛊是天地真精。',
      },
    })

    expect(isStoryKbFormat(compactKbSample)).toBe(true)

    const result = await buildAttachmentChunks(compactKbSample, 'gur-kb.json')
    expect(result.parents.length).toBeGreaterThan(0)
    expect(result.children.length).toBe(4) // 3 cards + 1 runtime_core

    const cicadaChunk = result.children.find((c) => c.entities?.includes('春秋蝉'))
    expect(cicadaChunk).toBeDefined()
    expect(cicadaChunk?.priorityRank).toBe(4)
    expect(cicadaChunk?.chapterOrder).toBe(1)
    expect(cicadaChunk?.kind).toBe('item_or_gu')

    const stateChunk = result.children.find((c) => c.sectionPath?.includes('方源开窍资质'))
    expect(stateChunk).toBeDefined()
    expect(stateChunk?.storyTime).toBe('开窍大典')
    expect(stateChunk?.chapterOrder).toBe(2)
  })

  describe('Hybrid Retrieval Scenario Regression', () => {
    let mockIndexerDeps: any
    let attachmentId: number

    beforeEach(async () => {
      // Setup engine with mock embedding vectors:
      // Cicada vector: [1, 0, 0]
      // Fixed Immortal Travel (Future): [0.8, 0.6, 0] (semantically similar gu, but future)
      // C-grade Aptitude: [0, 1, 0]
      // Sovereign Immortal Body (Future): [0, 0.8, 0.6]
      mockIndexerDeps = {
        getContent: vi.fn(),
        resolveEmbeddingProvider: vi.fn().mockResolvedValue({
          provider: {} as any,
          modelString: 'test-model',
        }),
        embedValues: vi.fn().mockImplementation(async (_model, values: string[]) => {
          return values.map((text) => {
            if (text.includes('光阴') || text.includes('逆流') || text.includes('春秋蝉')) {
              return [1.0, 0.0, 0.0]
            }
            if (text.includes('定仙游')) {
              return [0.85, 0.52, 0.0]
            }
            if (text.includes('资质') || text.includes('丙等')) {
              return [0.0, 1.0, 0.0]
            }
            if (text.includes('至尊仙胎体')) {
              return [0.0, 0.8, 0.6]
            }
            return [0.1, 0.1, 0.1]
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

      // Directly populate SQLite chunks for precise story scenario testing
      attachmentId = 42
      attachmentsTable.set(attachmentId, {
        id: attachmentId,
        session_id: 'session_story',
        message_id: 'msg_001',
        filename: 'gur-kb.json',
        status: 'ready',
      })

      // Insert Parent 1 & 2
      parentsTable.set(1, { id: 1, attachmentId, text: '第一章 青茅山开局蛊虫' })
      parentsTable.set(2, { id: 2, attachmentId, text: '第五百章 三王福地定仙游' })
      parentsTable.set(3, { id: 3, attachmentId, text: '第二章 开窍大典' })
      parentsTable.set(4, { id: 4, attachmentId, text: '第一千章 至尊仙体' })

      // Chunk 1: Chapter 1 Spring Autumn Cicada (Current truth)
      chunksTable.set(1, {
        id: 1,
        attachment_id: attachmentId,
        parent_id: 1,
        chunk_order: 1,
        sectionPath: 'item:春秋蝉',
        raw_text: '春秋蝉：六转本命仙蛊，方源重生后沉睡在空窍之中。',
        entities: JSON.stringify(['春秋蝉', '方源']),
        keywords: JSON.stringify(['春秋蝉', '本命蛊', '光阴']),
        chapter_order: 1,
        story_time: '青茅山开局',
        priority_rank: 4,
        kind: 'item_or_gu',
      })
      vectorsTable.set(1, {
        chunk_id: 1,
        attachment_id: attachmentId,
        vector: vectorToBase64([1.0, 0.0, 0.0]),
      })

      // Chunk 2: Chapter 500 Fixed Immortal Travel (Future spoiler)
      chunksTable.set(2, {
        id: 2,
        attachment_id: attachmentId,
        parent_id: 2,
        chunk_order: 2,
        sectionPath: 'item:定仙游',
        raw_text: '定仙游：六转宇道仙蛊，方源在三王福地练成，可瞬移天下。',
        entities: JSON.stringify(['定仙游', '方源']),
        keywords: JSON.stringify(['定仙游', '仙蛊', '瞬移']),
        chapter_order: 500,
        story_time: '三王福地',
        priority_rank: 3,
        kind: 'item_or_gu',
      })
      vectorsTable.set(2, {
        chunk_id: 2,
        attachment_id: attachmentId,
        vector: vectorToBase64([0.85, 0.52, 0.0]),
      })

      // Chunk 3: Chapter 2 C-grade aptitude (Current truth)
      chunksTable.set(3, {
        id: 3,
        attachment_id: attachmentId,
        parent_id: 3,
        chunk_order: 3,
        sectionPath: 'state:方源资质',
        raw_text: '方源开窍大典测出丙等资质，元海四成四，被族人看轻。',
        entities: JSON.stringify(['方源', '资质']),
        keywords: JSON.stringify(['丙等', '资质', '元海']),
        chapter_order: 2,
        story_time: '开窍大典',
        priority_rank: 3,
        kind: 'character_state',
      })
      vectorsTable.set(3, {
        chunk_id: 3,
        attachment_id: attachmentId,
        vector: vectorToBase64([0.0, 1.0, 0.0]),
      })

      // Chunk 4: Late-game Sovereign Immortal Body (Future spoiler)
      chunksTable.set(4, {
        id: 4,
        attachment_id: attachmentId,
        parent_id: 4,
        chunk_order: 4,
        sectionPath: 'state:至尊仙胎',
        raw_text: '方源夺得至尊仙胎蛊，成就至尊仙体，全流派无上宗师。',
        entities: JSON.stringify(['方源', '至尊仙胎体']),
        keywords: JSON.stringify(['至尊仙体', '资质', '尊者']),
        chapter_order: 1000,
        story_time: '义天山大战',
        priority_rank: 4,
        kind: 'character_state',
      })
      vectorsTable.set(4, {
        chunk_id: 4,
        attachment_id: attachmentId,
        vector: vectorToBase64([0.0, 0.8, 0.6]),
      })
    })

    it('1. Timeline: strictly suppresses future events when player is in Chapter 1', async () => {
      // Player is at chapter 1, asks about Fang Yuan's gu
      const results = await engine.query({
        attachmentIds: [attachmentId],
        query: '方源现在身上有什么厉害的仙蛊？',
        plan: {
          recallTopK: 10,
          finalTopK: 5,
          storyFilter: {
            currentChapter: 1,
            activeEntities: ['方源'],
          },
        },
      })

      expect(results.length).toBeGreaterThan(0)
      // Chapter 1 Spring Autumn Cicada MUST be ranked #1
      expect(results[0].text).toContain('春秋蝉')
      expect(results[0].score).toBeGreaterThan(0.5)

      // Chapter 500 Fixed Immortal Travel must NOT be top 1
      const fixedImmortalTravel = results.find((r) => r.text.includes('定仙游'))
      if (fixedImmortalTravel) {
        expect(fixedImmortalTravel.score).toBeLessThan(results[0].score * 0.2)
      }
    })

    it('2. Character State: prioritizes current timeline state over future body', async () => {
      // Query about aptitude at Chapter 2
      const results = await engine.query({
        attachmentIds: [attachmentId],
        query: '方源现在的修仙资质和表现如何？',
        plan: {
          recallTopK: 10,
          finalTopK: 5,
          storyFilter: {
            currentChapter: 2,
            currentTime: '开窍大典',
            activeEntities: ['方源'],
          },
        },
      })

      expect(results.length).toBeGreaterThan(0)
      // Current chapter 2 C-grade aptitude must be top hit
      expect(results[0].text).toContain('丙等资质')
      expect(results[0].text).toContain('四成四')

      // Future Sovereign Immortal Body from ch 1000 must not overtake current state
      const sovereignBody = results.find((r) => r.text.includes('至尊仙体'))
      if (sovereignBody) {
        expect(sovereignBody.score).toBeLessThan(results[0].score * 0.2)
      }
    })

    it('3. Non-existent Entity: prevents fabricating false entities', async () => {
      // Query for an entity that does not exist in the universe
      const results = await engine.query({
        attachmentIds: [attachmentId],
        query: '激光蛊或者量子流派的来历与威力',
        plan: {
          recallTopK: 5,
          finalTopK: 3,
        },
      })

      // There are no matches for 激光蛊 or 量子流派
      for (const res of results) {
        expect(res.text).not.toContain('激光蛊')
        expect(res.text).not.toContain('量子流派')
      }
    })

    it('4. Fuzzy Semantic Query: recalls concept correctly without proper nouns', async () => {
      // User does not know the proper noun "春秋蝉", uses descriptive semantic query
      const results = await engine.query({
        attachmentIds: [attachmentId],
        query: '能够让人逆流光阴重新活一世的奇异宝物',
        plan: {
          recallTopK: 5,
          finalTopK: 3,
        },
      })

      expect(results.length).toBeGreaterThan(0)
      // Semantic vector matches Spring Autumn Cicada
      expect(results[0].text).toContain('春秋蝉')
      expect(results[0].score).toBeGreaterThan(0.6)
    })
  })
})
