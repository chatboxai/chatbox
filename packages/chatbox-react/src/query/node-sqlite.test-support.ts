import { createRequire } from 'node:module'
import { SessionRowConflictError } from '@chatbox/core/ports'
import type {
  SessionRowSqlBatchOptions,
  SessionRowSqlBindValue,
  SessionRowSqlDatabase,
  SessionRowSqlStatement,
} from '@chatbox/core/persistence'

interface NodeSQLiteStatement {
  all(...values: SessionRowSqlBindValue[]): Array<Record<string, unknown>>
  run(...values: SessionRowSqlBindValue[]): unknown
}

interface NodeSQLiteDatabase {
  close(): void
  exec(source: string): void
  prepare(source: string): NodeSQLiteStatement
}

interface NodeSQLiteModule {
  DatabaseSync: new (filename: string) => NodeSQLiteDatabase
}

const nodeSQLite = createRequire(import.meta.url)('node:sqlite') as NodeSQLiteModule

/** SQLite adapter for source-bound context projection tests. */
export class NodeSessionRowSqlDatabase implements SessionRowSqlDatabase {
  constructor(private readonly database: NodeSQLiteDatabase) {}

  execute(sql: string): Promise<void> {
    this.database.exec(sql)
    return Promise.resolve()
  }

  query<T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> {
    return Promise.resolve(this.database.prepare(sql).all(...params) as T[])
  }

  executeBatch(statements: Iterable<SessionRowSqlStatement>, options?: SessionRowSqlBatchOptions): Promise<void> {
    this.database.exec('BEGIN')
    try {
      if (options?.expectedRevision !== undefined) {
        const rows = this.database
          .prepare('SELECT revision AS commit_revision FROM session_row_heads WHERE session_id = ? LIMIT 1')
          .all(options.sessionId) as Array<{ commit_revision?: number | null }>
        const actualRevision = rows[0]?.commit_revision ?? null
        if (actualRevision !== options.expectedRevision) {
          throw new SessionRowConflictError(options.sessionId, options.expectedRevision, actualRevision)
        }
      }
      for (const statement of statements) {
        this.database.prepare(statement.sql).run(...statement.params)
      }
      if (options?.resultRevision !== undefined) {
        const sql = 'INSERT OR REPLACE INTO session_row_heads (session_id, revision, mutation_id) VALUES (?, ?, ?)'
        this.database.prepare(sql).run(options.sessionId, options.resultRevision, 'native')
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      return Promise.reject(error)
    }
    return Promise.resolve()
  }

  close(): void {
    this.database.close()
  }
}

export function openNodeSessionRowDatabase(filename = ':memory:'): NodeSessionRowSqlDatabase {
  return new NodeSessionRowSqlDatabase(new nodeSQLite.DatabaseSync(filename))
}
