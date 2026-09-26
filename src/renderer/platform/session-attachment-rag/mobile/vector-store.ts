import type { MobileVectorHit, MobileVectorRecord } from './types'

export function vectorToBase64(vector: number[] | Float32Array): string {
  const f32 = vector instanceof Float32Array ? vector : new Float32Array(vector)
  const uint8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
  let binary = ''
  const len = uint8.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i])
  }
  return btoa(binary)
}

export function base64ToVector(base64: string): Float32Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 0
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

export class SQLiteBlobVectorStore {
  constructor(private dbProvider: { getDatabase: () => any }) {}

  async upsert(records: MobileVectorRecord[]): Promise<void> {
    if (records.length === 0) return
    const db = this.dbProvider.getDatabase()

    const statements = records.map((record) => {
      const b64 = vectorToBase64(record.vector)
      return {
        statement:
          'INSERT OR REPLACE INTO session_attachment_vectors (chunk_id, attachment_id, vector) VALUES (?, ?, ?);',
        values: [record.chunkId, record.attachmentId, b64],
      }
    })

    if (typeof db.executeSet === 'function') {
      await db.executeSet(statements)
    } else {
      for (const stmt of statements) {
        await db.run(stmt.statement, stmt.values)
      }
    }
  }

  async deleteIndex(attachmentId: number): Promise<void> {
    const db = this.dbProvider.getDatabase()
    await db.run('DELETE FROM session_attachment_vectors WHERE attachment_id = ?;', [attachmentId])
  }

  /**
   * Bounded-memory vector search with batched scoring.
   * Reads vectors in batches (e.g. 500 items per batch) to keep memory bounded on mobile devices.
   */
  async query(params: {
    attachmentIds: number[]
    queryVector: number[] | Float32Array
    topK: number
  }): Promise<MobileVectorHit[]> {
    if (params.attachmentIds.length === 0) return []

    const db = this.dbProvider.getDatabase()
    const qVec = params.queryVector instanceof Float32Array ? params.queryVector : new Float32Array(params.queryVector)
    const placeholders = params.attachmentIds.map(() => '?').join(',')
    const batchSize = 500
    let offset = 0
    let hasMore = true

    const topHits: MobileVectorHit[] = []

    const insertTopHit = (hit: MobileVectorHit) => {
      if (topHits.length < params.topK) {
        topHits.push(hit)
        topHits.sort((a, b) => b.score - a.score)
      } else if (hit.score > topHits[topHits.length - 1].score) {
        topHits[topHits.length - 1] = hit
        topHits.sort((a, b) => b.score - a.score)
      }
    }

    while (hasMore) {
      const res = await db.query(
        `SELECT chunk_id, attachment_id, vector FROM session_attachment_vectors WHERE attachment_id IN (${placeholders}) LIMIT ? OFFSET ?;`,
        [...params.attachmentIds, batchSize, offset]
      )

      const rows: any[] = res.values ?? []
      if (rows.length === 0) {
        hasMore = false
        break
      }

      for (const row of rows) {
        const chunkId = Number(row.chunk_id)
        const attachmentId = Number(row.attachment_id)
        const vec = base64ToVector(row.vector)
        const score = cosineSimilarity(qVec, vec)

        insertTopHit({ chunkId, attachmentId, score })
      }

      if (rows.length < batchSize) {
        hasMore = false
      } else {
        offset += batchSize
      }
    }

    return topHits
  }
}
