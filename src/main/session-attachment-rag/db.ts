import fs from 'node:fs'
import path from 'node:path'
import { type Client, createClient } from '@libsql/client'
import { LibSQLVector } from '@mastra/libsql'
import { app } from 'electron'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import { planOrphanCleanup } from '../../shared/session-attachment-rag/ownership'
import type { SessionAttachmentOwnershipClaim } from '../../shared/types'
import { sentry } from '../adapters/sentry'
import { getLogger } from '../util'

const log = getLogger('session-attachment-rag:db')

// Do not use `${userData}/databases`: Chromium/Electron profile storage may
// unlink files in that directory. Keep app-owned sqlite files in our own folder.
const userDataPath = app.getPath('userData')
const appDatabaseDir = path.join(userDataPath, 'chatbox-databases')
const defaultDbPath = path.join(appDatabaseDir, 'chatbox_session_rag.db')
const defaultVectorDbPath = path.join(appDatabaseDir, 'chatbox_session_rag_vectors.db')
const dbPath = process.env.SESSION_ATTACHMENT_RAG_DB_PATH || defaultDbPath
const vectorDbPath = process.env.SESSION_ATTACHMENT_RAG_VECTOR_DB_PATH || defaultVectorDbPath

function ensureDbDir(filePath: string) {
  const dbDir = path.dirname(filePath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
}

ensureDbDir(dbPath)
ensureDbDir(vectorDbPath)

if (typeof global.crypto === 'undefined' || !('subtle' in global.crypto)) {
  global.crypto = require('node:crypto')
}

let db: Client
let vectorStore: LibSQLVector
let vectorWriteQueue: Promise<void> = Promise.resolve()

export type SessionAttachmentStatus = 'pending' | 'indexing' | 'ready' | 'failed' | 'canceled'
export type SessionAttachmentIndexingStage = 'queued' | 'chunking' | 'embedding' | 'finalizing' | 'ready'

export interface SessionAttachmentRecord {
  id: number
  sessionId: string
  messageId: string
  attachmentStorageKey: string
  filename: string
  mimeType: string
  fileSize: number
  tokenEstimate: number
  chunkCount?: number
  totalChunks?: number
  embeddedChunks?: number
  embeddingModel?: string
  embeddingDimension?: number
  indexingStage?: SessionAttachmentIndexingStage
  parserType?: string
  status: SessionAttachmentStatus
  error?: string
  createdAt?: string
  processingStartedAt?: string
  completedAt?: string
}

export interface SessionAttachmentChunkRecord {
  id: number
  attachmentId: number
  parentId: number
  chunkOrder: number
  sectionPath?: string
  rawText: string
  embeddedText: string
  tokenEstimate: number
}

export interface SessionAttachmentDebugSnapshot {
  dbPath: string
  dbSizeBytes: number
  vectorDbPath: string
  vectorDbSizeBytes: number
  attachmentCount: number
  parentCount: number
  chunkCount: number
  vectorIndexNames: string[]
  statusCounts: {
    pending: number
    indexing: number
    ready: number
    failed: number
  }
  recentAttachments: Array<
    Omit<SessionAttachmentRecord, 'status'> & { status: 'pending' | 'indexing' | 'ready' | 'failed' }
  >
}

export interface CreateSessionAttachmentParams {
  sessionId: string
  messageId: string
  attachmentStorageKey: string
  filename: string
  mimeType: string
  fileSize: number
  tokenEstimate: number
  parserType?: string
}

function mapRowToSessionAttachmentRecord(row: Record<string, unknown>): SessionAttachmentRecord {
  return {
    id: Number(row.id),
    sessionId: String(row.session_id),
    messageId: String(row.message_id),
    attachmentStorageKey: String(row.attachment_storage_key),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    fileSize: Number(row.file_size ?? 0),
    tokenEstimate: Number(row.token_estimate ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    totalChunks: Number(row.total_chunks ?? 0),
    embeddedChunks: Number(row.embedded_chunks ?? 0),
    embeddingModel: row.embedding_model ? String(row.embedding_model) : undefined,
    embeddingDimension:
      row.embedding_dimension === null || row.embedding_dimension === undefined
        ? undefined
        : Number(row.embedding_dimension),
    indexingStage: row.indexing_stage ? (String(row.indexing_stage) as SessionAttachmentIndexingStage) : undefined,
    parserType: row.parser_type ? String(row.parser_type) : undefined,
    status: String(row.status) as SessionAttachmentStatus,
    error: row.error ? String(row.error) : undefined,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    processingStartedAt: row.processing_started_at ? String(row.processing_started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  }
}

/**
 * Schema version of the session attachment RAG database. Bump this when introducing
 * non-backward-compatible schema changes and add a corresponding migration step in
 * `runSchemaMigrations`.
 */
const SCHEMA_VERSION = 3

async function getSchemaVersion(client: Client): Promise<number> {
  const rs = await client.execute('PRAGMA user_version')
  return Number(rs.rows[0]?.user_version ?? 0)
}

async function setSchemaVersion(client: Client, version: number) {
  // PRAGMA does not accept parameter binding for the value; the version is a controlled
  // integer constant defined in this file, so direct interpolation is safe.
  await client.execute(`PRAGMA user_version = ${version}`)
}

async function runSchemaMigrations(client: Client) {
  const currentVersion = await getSchemaVersion(client)
  if (currentVersion >= SCHEMA_VERSION) {
    return
  }
  log.info(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Migrating schema: current=${currentVersion}, target=${SCHEMA_VERSION}`
  )
  if (currentVersion < 2) {
    const migrations = [
      'ALTER TABLE session_attachment ADD COLUMN indexing_stage TEXT DEFAULT NULL',
      'ALTER TABLE session_attachment ADD COLUMN total_chunks INTEGER DEFAULT 0',
      'ALTER TABLE session_attachment ADD COLUMN embedded_chunks INTEGER DEFAULT 0',
    ]
    for (const sql of migrations) {
      await client.execute(sql).catch((error) => {
        if (error instanceof Error && error.message.includes('duplicate column name')) {
          return
        }
        throw error
      })
    }
  }
  if (currentVersion < 3) {
    const migrations = [
      'ALTER TABLE session_attachment ADD COLUMN embedding_model TEXT DEFAULT NULL',
      'ALTER TABLE session_attachment ADD COLUMN embedding_dimension INTEGER DEFAULT NULL',
    ]
    for (const sql of migrations) {
      await client.execute(sql).catch((error) => {
        if (error instanceof Error && error.message.includes('duplicate column name')) {
          return
        }
        throw error
      })
    }
  }
  await setSchemaVersion(client, SCHEMA_VERSION)
}

async function initDB(client: Client) {
  try {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS session_attachment (
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processing_started_at DATETIME,
        completed_at DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS session_attachment_parent (
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (attachment_id) REFERENCES session_attachment(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS session_attachment_chunk (
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (attachment_id) REFERENCES session_attachment(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES session_attachment_parent(id) ON DELETE CASCADE
      )`,
      'CREATE INDEX IF NOT EXISTS idx_session_attachment_session_id ON session_attachment(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_session_attachment_message_id ON session_attachment(message_id)',
      'CREATE INDEX IF NOT EXISTS idx_session_attachment_status ON session_attachment(status)',
      'CREATE INDEX IF NOT EXISTS idx_session_attachment_parent_attachment_id ON session_attachment_parent(attachment_id)',
      'CREATE INDEX IF NOT EXISTS idx_session_attachment_chunk_attachment_id ON session_attachment_chunk(attachment_id)',
      'CREATE INDEX IF NOT EXISTS idx_session_attachment_chunk_parent_id ON session_attachment_chunk(parent_id)',
    ])
    await runSchemaMigrations(client)
    log.info(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Session attachment rag database initialized`)
  } catch (error) {
    log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to initialize session attachment rag database:`, error)
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-db')
      scope.setTag('operation', 'database_initialization')
      scope.setExtra('dbPath', dbPath)
      sentry.captureException(error)
    })
    throw error
  }
}

