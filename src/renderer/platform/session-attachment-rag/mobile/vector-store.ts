import type { capSQLiteSet } from '@capacitor-community/sqlite'
import type { MobileRagDatabase } from './db'
import type { LocalVectorStore, VectorHit, VectorRecord } from './types'

export function vectorToBase64(vector: number[] | Float32Array): string {
  const f32 = vector instanceof Float32Array ? vector : new Float32Array(vector)
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
  let binary = ''
  const len = u8.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(u8[i])
  }
  return btoa(binary)
}

export function base64ToVector(base64: string): Float32Array {
  const binary = atob(base64)
  const len = binary.length
  const u8 = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    u8[i] = binary.charCodeAt(i)
  }
  return new Float32Array(u8.buffer)
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  const len = a.length
  for (let i = 0; i < len; i++) {
    const ai = a[i]
    const bi = b[i]
    dotProduct += ai * bi
    normA += ai * ai
    normB += bi * bi
  }
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

export class SQLiteBlobVectorStore implements LocalVectorStore {
  constructor(private database: MobileRagDatabase) {}

  public async createIndex(_attachmentId: number, _dimension: number): Promise<void> {
    // SQLite table is pre-created with schema.
    await this.database.initialize()
  }

  public async hasAttachmentVectorIndex(attachmentId: number): Promise<boolean> {
    await this.database.initialize()
    const db = this.database.getDatabase()
    const res = await db.query(
      'SELECT 1 FROM session_attachment_vector WHERE attachment_id = ? LIMIT 1',
      [attachmentId]
    )
    return Boolean(res.values && res.values.length > 0)
  }

  public async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return
    await this.database.initialize()
    const db = this.database.getDatabase()
    const statements: capSQLiteSet[] = records.map((record) => ({
      statement:
        'INSERT OR REPLACE INTO session_attachment_vector (chunk_id, attachment_id, vector) VALUES (?, ?, ?)',
      values: [record.chunkId, record.attachmentId, vectorToBase64(record.vector)],
    }))
    await db.executeSet(statements)
  }

  public async query(params: {
    attachmentIds: number[]
    queryVector: number[]
    topK: number
  }): Promise<VectorHit[]> {
    if (params.attachmentIds.length === 0 || params.queryVector.length === 0) return []
    await this.database.initialize()
    const placeholders = params.attachmentIds.map(() => '?').join(',')
    const db = this.database.getDatabase()
    const result = await db.query(
      `SELECT chunk_id, attachment_id, vector FROM session_attachment_vector WHERE attachment_id IN (${placeholders})`,
      params.attachmentIds
    )
    const rows = result.values ?? []
    if (rows.length === 0) return []

    const qF32 = new Float32Array(params.queryVector)
    const hits: VectorHit[] = []

    for (const row of rows) {
      const vF32 = base64ToVector(String(row.vector))
      const score = cosineSimilarity(qF32, vF32)
      hits.push({
        chunkId: Number(row.chunk_id),
        attachmentId: Number(row.attachment_id),
        score,
      })
    }

    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, params.topK)
  }

  public async deleteIndex(attachmentId: number): Promise<void> {
    await this.database.initialize()
    const db = this.database.getDatabase()
    await db.run('DELETE FROM session_attachment_vector WHERE attachment_id = ?', [attachmentId])
  }

  public async clearAll(): Promise<void> {
    await this.database.initialize()
    const db = this.database.getDatabase()
    await db.run('DELETE FROM session_attachment_vector')
  }
}
