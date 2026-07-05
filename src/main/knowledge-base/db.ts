import fs from 'node:fs'
import path from 'node:path'
import type { Client } from '@libsql/client'
import { LibSQLVector } from '@mastra/libsql'
import { app } from 'electron'
import { sentry } from '../../shared/sentry-shim'
import { getLogger } from '../util'

const log = getLogger('knowledge-base:db')

// Do not use `${userData}/databases`: Chromium/Electron profile storage may
// unlink files in that directory. Keep app-owned sqlite files in our own folder.
const userDataPath = app.getPath('userData')
const appDatabaseDir = path.join(userDataPath, 'workspaice-databases')
const dbPath = path.join(appDatabaseDir, 'workspaice_kb.db')

// Ensure database directory exists
const dbDir = path.dirname(dbPath)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

// Polyfill for mastra
if (typeof global.crypto === 'undefined' || !('subtle' in global.crypto)) {
  global.crypto = require('node:crypto')
}

let db: Client
let vectorStore: LibSQLVector

async function initDB(db: Client) {
  try {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS knowledge_base (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        rerank_model TEXT,
        vision_model TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS kb_file (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kb_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        chunk_count INTEGER DEFAULT 0,
        total_chunks INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processing_started_at DATETIME,
        FOREIGN KEY (kb_id) REFERENCES knowledge_base(id)
      )`,
    ])
    // Add total_chunks column if it doesn't exist (for existing databases)
    await db.batch([`ALTER TABLE kb_file ADD COLUMN total_chunks INTEGER DEFAULT 0`]).catch((error) => {
      if (error instanceof Error && !error.message.includes('duplicate column name')) {
        log.error('[DB] Failed to add total_chunks column', error)
      } else {
        // Ignore error if column already exists
        log.info('[DB] Database initialized (total_chunks column already exists)')
      }
    })

    // Add use_remote_parsing column if it doesn't exist (for remote parsing feature)
    await db.batch([`ALTER TABLE kb_file ADD COLUMN use_remote_parsing INTEGER DEFAULT 0`]).catch((error) => {
      if (error instanceof Error && !error.message.includes('duplicate column name')) {
        log.error('[DB] Failed to add use_remote_parsing column', error)
      }
    })

    // Add parsed_remotely column to track which parsing method was used (for UI display)
    await db.batch([`ALTER TABLE kb_file ADD COLUMN parsed_remotely INTEGER DEFAULT 0`]).catch((error) => {
      if (error instanceof Error && !error.message.includes('duplicate column name')) {
        log.error('[DB] Failed to add parsed_remotely column', error)
      }
    })

    // Add document_parser column to knowledge_base table (JSON format, NULL means use global config)
    await db.batch([`ALTER TABLE knowledge_base ADD COLUMN document_parser TEXT DEFAULT NULL`]).catch((error) => {
      if (error instanceof Error && !error.message.includes('duplicate column name')) {
        log.error('[DB] Failed to add document_parser column', error)
      }
    })

    // Add parser_type column to kb_file table to record which parser was used
    await db.batch([`ALTER TABLE kb_file ADD COLUMN parser_type TEXT DEFAULT 'local'`]).catch((error) => {
      if (error instanceof Error && !error.message.includes('duplicate column name')) {
        log.error('[DB] Failed to add parser_type column', error)
      }
    })

    // Add provider_mode column to knowledge_base table to store user's provider mode selection
    await db.batch([`ALTER TABLE knowledge_base ADD COLUMN provider_mode TEXT DEFAULT NULL`]).catch((error) => {
      if (error instanceof Error && !error.message.includes('duplicate column name')) {
        log.error('[DB] Failed to add provider_mode column', error)
      }
    })

    log.info('[DB] Database initialized')
  } catch (error) {
    log.error('[DB] Failed to initialize database:', error)

    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-db')
      scope.setTag('operation', 'database_initialization')
      scope.setExtra('dbPath', dbPath)
      sentry.captureException(error)
    })
    throw error
  }
}

export async function initializeDatabase() {
  try {
    vectorStore = new LibSQLVector({
      connectionUrl: `file:${dbPath}`,
    })
    // 这里不再创建新的 client，因为多个 client 同时操作一个 db 文件会导致数据损坏
    // biome-ignore lint/suspicious/noExplicitAny: access internal property
    db = (vectorStore as any).turso
    await initDB(db)

    // Clean up any processing files left from previous session
    await cleanupProcessingFiles()
  } catch (error) {
    log.error('[DB] Failed to initialize database system:', error)
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-db')
      scope.setTag('operation', 'vector_store_initialization')
      scope.setExtra('dbPath', dbPath)
      sentry.captureException(error)
    })
    throw error
  }
}

export function getDatabase(): Client {
  if (!db) {
    const error = new Error('Database not initialized')
    log.error('[DB] Database not initialized')
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-db')
      scope.setTag('operation', 'database_access')
      sentry.captureException(error)
    })
    throw error
  }
  return db
}

export function getVectorStore(): LibSQLVector {
  if (!vectorStore) {
    const error = new Error('Vector store not initialized')
    log.error('[DB] Vector store not initialized')
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-db')
      scope.setTag('operation', 'vector_store_access')
      sentry.captureException(error)
    })
    throw error
  }
  return vectorStore
}

// Helper function to parse SQLite timestamp correctly
export function parseSQLiteTimestamp(sqliteTimestamp: string): number {
  try {
    // SQLite CURRENT_TIMESTAMP returns UTC time in format: 'YYYY-MM-DD HH:MM:SS'
    // We need to explicitly tell JavaScript this is UTC time
    const utcDate = new Date(`${sqliteTimestamp} UTC`)
    const timestamp = utcDate.getTime()

    if (Number.isNaN(timestamp)) {
      throw new Error(`Invalid timestamp format: ${sqliteTimestamp}`)
    }

    return timestamp
  } catch (error) {
    log.error(`[DB] Failed to parse SQLite timestamp: ${sqliteTimestamp}`, error)
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-db')
      scope.setTag('operation', 'timestamp_parsing')
      scope.setExtra('sqliteTimestamp', sqliteTimestamp)
      sentry.captureException(error)
    })
    // Return current timestamp as fallback
    return Date.now()
  }
}

// Transaction wrapper - ensures atomicity of database operations
export async function withTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const db = getDatabase()
  const transactionId = Math.random().toString(36).slice(2, 10)

  try {
    log.debug(`[DB] Starting transaction ${transactionId}`)
    await db.execute('BEGIN TRANSACTION')
    const result = await operation()
    await db.execute('COMMIT')
    log.debug(`[DB] Transaction ${transactionId} committed successfully`)
    return result
  } catch (error) {
    log.error(`[DB] Transaction ${transactionId} failed:`, error)

    try {
      await db.execute('ROLLBACK')
      log.debug(`[DB] Transaction ${transactionId} rolled back`)
    } catch (rollbackError) {
      log.error(`[DB] Failed to rollback transaction ${transactionId}:`, rollbackError)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-db')
        scope.setTag('operation', 'transaction_rollback')
        scope.setExtra('transactionId', transactionId)
        sentry.captureException(rollbackError)
      })
    }

    // Report transaction failures to Sentry for critical operations
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-db')
      scope.setTag('operation', 'transaction_failure')
      scope.setExtra('transactionId', transactionId)
      sentry.captureException(error)
    })

    throw error
  }
}

// Cleanup processing files that may have been left from previous session
async function cleanupProcessingFiles() {
  try {
    log.debug('[DB] Cleaning up processing files from previous session...')
    const result = await db.execute({
      sql: 'UPDATE kb_file SET status = ?, processing_started_at = NULL WHERE status = ?',
      args: ['paused', 'processing'],
    })
    const affectedRows = result.rowsAffected || 0
    if (affectedRows > 0) {
      log.debug(`[DB] Set ${affectedRows} interrupted processing files to paused status (manual resume required)`)
    }
  } catch (err) {
    log.error('[DB] Failed to cleanup processing files:', err)
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-db')
      scope.setTag('operation', 'cleanup_processing_files')
      sentry.captureException(err)
    })
  }
}

// Check for timed out processing files and mark them as failed
export async function checkProcessingTimeouts() {
  try {
    // Files processing for more than 5 minutes should be marked as failed
    const timeoutMinutes = 5
    const timeoutThreshold = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString()

    const db = getDatabase()

    // Find processing files that started before the timeout threshold
    const rs = await db.execute({
      sql: `SELECT id, filename FROM kb_file 
            WHERE status = 'processing' 
            AND processing_started_at IS NOT NULL
            AND datetime(processing_started_at) < datetime(?)`,
      args: [timeoutThreshold],
    })

    if (rs.rows.length > 0) {
      log.debug(`[DB] Found ${rs.rows.length} timed out processing files`)

      // Mark them as failed
      for (const file of rs.rows) {
        await db.execute({
          sql: 'UPDATE kb_file SET status = ?, error = ?, processing_started_at = NULL WHERE id = ?',
          args: ['failed', `Processing timeout after ${timeoutMinutes} minutes`, file.id],
        })
        log.debug(`[DB] Marked file as failed due to timeout: ${file.filename} (id=${file.id})`)
      }
    }
  } catch (err) {
    log.error('[DB] Failed to check processing timeouts:', err)
  }
}