function getFileSizeBytes(filePath: string): number {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

async function createVectorStoreWithHealthCheck(): Promise<LibSQLVector> {
  const store = new LibSQLVector({
    connectionUrl: `file:${vectorDbPath}`,
  })
  await store.listIndexes()
  return store
}

async function initializeVectorStore(): Promise<LibSQLVector> {
  return await createVectorStoreWithHealthCheck()
}

export async function initializeDatabase() {
  try {
    ensureDbDir(dbPath)
    ensureDbDir(vectorDbPath)
    // Keep metadata operations on a dedicated client. The vector store owns
    // its separate database file and client.
    db = createClient({ url: `file:${dbPath}` })
    await db.execute('PRAGMA journal_mode=WAL')
    await db.execute('PRAGMA busy_timeout = 5000')
    await db.execute('PRAGMA foreign_keys = ON')
    await initDB(db)
    await cleanupInterruptedIndexingAttachments()
    vectorStore = await initializeVectorStore()
    await cleanupReadyAttachmentsMissingVectorIndexes()
  } catch (error) {
    log.error(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to initialize session attachment rag database system:`,
      error
    )
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-db')
      scope.setTag('operation', 'vector_store_initialization')
      scope.setExtra('dbPath', dbPath)
      scope.setExtra('vectorDbPath', vectorDbPath)
      sentry.captureException(error)
    })
    throw error
  }
}

export function getDatabase(): Client {
  if (!db) {
    const error = new Error('Session attachment rag database not initialized')
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-db')
      scope.setTag('operation', 'database_access')
      sentry.captureException(error)
    })
    throw error
  }
  return db
}

export function getVectorStore(): LibSQLVector {
  if (!vectorStore) {
    const error = new Error('Session attachment rag vector store not initialized')
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-db')
      scope.setTag('operation', 'vector_store_access')
      sentry.captureException(error)
    })
    throw error
  }
  return vectorStore
}

export async function runVectorWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = vectorWriteQueue.then(operation, operation)
  vectorWriteQueue = run.then(
    () => undefined,
    () => undefined
  )
  return await run
}

export function getSessionAttachmentRagDbPath(): string {
  return dbPath
}

export function getSessionAttachmentRagVectorDbPath(): string {
  return vectorDbPath
}

export function parseSQLiteTimestamp(sqliteTimestamp: string): number {
  try {
    const utcDate = new Date(`${sqliteTimestamp} UTC`)
    const timestamp = utcDate.getTime()
    if (Number.isNaN(timestamp)) {
      throw new Error(`Invalid timestamp format: ${sqliteTimestamp}`)
    }
    return timestamp
  } catch (error) {
    log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to parse SQLite timestamp: ${sqliteTimestamp}`, error)
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-db')
      scope.setTag('operation', 'timestamp_parsing')
      scope.setExtra('sqliteTimestamp', sqliteTimestamp)
      sentry.captureException(error)
    })
    return Date.now()
  }
}

