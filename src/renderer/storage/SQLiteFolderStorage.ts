import {
  CapacitorSQLite,
  type capSQLiteSet,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import type { Folder } from '@shared/types/folder'
import { type FolderStorage, sortFolderRecords } from './FolderStorage'

const DB_NAME = 'chatbox-folders'

export class SQLiteFolderStorage implements FolderStorage {
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
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        parent_id TEXT,
        sort_order REAL NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    await this.database.execute(`
      CREATE INDEX IF NOT EXISTS idx_folders_parent_sort
      ON folders(parent_id, sort_order DESC)
    `)
  }

  private recordToRow(record: Folder): Record<string, unknown> {
    return {
      id: record.id,
      name: record.name,
      parent_id: record.parentId ?? null,
      sort_order: record.sortOrder,
      created_at: record.createdAt,
    }
  }

  private rowToRecord(row: Record<string, unknown>): Folder {
    return {
      id: row.id as string,
      type: 'folder',
      name: (row.name as string) ?? '',
      parentId: row.parent_id === null || row.parent_id === undefined ? null : (row.parent_id as string),
      sortOrder: Number(row.sort_order),
      createdAt: Number(row.created_at),
    }
  }

  async create(record: Folder): Promise<void> {
    await this.initialize()
    const row = this.recordToRow(record)
    await this.database.run(
      `INSERT INTO folders (id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.name, row.parent_id, row.sort_order, row.created_at]
    )
  }

  async createMany(records: Folder[]): Promise<void> {
    await this.initialize()
    if (records.length === 0) return

    const statement = `INSERT OR REPLACE INTO folders (id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`
    const set: capSQLiteSet[] = records.map((record) => {
      const row = this.recordToRow(record)
      return {
        statement,
        values: [row.id, row.name, row.parent_id, row.sort_order, row.created_at],
      }
    })

    await this.database.executeSet(set, true)
  }

  async update(id: string, updates: Partial<Folder>): Promise<Folder | null> {
    await this.initialize()
    const existing = await this.getById(id)
    if (!existing) return null

    const updated: Folder = { ...existing, ...updates, id: existing.id, type: 'folder' }
    const row = this.recordToRow(updated)

    await this.database.run(`UPDATE folders SET name = ?, parent_id = ?, sort_order = ?, created_at = ? WHERE id = ?`, [
      row.name,
      row.parent_id,
      row.sort_order,
      row.created_at,
      id,
    ])

    return updated
  }

  async getById(id: string): Promise<Folder | null> {
    await this.initialize()
    const result = await this.database.query('SELECT * FROM folders WHERE id = ?', [id])
    if (!result.values || result.values.length === 0) return null
    return this.rowToRecord(result.values[0])
  }

  async delete(id: string): Promise<void> {
    await this.initialize()
    await this.database.run('DELETE FROM folders WHERE id = ?', [id])
  }

  async deleteMany(ids: string[]): Promise<void> {
    await this.initialize()
    if (ids.length === 0) return
    const set: capSQLiteSet[] = ids.map((id) => ({
      statement: 'DELETE FROM folders WHERE id = ?',
      values: [id],
    }))
    await this.database.executeSet(set, true)
  }

  async getAll(): Promise<Folder[]> {
    await this.initialize()
    const result = await this.database.query('SELECT * FROM folders ORDER BY sort_order DESC')
    const records = (result.values || []).map((row) => this.rowToRecord(row))
    return sortFolderRecords(records)
  }

  async getChildren(parentId: string | null): Promise<Folder[]> {
    await this.initialize()
    if (parentId === null || parentId === undefined) {
      const result = await this.database.query('SELECT * FROM folders WHERE parent_id IS NULL ORDER BY sort_order DESC')
      return (result.values || []).map((row) => this.rowToRecord(row))
    }
    const result = await this.database.query('SELECT * FROM folders WHERE parent_id = ? ORDER BY sort_order DESC', [
      parentId,
    ])
    return (result.values || []).map((row) => this.rowToRecord(row))
  }

  async clear(): Promise<void> {
    await this.initialize()
    await this.database.run('DELETE FROM folders')
  }
}
