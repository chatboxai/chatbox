import { isRowsSessionRecord, type SessionRecordStorePort } from '../../ports/session-record-store'
import { SessionRowConflictError, type SessionRowCommit, type SessionRowStorePort } from '../../ports/session-row-store'
import { verifySessionTreeRoundTrip } from '../../session/session-tree/verify'
import { convertLegacyTreeToRowFormat, legacyActiveThreadId } from './compatibility/row-format'
import { migrateSession } from './compatibility/session-load'
import { SessionRowWriteQueue } from './SessionRowWriteQueue'
import type { SessionHeader } from '../../types'

type MigrationRows = Pick<SessionRowStorePort, 'getRevision' | 'writeRows' | 'readSnapshot'> & {
  readCommit(sessionId: string): Promise<SessionRowCommit | null>
}

export interface SessionRowMigrationResult extends SessionRowCommit {
  /** The authoritative commit succeeded; retry only the external record projection. */
  recordProjectionError?: unknown
}

export class SessionMigrationError extends Error {
  readonly name = 'SessionMigrationError'

  constructor(
    readonly sessionId: string,
    readonly stage: 'source' | 'validation' | 'publication',
    readonly cause: unknown
  ) {
    super(`Session ${sessionId} migration failed during ${stage}`, { cause })
  }
}

function nextRevision(sessionId: string, previous: number | null): number {
  if (previous === null) return 1
  if (!Number.isSafeInteger(previous) || previous < 1 || previous >= Number.MAX_SAFE_INTEGER) {
    throw new SessionMigrationError(sessionId, 'source', new Error('Invalid row revision'))
  }
  return previous + 1
}

/** Converts historical input once, before the session is exposed to row business operations. */
export class SessionRowMigration {
  constructor(
    private readonly records: SessionRecordStorePort,
    private readonly rows: MigrationRows,
    private readonly writes: SessionRowWriteQueue,
    private readonly now: () => number = Date.now
  ) {}

  ensureRows(
    sessionId: string,
    upgradeSettings?: SessionHeader['settings']
  ): Promise<SessionRowMigrationResult | null> {
    return this.writes.run(sessionId, () => this.migrate(sessionId, upgradeSettings))
  }

  private async migrate(
    sessionId: string,
    upgradeSettings?: SessionHeader['settings']
  ): Promise<SessionRowMigrationResult | null> {
    const committed = await this.rows.readCommit(sessionId)
    if (committed?.record.rowAuthority !== undefined && committed.record.rowAuthority !== 1) {
      throw new SessionMigrationError(sessionId, 'source', new Error('Unsupported row publication version'))
    }
    if (committed?.record.rowFormatVersion !== undefined && committed.record.rowFormatVersion !== 3)
      throw new SessionMigrationError(sessionId, 'source', new Error('Unsupported row format version'))
    if (committed?.record.rowAuthority === 1) {
      if (committed.record.rowFormatVersion === 3) return committed
      return this.upgradePublished(committed)
    }

    const expectedRevision = committed?.revision ?? (await this.rows.getRevision(sessionId))
    const source = await this.records.getRecord(sessionId)
    if (!source) {
      if (committed) {
        throw new SessionMigrationError(sessionId, 'source', new Error('Unpublished rows have no original input'))
      }
      return null
    }
    if (source.id !== sessionId) {
      throw new SessionMigrationError(sessionId, 'source', new Error('Record identity does not match'))
    }

    if (isRowsSessionRecord(source)) {
      if (!committed) {
        throw new SessionMigrationError(sessionId, 'source', new Error('Published session rows are missing'))
      }
      return this.upgradePublished(committed)
    }

    let verified: ReturnType<typeof verifySessionTreeRoundTrip>
    try {
      const input = upgradeSettings ? { ...source, settings: upgradeSettings } : source
      verified = verifySessionTreeRoundTrip(migrateSession(input), {
        activeThreadId: legacyActiveThreadId(source),
        now: this.now(),
      })
    } catch (error) {
      throw new SessionMigrationError(sessionId, 'validation', error)
    }
    if (!verified.ok) throw new SessionMigrationError(sessionId, 'validation', new Error(verified.reason))

    const converted = convertLegacyTreeToRowFormat(verified.tree, verified.session.messageForksHash)
    const candidate = {
      record: converted.session,
      revision: nextRevision(sessionId, expectedRevision),
      rows: { sessionId, threads: converted.threads, messages: converted.messages },
    }
    try {
      await this.rows.writeRows(candidate, expectedRevision)
    } catch (error) {
      return this.recoverPublication(sessionId, error)
    }
    return this.projectRecord(candidate)
  }

  private async upgradePublished(committed: SessionRowCommit): Promise<SessionRowMigrationResult> {
    const sessionId = committed.record.id
    const snapshot = await this.rows.readSnapshot(sessionId)
    if (!snapshot || snapshot.revision !== committed.revision)
      throw new SessionRowConflictError(sessionId, committed.revision, snapshot?.revision ?? null)
    let converted: ReturnType<typeof convertLegacyTreeToRowFormat>
    try {
      converted = convertLegacyTreeToRowFormat({ session: snapshot.record, ...snapshot.rows })
    } catch (error) {
      throw new SessionMigrationError(sessionId, 'validation', error)
    }
    const candidate = {
      record: converted.session,
      revision: nextRevision(sessionId, committed.revision),
      rows: { sessionId, threads: converted.threads, messages: converted.messages },
    }
    try {
      await this.rows.writeRows(candidate, committed.revision)
    } catch (error) {
      return this.recoverPublication(sessionId, error)
    }
    return this.projectRecord(candidate)
  }

  /** Safe to call from a bounded recovery job; never rereads legacy message bodies. */
  repairRecordProjection(sessionId: string): Promise<SessionRowMigrationResult | null> {
    return this.writes.run(sessionId, async () => {
      const committed = await this.rows.readCommit(sessionId)
      if (!committed || committed.record.rowAuthority !== 1) return null
      return this.projectRecord(committed)
    })
  }

  private async recoverPublication(sessionId: string, error: unknown): Promise<SessionRowMigrationResult> {
    const current = await this.rows.readCommit(sessionId)
    // The atomic write may have completed before its acknowledgement failed, or another opener may have won CAS.
    if (current?.record.rowAuthority === 1 && current.record.rowFormatVersion === 3) return this.projectRecord(current)
    if (error instanceof SessionRowConflictError) throw error
    throw new SessionMigrationError(sessionId, 'publication', error)
  }

  private async projectRecord(committed: SessionRowCommit): Promise<SessionRowMigrationResult> {
    try {
      await this.records.setRecord(committed.record)
      return { record: committed.record, revision: committed.revision }
    } catch (recordProjectionError) {
      return { record: committed.record, revision: committed.revision, recordProjectionError }
    }
  }
}