export async function withTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const client = getDatabase()
  const transactionId = Math.random().toString(36).slice(2, 10)

  try {
    await client.execute('BEGIN TRANSACTION')
    const result = await operation()
    await client.execute('COMMIT')
    log.debug(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Transaction ${transactionId} committed`)
    return result
  } catch (error) {
    log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Transaction ${transactionId} failed:`, error)
    try {
      await client.execute('ROLLBACK')
    } catch (rollbackError) {
      log.error(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to rollback transaction ${transactionId}:`,
        rollbackError
      )
      sentry.withScope((scope) => {
        scope.setTag('component', 'session-attachment-rag-db')
        scope.setTag('operation', 'transaction_rollback')
        scope.setExtra('transactionId', transactionId)
        sentry.captureException(rollbackError)
      })
    }
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-db')
      scope.setTag('operation', 'transaction_failure')
      scope.setExtra('transactionId', transactionId)
      sentry.captureException(error)
    })
    throw error
  }
}

export async function cleanupInterruptedIndexingAttachments() {
  try {
    const result = await db.execute({
      sql: 'UPDATE session_attachment SET status = ?, processing_started_at = NULL, completed_at = NULL WHERE status = ?',
      args: ['failed', 'indexing'],
    })
    const affectedRows = result.rowsAffected || 0
    if (affectedRows > 0) {
      log.info(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Marked ${affectedRows} interrupted indexing attachments as failed`
      )
    }
    return Number(affectedRows)
  } catch (error) {
    log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to cleanup interrupted indexing attachments:`, error)
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-db')
      scope.setTag('operation', 'cleanup_indexing_attachments')
      sentry.captureException(error)
    })
    return 0
  }
}

export async function cleanupReadyAttachmentsMissingVectorIndexes() {
  try {
    const indexNames = new Set(await getVectorStore().listIndexes())
    const rs = await db.execute({
      sql: 'SELECT id FROM session_attachment WHERE status = ?',
      args: ['ready'],
    })
    const missingIds = rs.rows
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id) && !indexNames.has(`sa_${id}`))

    if (missingIds.length === 0) {
      return 0
    }

    const placeholders = missingIds.map(() => '?').join(',')
    await db.execute({
      sql: `UPDATE session_attachment
        SET status = ?,
          error = ?,
          processing_started_at = NULL,
          completed_at = NULL
        WHERE id IN (${placeholders})`,
      args: ['failed', 'Vector index is missing. Please retry indexing this attachment.', ...missingIds],
    })
    log.warn(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Marked ready attachments with missing vector indexes as failed: attachmentIds=${missingIds.join(',')}`
    )
    return missingIds.length
  } catch (error) {
    log.error(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to cleanup ready attachments with missing vector indexes:`,
      error
    )
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-db')
      scope.setTag('operation', 'cleanup_missing_vector_indexes')
      sentry.captureException(error)
    })
    return 0
  }
}

export async function deleteAttachmentIndexOrThrow(attachmentId: number) {
  await runVectorWrite(() => getVectorStore().deleteIndex({ indexName: `sa_${attachmentId}` }))
}

export async function deleteAttachmentIndex(attachmentId: number) {
  try {
    await deleteAttachmentIndexOrThrow(attachmentId)
  } catch (error) {
    log.warn(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to delete vector index for attachment ${attachmentId}:`,
      error
    )
  }
}

