import {
  CapacitorSQLite,
  SQLiteConnection,
  type capSQLiteSet,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import { planOrphanCleanup } from '@shared/session-attachment-rag/ownership'
import type {
  CreateSessionAttachmentParams,
  SessionAttachmentChunkRecord,
  SessionAttachmentParent,
  SessionAttachmentParentRecord,
  SessionAttachmentRecord,
  SessionAttachmentStatus,
  SessionAttachmentIndexingStage,
  SessionAttachmentRagDebugSnapshot,
} from './types'

const DB_NAME = 'chatbox-session-rag'

function mapRowToAttachmentRecord(row: Record<string, unknown>): SessionAttachmentRecord {
  return {
    id: Number(row.id),
    sessionId: String(row.session_id),
    messageId: String(row.message_id),
    attachmentStorageKey: String(row.attachment_storage_key),
    filename: String(row.filename),
    mimeType: String(row.mime_type ?? ''),
    fileSize: Number(row.file_size ?? 0),
    tokenEstimate: Number(row.token_estimate ?? 0),
    parserType: row.parser_type ? String(row.parser_type) : undefined,
    status: String(row.status) as SessionAttachmentStatus,
    indexingStage: row.indexing_stage ? (String(row.indexing_stage) as SessionAttachmentIndexingStage) : undefined,
    totalChunks: Number(row.total_chunks ?? 0),
    embeddedChunks: Number(row.embedded_chunks ?? 0),
    chunkCount: Number(row.total_chunks ?? 0),
    embeddingModel: row.embedding_model ? String(row.embedding_model) : undefined,
    embeddingDimension:
      row.embedding_dimension !== null && row.embedding_dimension !== undefined
        ? Number(row.embedding_dimension)
        : undefined,
    error: row.error ? String(row.error) : undefined,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    processingStartedAt: row.processing_started_at ? String(row.processing_started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  }
}

function mapRowToParentRecord(row: Record<string, unknown>): SessionAttachmentParentRecord {
  return {
    id: Number(row.id),
    attachmentId: Number(row.attachment_id),
    parentOrder: Number(row.parent_order),
    sectionPath: row.section_path ? String(row.section_path) : undefined,
    docType: row.doc_type ? String(row.doc_type) : undefined,
    pageStart: row.page_start !== null && row.page_start !== undefined ? Number(row.page_start) : undefined,
    pageEnd: row.page_end !== null && row.page_end !== undefined ? Number(row.page_end) : undefined,
    text: String(row.text),
    tokenEstimate: Number(row.token_estimate ?? 0),
    charCount: Number(row.char_count ?? 0),
    createdAt: row.created_at ? String(row.created_at) : undefined,
  }
}

function mapRowToChunkRecord(row: Record<string, unknown>): SessionAttachmentChunkRecord {
  return {
    id: Number(row.id),
    attachmentId: Number(row.attachment_id),
    parentId: Number(row.parent_id),
    chunkOrder: Number(row.chunk_order),
    sectionPath: row.section_path ? String(row.section_path) : undefined,
    pageStart: row.page_start !== null && row.page_start !== undefined ? Number(row.page_start) : undefined,
    pageEnd: row.page_end !== null && row.page_end !== undefined ? Number(row.page_end) : undefined,
    rawText: String(row.raw_text),
    embeddedText: String(row.embedded_text),
    tokenEstimate: Number(row.token_estimate ?? 0),
    createdAt: row.created_at ? String(row.created_at) : undefined,
  }
}

export class MobileRagDatabase {
  private sqlite: SQLiteConnection
  private database!: SQLiteDBConnection
  private initPromise: Promise<void> | null = null

  constructor(sqliteConnection?: SQLiteConnection) {
    this.sqlite = sqliteConnection ?? new SQLiteConnection(CapacitorSQLite)
  }

  public initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.openDatabase()
    return this.initPromise
  }

  public getDatabase(): SQLiteDBConnection {
    return this.database
  }

  private async openDatabase(): Promise<void> {
    try {
      this.sqlite.closeConnection(DB_NAME, false)
    } catch {
      // ignore
    }

    this.database = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
    await this.database.open()

    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS session_attachment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        attachment_storage_key TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        token_estimate INTEGER DEFAULT 0,
        parser_type TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        indexing_stage TEXT DEFAULT NULL,
        total_chunks INTEGER DEFAULT 0,
        embedded_chunks INTEGER DEFAULT 0,
        embedding_model TEXT DEFAULT NULL,
        embedding_dimension INTEGER DEFAULT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        processing_started_at INTEGER,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS session_attachment_parent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attachment_id INTEGER NOT NULL,
        parent_order INTEGER NOT NULL,
        section_path TEXT,
        doc_type TEXT,
        page_start INTEGER,
        page_end INTEGER,
        text TEXT NOT NULL,
        token_estimate INTEGER DEFAULT 0,
        char_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_attachment_chunk (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attachment_id INTEGER NOT NULL,
        parent_id INTEGER NOT NULL,
        chunk_order INTEGER NOT NULL,
        section_path TEXT,
        page_start INTEGER,
        page_end INTEGER,
        raw_text TEXT NOT NULL,
        embedded_text TEXT NOT NULL,
        token_estimate INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_attachment_vector (
        chunk_id INTEGER PRIMARY KEY,
        attachment_id INTEGER NOT NULL,
        vector TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sa_session_id ON session_attachment(session_id);
      CREATE INDEX IF NOT EXISTS idx_sa_message_id ON session_attachment(message_id);
      CREATE INDEX IF NOT EXISTS idx_sa_status ON session_attachment(status);
      CREATE INDEX IF NOT EXISTS idx_sap_attachment_id ON session_attachment_parent(attachment_id);
      CREATE INDEX IF NOT EXISTS idx_sac_attachment_id ON session_attachment_chunk(attachment_id);
      CREATE INDEX IF NOT EXISTS idx_sac_parent_id ON session_attachment_chunk(parent_id);
      CREATE INDEX IF NOT EXISTS idx_sav_attachment_id ON session_attachment_vector(attachment_id);
    `)
  }

  public async createAttachment(params: CreateSessionAttachmentParams): Promise<number> {
    await this.initialize()
    const now = Date.now()
    const result = await this.database.run(
      `INSERT INTO session_attachment (
        session_id, message_id, attachment_storage_key, filename, mime_type,
        file_size, token_estimate, parser_type, status, indexing_stage, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'queued', ?)`,
      [
        params.sessionId,
        params.messageId,
        params.attachmentStorageKey,
        params.filename,
        params.mimeType,
        params.fileSize,
        params.tokenEstimate,
        params.parserType ?? null,
        now,
      ]
    )

    const lastId = result.changes?.lastId
    if (lastId === undefined || lastId === null) {
      const queryResult = await this.database.query('SELECT last_insert_rowid() as id')
      return Number(queryResult.values?.[0]?.id)
    }
    return Number(lastId)
  }

  public async getAttachment(id: number): Promise<SessionAttachmentRecord | null> {
    await this.initialize()
    const result = await this.database.query('SELECT * FROM session_attachment WHERE id = ?', [id])
    const row = result.values?.[0]
    return row ? mapRowToAttachmentRecord(row) : null
  }

  public async getAttachments(ids: number[]): Promise<SessionAttachmentRecord[]> {
    if (ids.length === 0) return []
    await this.initialize()
    const placeholders = ids.map(() => '?').join(',')
    const result = await this.database.query(
      `SELECT * FROM session_attachment WHERE id IN (${placeholders})`,
      ids
    )
    return (result.values ?? []).map(mapRowToAttachmentRecord)
  }

  public async listPendingAttachments(limit = 5): Promise<SessionAttachmentRecord[]> {
    await this.initialize()
    const result = await this.database.query(
      'SELECT * FROM session_attachment WHERE status = ? ORDER BY id ASC LIMIT ?',
      ['pending', limit]
    )
    return (result.values ?? []).map(mapRowToAttachmentRecord)
  }

  public async updateAttachment(id: number, updates: Partial<SessionAttachmentRecord>): Promise<void> {
    await this.initialize()
    const setClauses: string[] = []
    const values: unknown[] = []

    if (updates.status !== undefined) {
      setClauses.push('status = ?')
      values.push(updates.status)
    }
    if (updates.indexingStage !== undefined) {
      setClauses.push('indexing_stage = ?')
      values.push(updates.indexingStage)
    }
    if (updates.totalChunks !== undefined) {
      setClauses.push('total_chunks = ?')
      values.push(updates.totalChunks)
    }
    if (updates.embeddedChunks !== undefined) {
      setClauses.push('embedded_chunks = ?')
      values.push(updates.embeddedChunks)
    }
    if (updates.embeddingModel !== undefined) {
      setClauses.push('embedding_model = ?')
      values.push(updates.embeddingModel)
    }
    if (updates.embeddingDimension !== undefined) {
      setClauses.push('embedding_dimension = ?')
      values.push(updates.embeddingDimension)
    }
    if (updates.error !== undefined) {
      setClauses.push('error = ?')
      values.push(updates.error)
    }
    if (updates.processingStartedAt !== undefined) {
      setClauses.push('processing_started_at = ?')
      values.push(updates.processingStartedAt)
    }
    if (updates.completedAt !== undefined) {
      setClauses.push('completed_at = ?')
      values.push(updates.completedAt)
    }

    if (setClauses.length === 0) return
    values.push(id)
    await this.database.run(
      `UPDATE session_attachment SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    )
  }

  public async updateAttachmentProgress(
    id: number,
    progress: {
      indexingStage?: SessionAttachmentIndexingStage
      totalChunks?: number
      embeddedChunks?: number
      embeddingModel?: string
      embeddingDimension?: number
    }
  ): Promise<void> {
    await this.updateAttachment(id, progress)
  }

  public async markAttachmentStatus(
    id: number,
    status: SessionAttachmentStatus,
    error?: string
  ): Promise<void> {
    const now = Date.now()
    if (status === 'indexing') {
      await this.updateAttachment(id, {
        status,
        indexingStage: 'chunking',
        processingStartedAt: String(now),
        error: undefined,
      })
    } else if (status === 'ready') {
      await this.updateAttachment(id, {
        status,
        indexingStage: 'ready',
        completedAt: String(now),
        error: undefined,
      })
    } else if (status === 'failed') {
      await this.updateAttachment(id, {
        status,
        error: error || 'Indexing failed',
      })
    } else {
      await this.updateAttachment(id, { status, error })
    }
  }

  public async rebindAttachment(attachmentId: number, sessionId: string, messageId: string): Promise<void> {
    await this.initialize()
    await this.database.run(
      'UPDATE session_attachment SET session_id = ?, message_id = ? WHERE id = ?',
      [sessionId, messageId, attachmentId]
    )
  }

  public async deleteAttachment(attachmentId: number): Promise<void> {
    await this.initialize()
    const set: capSQLiteSet[] = [
      { statement: 'DELETE FROM session_attachment_vector WHERE attachment_id = ?', values: [attachmentId] },
      { statement: 'DELETE FROM session_attachment_chunk WHERE attachment_id = ?', values: [attachmentId] },
      { statement: 'DELETE FROM session_attachment_parent WHERE attachment_id = ?', values: [attachmentId] },
      { statement: 'DELETE FROM session_attachment WHERE id = ?', values: [attachmentId] },
    ]
    await this.database.executeSet(set)
  }

  public async deleteMessageAttachments(messageId: string): Promise<number[]> {
    await this.initialize()
    const rows = await this.database.query('SELECT id FROM session_attachment WHERE message_id = ?', [messageId])
    const ids = (rows.values ?? []).map((r) => Number(r.id))
    for (const id of ids) {
      await this.deleteAttachment(id)
    }
    return ids
  }

  public async deleteSessionAttachments(sessionId: string): Promise<number[]> {
    await this.initialize()
    const rows = await this.database.query('SELECT id FROM session_attachment WHERE session_id = ?', [sessionId])
    const ids = (rows.values ?? []).map((r) => Number(r.id))
    for (const id of ids) {
      await this.deleteAttachment(id)
    }
    return ids
  }

  public async replaceParentsAndChunks(
    attachmentId: number,
    parents: Array<{
      parentOrder: number
      sectionPath?: string
      docType?: string
      pageStart?: number
      pageEnd?: number
      text: string
      tokenEstimate: number
      charCount: number
    }>,
    children: Array<{
      parentOrder: number
      chunkOrder: number
      sectionPath?: string
      pageStart?: number
      pageEnd?: number
      rawText: string
      embeddedText: string
      tokenEstimate: number
    }>
  ): Promise<number[]> {
    await this.initialize()
    const now = Date.now()

    // Clean previous parent/chunk/vector records for this attachment
    await this.database.executeSet([
      { statement: 'DELETE FROM session_attachment_vector WHERE attachment_id = ?', values: [attachmentId] },
      { statement: 'DELETE FROM session_attachment_chunk WHERE attachment_id = ?', values: [attachmentId] },
      { statement: 'DELETE FROM session_attachment_parent WHERE attachment_id = ?', values: [attachmentId] },
    ])

    // Insert parents individually to get their generated IDs
    const parentIdByOrder = new Map<number, number>()
    for (const p of parents) {
      const res = await this.database.run(
        `INSERT INTO session_attachment_parent (
          attachment_id, parent_order, section_path, doc_type,
          page_start, page_end, text, token_estimate, char_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attachmentId,
          p.parentOrder,
          p.sectionPath ?? null,
          p.docType ?? null,
          p.pageStart ?? null,
          p.pageEnd ?? null,
          p.text,
          p.tokenEstimate,
          p.charCount,
          now,
        ]
      )
      const parentId = res.changes?.lastId ?? (await this.database.query('SELECT last_insert_rowid() as id')).values?.[0]?.id
      parentIdByOrder.set(p.parentOrder, Number(parentId))
    }

    // Insert children chunks
    const chunkIds: number[] = []
    for (const c of children) {
      const parentId = parentIdByOrder.get(c.parentOrder) ?? 0
      const res = await this.database.run(
        `INSERT INTO session_attachment_chunk (
          attachment_id, parent_id, chunk_order, section_path,
          page_start, page_end, raw_text, embedded_text, token_estimate, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attachmentId,
          parentId,
          c.chunkOrder,
          c.sectionPath ?? null,
          c.pageStart ?? null,
          c.pageEnd ?? null,
          c.rawText,
          c.embeddedText,
          c.tokenEstimate,
          now,
        ]
      )
      const chunkId = res.changes?.lastId ?? (await this.database.query('SELECT last_insert_rowid() as id')).values?.[0]?.id
      chunkIds.push(Number(chunkId))
    }

    return chunkIds
  }

  public async listChunks(attachmentId: number): Promise<SessionAttachmentChunkRecord[]> {
    await this.initialize()
    const result = await this.database.query(
      'SELECT * FROM session_attachment_chunk WHERE attachment_id = ? ORDER BY chunk_order ASC',
      [attachmentId]
    )
    return (result.values ?? []).map(mapRowToChunkRecord)
  }

  public async listChunksWithDetails(
    chunkIds: number[]
  ): Promise<Array<SessionAttachmentChunkRecord & { filename: string }>> {
    if (chunkIds.length === 0) return []
    await this.initialize()
    const placeholders = chunkIds.map(() => '?').join(',')
    const result = await this.database.query(
      `SELECT c.*, a.filename
       FROM session_attachment_chunk c
       JOIN session_attachment a ON c.attachment_id = a.id
       WHERE c.id IN (${placeholders})`,
      chunkIds
    )
    return (result.values ?? []).map((row) => ({
      ...mapRowToChunkRecord(row),
      filename: String(row.filename),
    }))
  }

  public async readParents(
    parentIds: number[],
    allowedAttachmentIds: number[]
  ): Promise<SessionAttachmentParent[]> {
    if (parentIds.length === 0 || allowedAttachmentIds.length === 0) return []
    await this.initialize()
    const parentPlaceholders = parentIds.map(() => '?').join(',')
    const attachmentPlaceholders = allowedAttachmentIds.map(() => '?').join(',')
    const result = await this.database.query(
      `SELECT p.*, a.filename
       FROM session_attachment_parent p
       JOIN session_attachment a ON p.attachment_id = a.id
       WHERE p.id IN (${parentPlaceholders}) AND p.attachment_id IN (${attachmentPlaceholders})`,
      [...parentIds, ...allowedAttachmentIds]
    )
    return (result.values ?? []).map((row) => ({
      ...mapRowToParentRecord(row),
      filename: String(row.filename),
    }))
  }

  public async clearAll(): Promise<number> {
    await this.initialize()
    const countRes = await this.database.query('SELECT count(*) as cnt FROM session_attachment')
    const count = Number(countRes.values?.[0]?.cnt ?? 0)
    await this.database.executeSet([
      { statement: 'DELETE FROM session_attachment_vector', values: [] },
      { statement: 'DELETE FROM session_attachment_chunk', values: [] },
      { statement: 'DELETE FROM session_attachment_parent', values: [] },
      { statement: 'DELETE FROM session_attachment', values: [] },
    ])
    return count
  }

  public async cleanupOrphans(
    sessionIds: string[],
    messageIds: string[],
    attachmentReferences: Array<{ attachmentId: number; sessionId: string; messageId: string }> = []
  ): Promise<number[]> {
    await this.initialize()
    const allAttachmentsResult = await this.database.query(
      'SELECT id, session_id, message_id FROM session_attachment'
    )
    const records = (allAttachmentsResult.values ?? []).map((r) => ({
      id: Number(r.id),
      sessionId: String(r.session_id),
      messageId: String(r.message_id),
    }))

    const cleanupPlan = planOrphanCleanup(records, {
      sessionIds,
      messageIds,
      attachmentReferences,
    })

    for (const repair of cleanupPlan.repairs) {
      await this.rebindAttachment(repair.attachmentId, repair.sessionId, repair.messageId)
    }

    for (const id of cleanupPlan.deleteIds) {
      await this.deleteAttachment(id)
    }

    return cleanupPlan.deleteIds
  }

  public async getDebugSnapshot(): Promise<SessionAttachmentRagDebugSnapshot> {
    await this.initialize()
    const [attachmentCountRes, parentCountRes, chunkCountRes, statusCountsRes, recentAttachmentsRes] =
      await Promise.all([
        this.database.query('SELECT count(*) as cnt FROM session_attachment'),
        this.database.query('SELECT count(*) as cnt FROM session_attachment_parent'),
        this.database.query('SELECT count(*) as cnt FROM session_attachment_chunk'),
        this.database.query(
          `SELECT
            sum(case when status = 'pending' then 1 else 0 end) as pending,
            sum(case when status = 'indexing' then 1 else 0 end) as indexing,
            sum(case when status = 'ready' then 1 else 0 end) as ready,
            sum(case when status = 'failed' then 1 else 0 end) as failed
           FROM session_attachment`
        ),
        this.database.query(
          'SELECT * FROM session_attachment ORDER BY id DESC LIMIT 10'
        ),
      ])

    const statusRow = statusCountsRes.values?.[0] ?? {}
    const recent = (recentAttachmentsRes.values ?? [])
      .map(mapRowToAttachmentRecord)
      .map((a) => ({
        ...a,
        chunkCount: a.chunkCount ?? 0,
        createdAt: a.createdAt ? Number(a.createdAt) : undefined,
        processingStartedAt: a.processingStartedAt ? Number(a.processingStartedAt) : undefined,
        completedAt: a.completedAt ? Number(a.completedAt) : undefined,
        status: (a.status === 'canceled' ? 'failed' : a.status) as 'pending' | 'indexing' | 'ready' | 'failed',
      }))

    return {
      dbPath: DB_NAME,
      dbSizeBytes: 0,
      vectorDbPath: DB_NAME,
      vectorDbSizeBytes: 0,
      attachmentCount: Number(attachmentCountRes.values?.[0]?.cnt ?? 0),
      parentCount: Number(parentCountRes.values?.[0]?.cnt ?? 0),
      chunkCount: Number(chunkCountRes.values?.[0]?.cnt ?? 0),
      vectorIndexNames: [],
      statusCounts: {
        pending: Number(statusRow.pending ?? 0),
        indexing: Number(statusRow.indexing ?? 0),
        ready: Number(statusRow.ready ?? 0),
        failed: Number(statusRow.failed ?? 0),
      },
      recentAttachments: recent,
    }
  }
}
