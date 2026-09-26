import { CapacitorSQLite, type SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import type {
  SessionAttachment,
  SessionAttachmentParent,
  SessionAttachmentRagDebugSnapshot,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
} from '@shared/types'
import type { MobileChildChunk, MobileParentBlock } from './types'

const DB_NAME = 'chatbox-session-rag'

export class MobileRagDatabase {
  private db: SQLiteDBConnection | null = null
  private sqlite: SQLiteConnection | null = null
  private initPromise: Promise<void> | null = null

  constructor() {}

  async initialize(): Promise<void> {
    if (this.db) return
    if (!this.initPromise) {
      this.initPromise = this.initInternal()
    }
    return this.initPromise
  }

  getDatabase(): SQLiteDBConnection {
    if (!this.db) {
      throw new Error('MobileRagDatabase not initialized')
    }
    return this.db
  }

  // Allow injecting mock connection for tests
  setMockDatabase(mockDb: any) {
    this.db = mockDb
  }

  private async initInternal(): Promise<void> {
    try {
      this.sqlite = new (CapacitorSQLite as any)()
      const isConn = await this.sqlite!.isConnection(DB_NAME, false)
      if (isConn.result) {
        this.db = await this.sqlite!.retrieveConnection(DB_NAME, false)
      } else {
        this.db = await this.sqlite!.createConnection(DB_NAME, false, 'no-encryption', 1, false)
      }
      await this.db!.open()
      await this.db!.execute('PRAGMA foreign_keys = ON;')
      await this.createTables()
      await this.cleanupInterruptedIndexingAttachments()
    } catch (error) {
      console.error('[MobileRagDatabase] Failed to initialize SQLite:', error)
      throw error
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) return
    const schema = `
      CREATE TABLE IF NOT EXISTS session_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        token_estimate INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        total_chunks INTEGER DEFAULT 0,
        embedded_chunks INTEGER DEFAULT 0,
        embedding_model TEXT,
        embedding_dimension INTEGER,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sa_session ON session_attachments(session_id);
      CREATE INDEX IF NOT EXISTS idx_sa_message ON session_attachments(message_id);

      CREATE TABLE IF NOT EXISTS session_attachment_parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attachment_id INTEGER NOT NULL,
        parent_order INTEGER NOT NULL,
        section_path TEXT,
        text TEXT NOT NULL,
        token_estimate INTEGER,
        char_count INTEGER,
        FOREIGN KEY (attachment_id) REFERENCES session_attachments(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sap_att ON session_attachment_parents(attachment_id);

      CREATE TABLE IF NOT EXISTS session_attachment_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attachment_id INTEGER NOT NULL,
        parent_id INTEGER NOT NULL,
        chunk_order INTEGER NOT NULL,
        raw_text TEXT NOT NULL,
        token_estimate INTEGER,
        FOREIGN KEY (attachment_id) REFERENCES session_attachments(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES session_attachment_parents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sac_att ON session_attachment_chunks(attachment_id);

      CREATE TABLE IF NOT EXISTS session_attachment_vectors (
        chunk_id INTEGER PRIMARY KEY,
        attachment_id INTEGER NOT NULL,
        vector TEXT NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES session_attachment_chunks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sav_att ON session_attachment_vectors(attachment_id);
    `
    await this.db.execute(schema)
  }

  async cleanupInterruptedIndexingAttachments(): Promise<number> {
    if (!this.db) return 0
    try {
      const res = await this.db.query("SELECT id FROM session_attachments WHERE status = 'indexing';")
      const rows = res.values ?? []
      if (rows.length > 0) {
        await this.db.run(
          "UPDATE session_attachments SET status = 'failed', error = 'interrupted' WHERE status = 'indexing';"
        )
      }
      return rows.length
    } catch {
      return 0
    }
  }

  async createAttachment(params: {
    sessionId: string
    messageId: string
    attachmentStorageKey: string
    filename: string
    fileSize: number
    tokenEstimate: number
  }): Promise<SessionAttachment> {
    await this.initialize()
    const now = Date.now()
    const res = await this.db!.run(
      `INSERT INTO session_attachments (session_id, message_id, storage_key, filename, file_size, token_estimate, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?);`,
      [
        params.sessionId,
        params.messageId,
        params.attachmentStorageKey,
        params.filename,
        params.fileSize,
        params.tokenEstimate,
        now,
      ]
    )
    const id = res.changes?.lastId ?? 1
    return {
      id,
      sessionId: params.sessionId,
      messageId: params.messageId,
      filename: params.filename,
      status: 'pending',
      indexStatus: 'pending',
      availability: 'allowed',
      chunkCount: 0,
      createdAt: new Date(now).toISOString(),
    }
  }

  async getAttachments(ids: number[]): Promise<SessionAttachment[]> {
    if (ids.length === 0) return []
    await this.initialize()
    const placeholders = ids.map(() => '?').join(',')
    const res = await this.db!.query(
      `SELECT * FROM session_attachments WHERE id IN (${placeholders});`,
      ids
    )
    const rows: any[] = res.values ?? []
    return rows.map((r) => ({
      id: Number(r.id),
      sessionId: r.session_id,
      messageId: r.message_id,
      filename: r.filename,
      status: r.status === 'failed' ? 'error' : r.status,
      indexStatus: r.status === 'failed' ? 'error' : r.status,
      availability: 'allowed',
      chunkCount: Number(r.total_chunks || 0),
      createdAt: new Date(Number(r.created_at)).toISOString(),
      completedAt: r.completed_at ? new Date(Number(r.completed_at)).toISOString() : undefined,
      error: r.error || undefined,
    }))
  }

  async markIndexing(id: number): Promise<void> {
    await this.initialize()
    await this.db!.run("UPDATE session_attachments SET status = 'indexing', error = NULL WHERE id = ?;", [id])
  }

  async markReady(id: number, meta: { totalChunks: number; model?: string; dimension?: number }): Promise<void> {
    await this.initialize()
    const now = Date.now()
    await this.db!.run(
      `UPDATE session_attachments 
       SET status = 'ready', total_chunks = ?, embedded_chunks = ?, embedding_model = ?, embedding_dimension = ?, completed_at = ?, error = NULL
       WHERE id = ?;`,
      [meta.totalChunks, meta.totalChunks, meta.model ?? '', meta.dimension ?? 0, now, id]
    )
  }

  async markFailed(id: number, error: string): Promise<void> {
    await this.initialize()
    await this.db!.run("UPDATE session_attachments SET status = 'failed', error = ? WHERE id = ?;", [error, id])
  }

  async retryAttachment(id: number): Promise<void> {
    await this.initialize()
    await this.db!.run("UPDATE session_attachments SET status = 'pending', error = NULL WHERE id = ?;", [id])
  }

  async rebindAttachment(params: { attachmentId: number; sessionId: string; messageId: string }): Promise<void> {
    await this.initialize()
    await this.db!.run(
      'UPDATE session_attachments SET session_id = ?, message_id = ? WHERE id = ?;',
      [params.sessionId, params.messageId, params.attachmentId]
    )
  }

  async deleteAttachment(attachmentId: number): Promise<void> {
    await this.initialize()
    await this.db!.run('DELETE FROM session_attachments WHERE id = ?;', [attachmentId])
    await this.db!.run('DELETE FROM session_attachment_parents WHERE attachment_id = ?;', [attachmentId])
    await this.db!.run('DELETE FROM session_attachment_chunks WHERE attachment_id = ?;', [attachmentId])
    await this.db!.run('DELETE FROM session_attachment_vectors WHERE attachment_id = ?;', [attachmentId])
  }

  async deleteMessageAttachments(messageId: string): Promise<number[]> {
    await this.initialize()
    const res = await this.db!.query('SELECT id FROM session_attachments WHERE message_id = ?;', [messageId])
    const ids: number[] = (res.values ?? []).map((r: any) => Number(r.id))
    for (const id of ids) {
      await this.deleteAttachment(id)
    }
    return ids
  }

  async deleteSessionAttachments(sessionId: string): Promise<number[]> {
    await this.initialize()
    const res = await this.db!.query('SELECT id FROM session_attachments WHERE session_id = ?;', [sessionId])
    const ids: number[] = (res.values ?? []).map((r: any) => Number(r.id))
    for (const id of ids) {
      await this.deleteAttachment(id)
    }
    return ids
  }

  async cleanupOrphans(params: { sessionIds: string[]; messageIds: string[] }): Promise<number[]> {
    await this.initialize()
    const sessionPlaceholders = params.sessionIds.length > 0 ? params.sessionIds.map(() => '?').join(',') : "''"
    const messagePlaceholders = params.messageIds.length > 0 ? params.messageIds.map(() => '?').join(',') : "''"

    const res = await this.db!.query(
      `SELECT id FROM session_attachments WHERE session_id NOT IN (${sessionPlaceholders}) OR message_id NOT IN (${messagePlaceholders});`,
      [...params.sessionIds, ...params.messageIds]
    )
    const orphanIds: number[] = (res.values ?? []).map((r: any) => Number(r.id))
    for (const id of orphanIds) {
      await this.deleteAttachment(id)
    }
    return orphanIds
  }

  async clearAll(): Promise<number> {
    await this.initialize()
    const countRes = await this.db!.query('SELECT COUNT(*) as count FROM session_attachments;')
    const count = Number(countRes.values?.[0]?.count ?? 0)
    await this.db!.run('DELETE FROM session_attachments;')
    await this.db!.run('DELETE FROM session_attachment_parents;')
    await this.db!.run('DELETE FROM session_attachment_chunks;')
    await this.db!.run('DELETE FROM session_attachment_vectors;')
    return count
  }

  async runMaintenance(params: SessionAttachmentRagMaintenanceScope): Promise<SessionAttachmentRagMaintenanceResult> {
    await this.initialize()
    const interruptedFailedCount = await this.cleanupInterruptedIndexingAttachments()
    const orphanDeletedIds = await this.cleanupOrphans({
      sessionIds: params.sessionIds ?? [],
      messageIds: params.messageIds ?? [],
    })
    return {
      interruptedFailedCount,
      canceledPurgedCount: 0,
      orphanDeletedIds,
    }
  }

  async getDebugSnapshot(): Promise<SessionAttachmentRagDebugSnapshot> {
    await this.initialize()
    const attCount = await this.db!.query('SELECT COUNT(*) as count FROM session_attachments;')
    const chunkCount = await this.db!.query('SELECT COUNT(*) as count FROM session_attachment_chunks;')
    const vectorCount = await this.db!.query('SELECT COUNT(*) as count FROM session_attachment_vectors;')
    return {
      dbPath: DB_NAME,
      vectorDbPath: DB_NAME,
      attachmentCount: Number(attCount.values?.[0]?.count ?? 0),
      indexCount: Number(vectorCount.values?.[0]?.count ?? 0),
      databaseSizeBytes: 0,
      vectorDatabaseSizeBytes: 0,
      chunkCount: Number(chunkCount.values?.[0]?.count ?? 0),
    }
  }

  async insertParentsAndChunks(
    attachmentId: number,
    parents: MobileParentBlock[],
    children: MobileChildChunk[]
  ): Promise<{ parentMap: Map<number, number>; createdChunks: { id: number; chunkOrder: number; text: string }[] }> {
    await this.initialize()
    const parentMap = new Map<number, number>()

    for (const p of parents) {
      const res = await this.db!.run(
        `INSERT INTO session_attachment_parents (attachment_id, parent_order, section_path, text, token_estimate, char_count)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [attachmentId, p.parentOrder, p.sectionPath ?? '', p.text, p.tokenEstimate, p.charCount]
      )
      const insertedParentId = Number(res.changes?.lastId ?? 1)
      parentMap.set(p.parentOrder, insertedParentId)
    }

    const createdChunks: { id: number; chunkOrder: number; text: string }[] = []

    for (const c of children) {
      const parentId = parentMap.get(c.parentOrder) ?? 0
      const res = await this.db!.run(
        `INSERT INTO session_attachment_chunks (attachment_id, parent_id, chunk_order, raw_text, token_estimate)
         VALUES (?, ?, ?, ?, ?);`,
        [attachmentId, parentId, c.chunkOrder, c.rawText, c.tokenEstimate]
      )
      const chunkId = Number(res.changes?.lastId ?? 1)
      createdChunks.push({ id: chunkId, chunkOrder: c.chunkOrder, text: c.rawText })
    }

    return { parentMap, createdChunks }
  }

  async getChunksByIds(
    chunkIds: number[]
  ): Promise<{ id: number; attachmentId: number; parentId: number; chunkOrder: number; rawText: string }[]> {
    if (chunkIds.length === 0) return []
    await this.initialize()
    const placeholders = chunkIds.map(() => '?').join(',')
    const res = await this.db!.query(
      `SELECT id, attachment_id, parent_id, chunk_order, raw_text FROM session_attachment_chunks WHERE id IN (${placeholders});`,
      chunkIds
    )
    return (res.values ?? []).map((r: any) => ({
      id: Number(r.id),
      attachmentId: Number(r.attachment_id),
      parentId: Number(r.parent_id),
      chunkOrder: Number(r.chunk_order),
      rawText: r.raw_text,
    }))
  }

  async readParents(parentIds: number[], allowedAttachmentIds: number[]): Promise<SessionAttachmentParent[]> {
    if (parentIds.length === 0 || allowedAttachmentIds.length === 0) return []
    await this.initialize()
    const pPlaceholders = parentIds.map(() => '?').join(',')
    const aPlaceholders = allowedAttachmentIds.map(() => '?').join(',')

    const res = await this.db!.query(
      `SELECT p.id, p.attachment_id, p.parent_order, p.section_path, p.text, p.token_estimate, p.char_count, a.filename
       FROM session_attachment_parents p
       JOIN session_attachments a ON p.attachment_id = a.id
       WHERE p.id IN (${pPlaceholders}) AND p.attachment_id IN (${aPlaceholders});`,
      [...parentIds, ...allowedAttachmentIds]
    )

    return (res.values ?? []).map((r: any) => ({
      id: Number(r.id),
      attachmentId: Number(r.attachment_id),
      filename: r.filename,
      sectionPath: r.section_path || undefined,
      text: r.text,
      tokenEstimate: Number(r.token_estimate ?? 0),
      charCount: Number(r.char_count ?? 0),
    }))
  }
}