export async function deleteAttachmentGraph(attachmentId: number) {
  await withTransaction(async () => {
    const client = getDatabase()
    await client.execute({
      sql: 'DELETE FROM session_attachment WHERE id = ?',
      args: [attachmentId],
    })
  })
  await deleteAttachmentIndex(attachmentId)
}

/**
 * Delete multiple attachment graphs atomically:
 *  - SQL deletion of attachment + parent + chunk rows happens in a single transaction
 *    (FK CASCADE handles parent/chunk).
 *  - Vector index deletion is performed best-effort after the SQL transaction commits;
 *    this is a known cross-store gap (sqlite tables vs vector index tables) but at
 *    least the SQL side is now atomic instead of partial-on-failure.
 */
async function deleteAttachmentGraphsBatch(attachmentIds: number[]): Promise<void> {
  const ids = [...new Set(attachmentIds.filter((id) => Number.isFinite(id)))]
  if (ids.length === 0) {
    return
  }
  await withTransaction(async () => {
    const client = getDatabase()
    const placeholders = ids.map(() => '?').join(',')
    await client.execute({
      sql: `DELETE FROM session_attachment WHERE id IN (${placeholders})`,
      args: ids,
    })
  })
  await Promise.all(ids.map((id) => deleteAttachmentIndex(id)))
}

