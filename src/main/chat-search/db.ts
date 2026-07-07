import fs from 'node:fs'
import path from 'node:path'
import { type Client, createClient } from '@libsql/client'
import { app } from 'electron'
import { CHAT_SEARCH_SCHEMA_VERSION } from '../../shared/chat-search'
import { getLogger } from '../util'

const log = getLogger('chat-search:db')

// Do not use `${userData}/databases`: Chromium/Electron profile storage may
// unlink files in that directory. Keep app-owned sqlite files in our own folder.
const userDataPath = app.getPath('userData')
const appDatabaseDir = path.join(userDataPath, 'workspaice-databases')
const defaultDbPath = path.join(appDatabaseDir, 'workspaice_chat_search.db')
const dbPath = process.env.CHAT_SEARCH_DB_PATH || defaultDbPath

function ensureDbDir(filePath: string) {
  const dbDir = path.dirname(filePath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
}

let db: Client | null = null

export interface ChatSearchEntry {
  messageId: string
  text: string
}

export interface ChatSearchHit {
  sessionId: string
  messageId: string
}

export function getChatSearchDbPath() {
  return dbPath
}

export function getDatabase(): Client {
  if (!db) {
    throw new Error('chat-search database not initialized')
  }
  return db
}

export async function initializeDatabase(): Promise<void> {
  ensureDbDir(dbPath)
  db = createClient({ url: `file:${dbPath}` })
  await db.execute('PRAGMA journal_mode = WAL')
  await db.execute('PRAGMA busy_timeout = 5000')
  // The trigram tokenizer gives case-insensitive substring matching for any
  // language (incl. CJK), mirroring the renderer's previous regex-scan
  // semantics. Queries under 3 characters return nothing — the renderer falls
  // back to the brute-force scan for those.
  await db.batch(
    [
      `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        text,
        session_id UNINDEXED,
        message_id UNINDEXED,
        tokenize = 'trigram'
      )`,
      `CREATE TABLE IF NOT EXISTS chat_search_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
    'write'
  )
  await db.execute(`PRAGMA user_version = ${CHAT_SEARCH_SCHEMA_VERSION}`)
  log.info(`chat-search database ready at ${dbPath}`)
}

/** Replace the whole index for one session (sessions are the write granularity). */
export async function upsertSessionIndex(sessionId: string, entries: ChatSearchEntry[]): Promise<void> {
  const client = getDatabase()
  const statements = [
    { sql: 'DELETE FROM message_fts WHERE session_id = ?', args: [sessionId] },
    ...entries
      .filter((e) => e.text.trim().length > 0)
      .map((e) => ({
        sql: 'INSERT INTO message_fts (text, session_id, message_id) VALUES (?, ?, ?)',
        args: [e.text, sessionId, e.messageId],
      })),
  ]
  await client.batch(statements, 'write')
}

export async function deleteSessionIndex(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) {
    return
  }
  const client = getDatabase()
  await client.batch(
    sessionIds.map((id) => ({ sql: 'DELETE FROM message_fts WHERE session_id = ?', args: [id] })),
    'write'
  )
}

/**
 * Substring search across all indexed messages. The raw user input is wrapped
 * as a single quoted FTS phrase (internal quotes doubled), which under the
 * trigram tokenizer means plain case-insensitive substring matching — no FTS
 * query operators apply.
 */
export async function queryIndex(query: string, limit: number): Promise<ChatSearchHit[]> {
  const client = getDatabase()
  const phrase = `"${query.replaceAll('"', '""')}"`
  const result = await client.execute({
    sql: 'SELECT session_id, message_id FROM message_fts WHERE message_fts MATCH ? ORDER BY rank LIMIT ?',
    args: [phrase, limit],
  })
  return result.rows.map((row) => ({
    sessionId: String(row.session_id),
    messageId: String(row.message_id),
  }))
}

export async function getMeta(key: string): Promise<string | null> {
  const client = getDatabase()
  const result = await client.execute({ sql: 'SELECT value FROM chat_search_meta WHERE key = ?', args: [key] })
  return result.rows.length > 0 ? String(result.rows[0].value) : null
}

export async function setMeta(key: string, value: string): Promise<void> {
  const client = getDatabase()
  await client.execute({
    sql: 'INSERT INTO chat_search_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    args: [key, value],
  })
}

/** Drop all indexed content and meta (a renderer-triggered full rebuild follows). */
export async function clearIndex(): Promise<void> {
  const client = getDatabase()
  await client.batch(['DELETE FROM message_fts', 'DELETE FROM chat_search_meta'], 'write')
}
