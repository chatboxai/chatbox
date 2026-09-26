import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  base64ToVector,
  cosineSimilarity,
  SQLiteBlobVectorStore,
  vectorToBase64,
} from '../vector-store'

describe('vector-store helpers', () => {
  it('converts vector to base64 and back with exact fidelity', () => {
    const original = [0.12345, -0.98765, 0.0, 1.0, -1.0, 3.14159]
    const b64 = vectorToBase64(original)
    expect(typeof b64).toBe('string')
    expect(b64.length).toBeGreaterThan(0)

    const restored = base64ToVector(b64)
    expect(restored.length).toBe(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 5)
    }
  })

  it('computes cosine similarity accurately', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([1, 0, 0])
    const c = new Float32Array([0, 1, 0])
    const d = new Float32Array([-1, 0, 0])

    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5)
    expect(cosineSimilarity(a, c)).toBeCloseTo(0.0, 5)
    expect(cosineSimilarity(a, d)).toBeCloseTo(-1.0, 5)

    // Zero vector
    const zero = new Float32Array([0, 0, 0])
    expect(cosineSimilarity(a, zero)).toBe(0)
  })
})

describe('SQLiteBlobVectorStore', () => {
  let mockDb: any
  let mockDatabase: any
  let vectorStore: SQLiteBlobVectorStore

  beforeEach(() => {
    mockDb = {
      run: vi.fn().mockResolvedValue({ changes: { changes: 1 } }),
      execute: vi.fn().mockResolvedValue({ changes: { changes: 1 } }),
      executeSet: vi.fn().mockResolvedValue({ changes: { changes: 1 } }),
      query: vi.fn().mockResolvedValue({ values: [] }),
    }
    mockDatabase = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getDatabase: vi.fn().mockReturnValue(mockDb),
    }
    vectorStore = new SQLiteBlobVectorStore(mockDatabase)
  })

  it('upsert saves vectors via executeSet in batch', async () => {
    const records = [
      { chunkId: 1, attachmentId: 10, vector: [1, 0, 0] },
      { chunkId: 2, attachmentId: 10, vector: [0, 1, 0] },
    ]
    await vectorStore.upsert(records)

    expect(mockDb.executeSet).toHaveBeenCalledTimes(1)
    const statements = mockDb.executeSet.mock.calls[0][0]
    expect(statements).toHaveLength(2)
    expect(statements[0].statement).toContain('INSERT OR REPLACE INTO session_attachment_vector')
    expect(statements[0].values[0]).toBe(1)
    expect(statements[0].values[1]).toBe(10)
  })

  it('query computes cosine similarity and ranks results descending', async () => {
    const v1 = vectorToBase64([1, 0, 0]) // similarity = 1.0
    const v2 = vectorToBase64([0.7071, 0.7071, 0]) // similarity ≈ 0.707
    const v3 = vectorToBase64([0, 1, 0]) // similarity = 0.0

    mockDb.query.mockResolvedValueOnce({
      values: [
        { chunk_id: 101, attachment_id: 1, vector: v3 },
        { chunk_id: 102, attachment_id: 1, vector: v1 },
        { chunk_id: 103, attachment_id: 1, vector: v2 },
      ],
    })

    const hits = await vectorStore.query({
      attachmentIds: [1],
      queryVector: [1, 0, 0],
      topK: 2,
    })

    expect(hits).toHaveLength(2)
    expect(hits[0].chunkId).toBe(102)
    expect(hits[0].score).toBeCloseTo(1.0, 4)
    expect(hits[1].chunkId).toBe(103)
    expect(hits[1].score).toBeCloseTo(0.7071, 3)
  })

  it('deleteIndex deletes vectors for the given attachment', async () => {
    await vectorStore.deleteIndex(42)
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM session_attachment_vector WHERE attachment_id = ?'),
      [42]
    )
  })
})