export async function createSessionAttachment(params: CreateSessionAttachmentParams): Promise<number> {
  const client = getDatabase()
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Insert attachment task: session=${params.sessionId}, message=${params.messageId}, file="${params.filename}", parser=${params.parserType ?? 'unknown'}`
  )
  const rs = await client.execute({
    sql: `INSERT INTO session_attachment
      (session_id, message_id, attachment_storage_key, filename, mime_type, file_size, token_estimate, parser_type, status, indexing_stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      params.sessionId,
      params.messageId,
      params.attachmentStorageKey,
      params.filename,
      params.mimeType,
      params.fileSize,
      params.tokenEstimate,
      params.parserType ?? null,
      'pending',
      'queued',
    ],
  })
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Inserted attachment task: attachmentId=${Number(rs.lastInsertRowid)}, status=pending`
  )
  return Number(rs.lastInsertRowid)
}

export async function getSessionAttachment(id: number): Promise<SessionAttachmentRecord | null> {
  const client = getDatabase()
  const rs = await client.execute({
    sql: `SELECT a.*,
      (SELECT COUNT(*) FROM session_attachment_chunk c WHERE c.attachment_id = a.id) AS chunk_count
      FROM session_attachment a
      WHERE a.id = ?`,
    args: [id],
  })
  const row = rs.rows[0]
  return row ? mapRowToSessionAttachmentRecord(row as Record<string, unknown>) : null
}

export async function listPendingSessionAttachments(limit = 10): Promise<SessionAttachmentRecord[]> {
  const client = getDatabase()
  const rs = await client.execute({
    sql: `SELECT a.*,
      (SELECT COUNT(*) FROM session_attachment_chunk c WHERE c.attachment_id = a.id) AS chunk_count
      FROM session_attachment a
      WHERE a.status = ?
      ORDER BY a.created_at ASC
      LIMIT ?`,
    args: ['pending', limit],
  })
  return rs.rows.map((row) => mapRowToSessionAttachmentRecord(row as Record<string, unknown>))
}

export async function listCanceledSessionAttachments(limit = 20): Promise<SessionAttachmentRecord[]> {
  const client = getDatabase()
  const rs = await client.execute({
    sql: `SELECT a.*,
      (SELECT COUNT(*) FROM session_attachment_chunk c WHERE c.attachment_id = a.id) AS chunk_count
      FROM session_attachment a
      WHERE a.status = ?
      ORDER BY a.created_at ASC
      LIMIT ?`,
    args: ['canceled', limit],
  })
  return rs.rows.map((row) => mapRowToSessionAttachmentRecord(row as Record<string, unknown>))
}

export async function purgeCanceledSessionAttachments(limit = 20): Promise<number> {
  const canceled = await listCanceledSessionAttachments(limit)
  if (canceled.length === 0) {
    return 0
  }
  for (const attachment of canceled) {
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Purging canceled attachment: attachmentId=${attachment.id}, file="${attachment.filename}"`
    )
  }
  await deleteAttachmentGraphsBatch(canceled.map((attachment) => attachment.id))
  return canceled.length
}

export async function listSessionAttachmentsByIds(ids: number[]): Promise<SessionAttachmentRecord[]> {
  if (ids.length === 0) {
    return []
  }
  const client = getDatabase()
  const placeholders = ids.map(() => '?').join(',')
  const rs = await client.execute({
    sql: `SELECT a.*,
      (SELECT COUNT(*) FROM session_attachment_chunk c WHERE c.attachment_id = a.id) AS chunk_count
      FROM session_attachment a
      WHERE a.id IN (${placeholders})`,
    args: ids,
  })
  return rs.rows.map((row) => mapRowToSessionAttachmentRecord(row as Record<string, unknown>))
}

export async function markSessionAttachmentIndexing(id: number) {
  const client = getDatabase()
  const result = await client.execute({
    sql: 'UPDATE session_attachment SET status = ?, indexing_stage = ?, error = NULL, processing_started_at = CURRENT_TIMESTAMP, completed_at = NULL WHERE id = ? AND status = ?',
    args: ['indexing', 'queued', id, 'pending'],
  })
  if ((result.rowsAffected || 0) > 0) {
    log.debug(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Marked attachment indexing: attachmentId=${id}`)
    return true
  }
  return false
}

export async function updateSessionAttachmentIndexingProgress(
  id: number,
  params: {
    indexingStage: SessionAttachmentIndexingStage
    totalChunks?: number
    embeddedChunks?: number
    embeddingModel?: string
    embeddingDimension?: number
  }
) {
  const client = getDatabase()
  const assignments = ['indexing_stage = ?']
  const args: Array<string | number> = [params.indexingStage]
  if (params.totalChunks !== undefined) {
    assignments.push('total_chunks = ?')
    args.push(params.totalChunks)
  }
  if (params.embeddedChunks !== undefined) {
    assignments.push('embedded_chunks = ?')
    args.push(params.embeddedChunks)
  }
  if (params.embeddingModel !== undefined) {
    assignments.push('embedding_model = ?')
    args.push(params.embeddingModel)
  }
  if (params.embeddingDimension !== undefined) {
    assignments.push('embedding_dimension = ?')
    args.push(params.embeddingDimension)
  }
  args.push(id)
  await client.execute({
    sql: `UPDATE session_attachment SET ${assignments.join(', ')} WHERE id = ? AND status = ?`,
    args: [...args, 'indexing'],
  })
}

export async function resetSessionAttachmentIndexingCheckpoint(id: number) {
  const client = getDatabase()
  await client.execute({
    sql: `UPDATE session_attachment
      SET indexing_stage = ?,
        total_chunks = 0,
        embedded_chunks = 0,
        embedding_model = NULL,
        embedding_dimension = NULL
      WHERE id = ? AND status = ?`,
    args: ['chunking', id, 'indexing'],
  })
}

export async function markSessionAttachmentReady(id: number) {
  const client = getDatabase()
  const result = await client.execute({
    sql: `UPDATE session_attachment
      SET status = ?,
        indexing_stage = ?,
        embedded_chunks = CASE WHEN total_chunks > 0 THEN total_chunks ELSE embedded_chunks END,
        error = NULL,
        processing_started_at = NULL,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = ?`,
    args: ['ready', 'ready', id, 'indexing'],
  })
  if ((result.rowsAffected || 0) > 0) {
    log.debug(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Marked attachment ready: attachmentId=${id}`)
    return true
  }
  return false
}

