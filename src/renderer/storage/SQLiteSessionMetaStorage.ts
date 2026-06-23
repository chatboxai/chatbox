import {
  CapacitorSQLite,
  type capSQLiteSet,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import type { SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { type SessionMetaStorage, sortSessionRecords } from './SessionMetaStorage'

const DB_NAME = 'chatbox-session-meta'

function safeJsonParse(value: string | null | undefined): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function parseBackgroundImage(value: string | null | undefined): SessionMetaRecord['backgroundImage'] {
  const parsed = safeJsonParse(value)
  if (!parsed || typeof parsed !== 'object') return undefined
  if ('type' in parsed && parsed.type === 'url' && 'url' in parsed && typeof parsed.url === 'string') {
    return { type: 'url', url: parsed.url }
  }
  if (
    'type' in parsed &&
    parsed.type === 'storage-key' &&
    'storageKey' in parsed &&
    typeof parsed.storageKey === 'string'
  ) {
    return { type: 'storage-key', storageKey: parsed.storageKey }
  }
  return undefined
}

export class SQLiteSessionMetaStorage implements SessionMetaStorage {
  private sqlite: SQLiteConnection
  private database!: SQLiteDBConnection
  private initPromise: Promise<void> | null = null

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite)
  }

  initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.openDatabase()
    return this.initPromise
  }

  private async openDatabase(): Promise<void> {
    try {
      this.sqlite.closeConnection(DB_NAME, false)
    } catch {
      // ignore - connection may not exist
    }

    this.database = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
    await this.database.open()

    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS session_meta (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        starred INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        assistant_avatar_key TEXT,
        pic_url TEXT,
        background_image TEXT,
        type TEXT,
        group_id TEXT,
        sort_order REAL NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    // Add group_id to pre-existing tables (SQLite has no ADD COLUMN IF NOT EXISTS).
    try {
      await this.database.execute('ALTER TABLE session_meta ADD COLUMN group_id TEXT')
    } catch {
      // column already exists
    }

    await this.database.execute(`
      CREATE INDEX IF NOT EXISTS idx_session_meta_sort_order
      ON session_meta(sort_order DESC)
    `)

    await this.database.execute(`
      CREATE INDEX IF NOT EXISTS idx_session_meta_group
      ON session_meta(group_id, sort_order DESC)
    `)
  }

  private recordToRow(record: SessionMetaRecord): Record<string, unknown> {
    return {
      id: record.id,
      name: record.name,
      starred: record.starred ? 1 : 0,
      hidden: record.hidden ? 1 : 0,
      assistant_avatar_key: record.assistantAvatarKey || null,
      pic_url: record.picUrl || null,
      background_image: record.backgroundImage ? JSON.stringify(record.backgroundImage) : null,
      type: record.type || null,
      group_id: record.groupId || null,
      sort_order: record.sortOrder,
      created_at: record.createdAt,
    }
  }

  private rowToRecord(row: Record<string, unknown>): SessionMetaRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      starred: row.starred === 1 ? true : undefined,
      hidden: row.hidden === 1 ? true : undefined,
      assistantAvatarKey: (row.assistant_avatar_key as string) || undefined,
      picUrl: (row.pic_url as string) || undefined,
      backgroundImage: parseBackgroundImage(row.background_image as string),
      type: (row.type as SessionMetaRecord['type']) || undefined,
      groupId: (row.group_id as string) || undefined,
      sortOrder: row.sort_order as number,
      createdAt: row.created_at as number,
    }
  }

  async create(record: SessionMetaRecord): Promise<void> {
    await this.initialize()
    const row = this.recordToRow(record)
    await this.database.run(
      `INSERT INTO session_meta
       (id, name, starred, hidden, assistant_avatar_key, pic_url, background_image, type, group_id, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.starred,
        row.hidden,
        row.assistant_avatar_key,
        row.pic_url,
        row.background_image,
        row.type,
        row.group_id,
        row.sort_order,
        row.created_at,
      ]
    )
  }

  async createMany(records: SessionMetaRecord[]): Promise<void> {
    await this.initialize()
    if (records.length === 0) return

    const statement = `INSERT OR REPLACE INTO session_meta
      (id, name, starred, hidden, assistant_avatar_key, pic_url, background_image, type, group_id, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    const set: capSQLiteSet[] = records.map((record) => {
      const row = this.recordToRow(record)
      return {
        statement,
        values: [
          row.id,
          row.name,
          row.starred,
          row.hidden,
          row.assistant_avatar_key,
          row.pic_url,
          row.background_image,
          row.type,
          row.group_id,
          row.sort_order,
          row.created_at,
        ],
      }
    })

    await this.database.executeSet(set, true)
  }

  async update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    await this.initialize()
    const existing = await this.getById(id)
    if (!existing) return null

    const updated = { ...existing, ...updates }
    const row = this.recordToRow(updated)

    await this.database.run(
      `UPDATE session_meta SET
       name = ?, starred = ?, hidden = ?, assistant_avatar_key = ?, pic_url = ?,
       background_image = ?, type = ?, group_id = ?, sort_order = ?, created_at = ?
       WHERE id = ?`,
      [
        row.name,
        row.starred,
        row.hidden,
        row.assistant_avatar_key,
        row.pic_url,
        row.background_image,
        row.type,
        row.group_id,
        row.sort_order,
        row.created_at,
        id,
      ]
    )

    return updated
  }

  async getById(id: string): Promise<SessionMetaRecord | null> {
    await this.initialize()
    const result = await this.database.query('SELECT * FROM session_meta WHERE id = ?', [id])
    if (!result.values || result.values.length === 0) return null
    return this.rowToRecord(result.values[0])
  }

  async delete(id: string): Promise<void> {
    await this.initialize()
    await this.database.run('DELETE FROM session_meta WHERE id = ?', [id])
  }

  async deleteMany(ids: string[]): Promise<void> {
    await this.initialize()
    if (ids.length === 0) return
    const set: capSQLiteSet[] = ids.map((id) => ({
      statement: 'DELETE FROM session_meta WHERE id = ?',
      values: [id],
    }))
    await this.database.executeSet(set, true)
  }

  async getAll(): Promise<SessionMetaRecord[]> {
    await this.initialize()
    const result = await this.database.query('SELECT * FROM session_meta ORDER BY sort_order DESC')
    const records = (result.values || []).map((row) => this.rowToRecord(row))
    return sortSessionRecords(records)
  }

  async getPage(cursor: number = 0, limit: number = 50): Promise<SessionMetaPage> {
    await this.initialize()
    const result = await this.database.query(
      'SELECT * FROM session_meta WHERE hidden = 0 ORDER BY starred DESC, sort_order DESC LIMIT ? OFFSET ?',
      [limit, cursor]
    )
    const items = (result.values || []).map((row) => this.rowToRecord(row))
    const total = await this.getTotal()
    const nextCursor = items.length === limit ? cursor + items.length : null
    return { items, nextCursor, total }
  }

  async getPageByGroup(
    groupId: string | null,
    cursor: number | null = null,
    limit: number = 50
  ): Promise<SessionMetaPage> {
    await this.initialize()
    const groupClause = groupId === null ? 'group_id IS NULL' : 'group_id = ?'
    const params: unknown[] = groupId === null ? [] : [groupId]
    let sql = `SELECT * FROM session_meta WHERE hidden = 0 AND ${groupClause}`
    if (cursor !== null) {
      sql += ' AND sort_order < ?'
      params.push(cursor)
    }
    sql += ' ORDER BY sort_order DESC LIMIT ?'
    params.push(limit)
    const result = await this.database.query(sql, params)
    const items = (result.values || []).map((row) => this.rowToRecord(row))
    const total = await this.getTotalByGroup(groupId)
    const nextCursor = items.length === limit ? (items[items.length - 1]?.sortOrder ?? null) : null
    return { items, nextCursor, total }
  }

  async getTotal(): Promise<number> {
    await this.initialize()
    const result = await this.database.query('SELECT COUNT(*) as total FROM session_meta WHERE hidden = 0')
    return (result.values?.[0]?.total as number) || 0
  }

  async getTotalByGroup(groupId: string | null): Promise<number> {
    await this.initialize()
    const groupClause = groupId === null ? 'group_id IS NULL' : 'group_id = ?'
    const params: unknown[] = groupId === null ? [] : [groupId]
    const result = await this.database.query(
      `SELECT COUNT(*) as total FROM session_meta WHERE hidden = 0 AND ${groupClause}`,
      params
    )
    return (result.values?.[0]?.total as number) || 0
  }

  async clear(): Promise<void> {
    await this.initialize()
    await this.database.run('DELETE FROM session_meta')
  }
}
