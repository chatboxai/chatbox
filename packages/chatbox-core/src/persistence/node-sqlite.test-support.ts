import { createRequire } from 'node:module'
import { SessionRowConflictError } from '../ports/session-row-store'
import type {
  SessionRowSqlBatchOptions,
  SessionRowSqlBindValue,
  SessionRowSqlDatabase,
  SessionRowSqlStatement,
} from './session-row-sql'

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

/** Real-SQLite `SessionRowSqlDatabase` for tests; records the SQL it runs. */
export class NodeSessionRowSqlDatabase implements SessionRowSqlDatabase {
  readonly executed: string[] = []
  batchCount = 0

  constructor(private readonly database: NodeSQLiteDatabase) {}

  execute(sql: string): Promise<void> {
    this.executed.push(sql)
    this.database.exec(sql)
    return Promise.resolve()
  }

  query<T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> {
    this.executed.push(sql)
    return Promise.resolve(this.database.prepare(sql).all(...params) as T[])
  }

  executeBatch(statements: SessionRowSqlStatement[], options?: SessionRowSqlBatchOptions): Promise<void> {
    this.batchCount += 1
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
        this.executed.push(statement.sql)
        this.database.prepare(statement.sql).run(...statement.params)
      }
      if (options?.resultRevision !== undefined) {
        const sql = 'INSERT OR REPLACE INTO session_row_heads (session_id, revision, mutation_id) VALUES (?, ?, ?)'
        this.executed.push(sql)
        this.database.prepare(sql).run(options.sessionId, options.resultRevision, 'native')
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      return Promise.reject(error)
    }
    return Promise.resolve()
  }

  reset(): void {
    this.executed.length = 0
    this.batchCount = 0
  }

  close(): void {
    this.database.close()
  }
}

export function openNodeSessionRowDatabase(filename = ':memory:'): NodeSessionRowSqlDatabase {
  return new NodeSessionRowSqlDatabase(new nodeSQLite.DatabaseSync(filename))
}