export async function markSessionAttachmentFailed(id: number, error: string) {
  const client = getDatabase()
  const result = await client.execute({
    sql: 'UPDATE session_attachment SET status = ?, error = ?, processing_started_at = NULL, completed_at = NULL WHERE id = ? AND status != ?',
    args: ['failed', error, id, 'canceled'],
  })
  if ((result.rowsAffected || 0) > 0) {
    log.debug(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Marked attachment failed: attachmentId=${id}, error=${error}`)
  }
}

export async function retrySessionAttachment(id: number) {
  const client = getDatabase()
  const existing = await getSessionAttachment(id)
  if (!existing) {
    throw new Error(`Session attachment ${id} not found`)
  }
  if (existing.status !== 'failed') {
    throw new Error('Only failed session attachments can be retried')
  }
  const result = await client.execute({
    sql: 'UPDATE session_attachment SET status = ?, indexing_stage = ?, error = NULL, processing_started_at = NULL, completed_at = NULL WHERE id = ? AND status = ?',
    args: ['pending', 'queued', id, 'failed'],
  })
  if ((result.rowsAffected || 0) === 0) {
    throw new Error('Only failed session attachments can be retried')
  }
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Queued attachment continuation: attachmentId=${id}, embeddedChunks=${existing.embeddedChunks ?? 0}, totalChunks=${existing.totalChunks ?? 0}`
  )
}

export async function cancelSessionAttachment(id: number) {
  const client = getDatabase()
  await client.execute({
    sql: 'UPDATE session_attachment SET status = ?, error = NULL, processing_started_at = NULL, completed_at = NULL WHERE id = ? AND status IN (?, ?, ?)',
    args: ['canceled', id, 'pending', 'indexing', 'failed'],
  })
  log.debug(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Marked attachment canceled: attachmentId=${id}`)
}

export async function rebindSessionAttachment(id: number, sessionId: string, messageId: string) {
  const client = getDatabase()
  await client.execute({
    sql: 'UPDATE session_attachment SET session_id = ?, message_id = ? WHERE id = ?',
    args: [sessionId, messageId, id],
  })
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Rebound attachment ownership: attachmentId=${id}, session=${sessionId}, message=${messageId}`
  )
}

export async function replaceAttachmentParentsAndChunks(
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
  chunks: Array<{
    parentOrder: number
    chunkOrder: number
    sectionPath?: string
    pageStart?: number
    pageEnd?: number
    rawText: string
    embeddedText: string
    tokenEstimate: number
  }>
): Promise<Map<number, number>> {
  return await withTransaction(async () => {
    const client = getDatabase()
    await client.execute({
      sql: 'DELETE FROM session_attachment_chunk WHERE attachment_id = ?',
      args: [attachmentId],
    })
    await client.execute({
      sql: 'DELETE FROM session_attachment_parent WHERE attachment_id = ?',
      args: [attachmentId],
    })

    const parentIdMap = new Map<number, number>()
    for (const parent of parents) {
      const rs = await client.execute({
        sql: `INSERT INTO session_attachment_parent
          (attachment_id, parent_order, section_path, doc_type, page_start, page_end, text, token_estimate, char_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          attachmentId,
          parent.parentOrder,
          parent.sectionPath ?? null,
          parent.docType ?? null,
          parent.pageStart ?? null,
          parent.pageEnd ?? null,
          parent.text,
          parent.tokenEstimate,
          parent.charCount,
        ],
      })
      parentIdMap.set(parent.parentOrder, Number(rs.lastInsertRowid))
    }

    for (const chunk of chunks) {
      const parentId = parentIdMap.get(chunk.parentOrder)
      if (!parentId) {
        throw new Error(`Parent order ${chunk.parentOrder} not found when inserting child chunk`)
      }
      await client.execute({
        sql: `INSERT INTO session_attachment_chunk
          (attachment_id, parent_id, chunk_order, section_path, page_start, page_end, raw_text, embedded_text, token_estimate)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          attachmentId,
          parentId,
          chunk.chunkOrder,
          chunk.sectionPath ?? null,
          chunk.pageStart ?? null,
          chunk.pageEnd ?? null,
          chunk.rawText,
          chunk.embeddedText,
          chunk.tokenEstimate,
        ],
      })
    }

    return parentIdMap
  })
}

export async function listSessionAttachmentChunks(attachmentId: number): Promise<SessionAttachmentChunkRecord[]> {
  const client = getDatabase()
  const rs = await client.execute({
    sql: `SELECT id, attachment_id, parent_id, chunk_order, section_path, raw_text, embedded_text, token_estimate
      FROM session_attachment_chunk
      WHERE attachment_id = ?
      ORDER BY chunk_order ASC`,
    args: [attachmentId],
  })
  return rs.rows.map((row) => ({
    id: Number(row.id),
    attachmentId: Number(row.attachment_id),
    parentId: Number(row.parent_id),
    chunkOrder: Number(row.chunk_order),
    sectionPath: row.section_path ? String(row.section_path) : undefined,
    rawText: String(row.raw_text),
    embeddedText: String(row.embedded_text),
    tokenEstimate: Number(row.token_estimate ?? 0),
  }))
}

export async function hasAttachmentVectorIndex(attachmentId: number): Promise<boolean> {
  const indexNames = await getVectorStore().listIndexes()
  return indexNames.includes(`sa_${attachmentId}`)
}

export async function readSessionAttachmentParents(parentIds: number[], allowedAttachmentIds: number[]) {
  if (parentIds.length === 0 || allowedAttachmentIds.length === 0) {
    return []
  }
  const client = getDatabase()
  const parentPlaceholders = parentIds.map(() => '?').join(',')
  const attachmentPlaceholders = allowedAttachmentIds.map(() => '?').join(',')
  const rs = await client.execute({
    sql: `SELECT p.*, a.filename
      FROM session_attachment_parent p
      JOIN session_attachment a ON a.id = p.attachment_id
      WHERE p.id IN (${parentPlaceholders})
        AND p.attachment_id IN (${attachmentPlaceholders})`,
    args: [...parentIds, ...allowedAttachmentIds],
  })
  return rs.rows
}

export async function deleteMessageAttachments(messageId: string): Promise<number[]> {
  const client = getDatabase()
  const rs = await client.execute({
    sql: 'SELECT id FROM session_attachment WHERE message_id = ?',
    args: [messageId],
  })
  const ids = rs.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id))
  await deleteAttachmentGraphsBatch(ids)
  return ids
}

export async function deleteSessionAttachments(sessionId: string): Promise<number[]> {
  const client = getDatabase()
  const rs = await client.execute({
    sql: 'SELECT id FROM session_attachment WHERE session_id = ?',
    args: [sessionId],
  })
  const ids = rs.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id))
  await deleteAttachmentGraphsBatch(ids)
  return ids
}

export async function deleteSingleAttachment(attachmentId: number): Promise<void> {
  const existing = await getSessionAttachment(attachmentId)
  if (!existing) {
    return
  }

  if (existing.status === 'pending' || existing.status === 'indexing') {
    await cancelSessionAttachment(attachmentId)
    return
  }

  await deleteAttachmentGraph(attachmentId)
}

export async function clearAllSessionAttachments(): Promise<number> {
  const client = getDatabase()
  const rs = await client.execute({
    sql: 'SELECT id FROM session_attachment',
  })
  const ids = rs.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id))

  await deleteAttachmentGraphsBatch(ids)

  const orphanIndexNames = await getVectorStore()
    .listIndexes()
    .then((indexes) => indexes.filter((indexName) => indexName.startsWith('sa_')).sort())
    .catch((error) => {
      log.warn(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to list orphan vector indexes:`, error)
      return []
    })
  for (const indexName of orphanIndexNames) {
    try {
      await getVectorStore().deleteIndex({ indexName })
    } catch (error) {
      log.warn(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to delete orphan vector index ${indexName}:`, error)
    }
  }

  log.info(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Cleared all session attachment rag data: attachments=${ids.length}`
  )
  return ids.length
}

export async function cleanupOrphanAttachments(
  validSessionIds: string[],
  validMessageIds: string[],
  attachmentReferences: SessionAttachmentOwnershipClaim[] = []
): Promise<number[]> {
  const client = getDatabase()
  const rs = await client.execute({
    sql: 'SELECT id, session_id, message_id FROM session_attachment',
  })

  const { deleteIds, repairs } = planOrphanCleanup(
    rs.rows.map((row) => ({
      id: Number(row.id),
      sessionId: String(row.session_id),
      messageId: String(row.message_id),
    })),
    { sessionIds: validSessionIds, messageIds: validMessageIds, attachmentReferences }
  )

  // Repair before deleting: a row handed to a live message must never be swept
  // in the same pass, and a failed repair leaves it for the next one.
  for (const repair of repairs) {
    await rebindSessionAttachment(repair.attachmentId, repair.sessionId, repair.messageId)
  }
  await deleteAttachmentGraphsBatch(deleteIds)

  return deleteIds
}

export async function getSessionAttachmentDebugSnapshot(): Promise<SessionAttachmentDebugSnapshot> {
  const client = getDatabase()

  const [attachmentCountResult, parentCountResult, chunkCountResult, statusCountResult, recentResult] =
    await Promise.all([
      client.execute('SELECT COUNT(*) AS count FROM session_attachment'),
      client.execute('SELECT COUNT(*) AS count FROM session_attachment_parent'),
      client.execute('SELECT COUNT(*) AS count FROM session_attachment_chunk'),
      client.execute('SELECT status, COUNT(*) AS count FROM session_attachment GROUP BY status'),
      client.execute({
        sql: `SELECT a.*,
          (SELECT COUNT(*) FROM session_attachment_chunk c WHERE c.attachment_id = a.id) AS chunk_count
          FROM session_attachment a
          WHERE a.status != 'canceled'
          ORDER BY a.id DESC
          LIMIT 20`,
      }),
    ])
  const vectorIndexNames = await getVectorStore()
    .listIndexes()
    .then((indexes) => indexes.filter((indexName) => indexName.startsWith('sa_')).sort())
    .catch((error) => {
      log.warn(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [DB] Failed to list vector indexes for debug snapshot:`, error)
      return []
    })

  const statusCounts = {
    pending: 0,
    indexing: 0,
    ready: 0,
    failed: 0,
  }

  for (const row of statusCountResult.rows) {
    const status = String(row.status) as keyof typeof statusCounts
    if (status in statusCounts) {
      statusCounts[status] = Number(row.count ?? 0)
    }
  }

  return {
    dbPath,
    dbSizeBytes: getFileSizeBytes(dbPath),
    vectorDbPath,
    vectorDbSizeBytes: getFileSizeBytes(vectorDbPath),
    attachmentCount: Number(attachmentCountResult.rows[0]?.count ?? 0),
    parentCount: Number(parentCountResult.rows[0]?.count ?? 0),
    chunkCount: Number(chunkCountResult.rows[0]?.count ?? 0),
    vectorIndexNames,
    statusCounts,
    recentAttachments: recentResult.rows.map((row) => {
      const attachment = mapRowToSessionAttachmentRecord(row as Record<string, unknown>)
      return {
        ...attachment,
        status: attachment.status === 'canceled' ? 'failed' : attachment.status,
      }
    }),
  }
}
