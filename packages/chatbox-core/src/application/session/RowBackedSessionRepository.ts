import { findMessageLocation } from '@shared/session/message-forks'
import { validateSessionContextRequest } from '../../persistence/session-context-read'
import { assertSessionReadRevision, validateSessionMessagesRequest } from '../../persistence/session-message-selection'
import {
  assertSessionThreadPageRevision,
  validateSessionThreadPageRequest,
} from '../../persistence/session-thread-page'
import type { SessionContextRequest, SessionContextSource } from '../../ports/session-context-source'
import type { SessionMessageDerivedWriteResult, SessionMessagesSource } from '../../ports/session-message-source'
import type {
  SessionReadModel,
  SessionSearchThreadsPage,
  SessionSearchThreadsPageRequest,
} from '../../ports/session-read-model'
import {
  isRowsSessionRecord,
  type SessionRecordStorePort,
  type StoredSessionRecord,
} from '../../ports/session-record-store'
import {
  type SessionDataRepositoryPort,
  type SessionDataWriteOptions,
  type SessionMessageMutation,
  SessionRepositoryError,
  type SessionRepositoryOperation,
  SessionWriteConflictError,
} from '../../ports/session-repository'
import type {
  SessionMessagesRequest,
  SessionMessageWindow,
  SessionMessageWindowRequest,
} from '../../ports/session-row-store'
import {
  SessionRowConflictError,
  type SessionRowSnapshot,
  type SessionRowStorePort,
  type SessionRows,
  type SessionRowsDiff,
} from '../../ports/session-row-store'
import type {
  SessionTextTokenRead,
  SessionTextTokenResult,
  SessionTextTokenWriteResult,
} from '../../ports/session-text-tokens'
import {
  decodeSessionTree,
  deriveSessionRecord,
  diffSessionRows,
  type MessageRow,
  messageRowStatus,
  messageRowUpdatedAt,
  normalizeSessionV1,
  type SessionRecordV2,
  type SessionTree,
  verifySessionTreeRoundTrip,
  withCommittedTopology,
} from '../../session/session-tree'
import type { Session } from '../../types/session'
import {
  hasReleasedClientContent,
  mergeReleasedClientContent,
  releasedClientSession,
} from './compatibility/released-client-writes'
import { migrateSession } from './compatibility/session-load'
import { applySessionMessageDerivedPatch, type SessionMessageDerivedPatch } from './message-derived-data'
import { applySessionMessageMutation } from './message-mutation'
import { applyMessageUpdate } from './message-tree'
import {
  decodeLegacyRecord,
  type KnownRowState,
  type PersistedSessionState,
  type PersistedSessionVersion,
  SessionPersistenceProtocol,
} from './SessionPersistenceProtocol'
import { SessionNotFoundError } from './SessionWriteCoordinator'
import { isAppendBase, planSessionAppend } from './session-append'
import { contextRecordHeader, contextSourceFromRows, contextSourceFromSession } from './session-context-source'
import { applySessionDerivedPatches } from './session-derived-data'
import {
  overlaySessionTextTokens,
  overlayTextTokenMessages,
  restorePersistedTextTokens,
  restoreMessageTextTokens,
} from './session-text-tokens'

/** Most recently touched sessions whose last persisted rows stay in memory. */
const BASELINE_LIMIT = 32
const VERSION_TOKEN_LIMIT = BASELINE_LIMIT * 4

interface SessionBaseline {
  textTokens?: SessionTextTokenRead
  rows: SessionRows
  record: SessionRecordV2
  revision: number
  version: PersistedSessionVersion
  session: Session
  /** Set only after decoding persisted rows, including canonical V1 load normalization. */
  decoded: boolean
}

interface SessionWriteContext {
  state: PersistedSessionState
  baseline?: SessionBaseline
}

/**
 * True when both sessions carry the same threads, forks, compaction points and
 * thread name objects. Sessions are updated immutably, so identical references
 * mean nothing outside `messages` can have moved a row.
 */
function hasSameThreadStructure(previous: Session, next: Session): boolean {
  return (
    next.threads === previous.threads &&
    next.messageForksHash === previous.messageForksHash &&
    next.compactionPoints === previous.compactionPoints &&
    next.threadName === previous.threadName
  )
}

/**
 * Result of converting one stored session to rows: `already` for a session that
 * is row-backed, `skipped` for one whose encoding does not round-trip, and
 * `missing` for an id that has no record.
 */
export type SessionMigrationOutcome = 'migrated' | 'skipped' | 'already' | 'missing'

export interface RowBackedSessionRepositoryOptions {
  records: SessionRecordStorePort
  rows: SessionRowStorePort
  now?: () => number
  /** Convert the selected legacy record before exposing its first UI read model. */
  migrateLegacyBeforeRead?: boolean
  /** Hosts with interactive work-mode controls need the complete graph for those controls. */
  requiresCompleteWorkModeView?: boolean
  /**
   * Called when stored content cannot be converted: a V1 record that fails its
   * round-trip self-check keeps working in V1 form, and content an earlier
   * client wrote or left behind stays where it is.
   */
  onMigrationSkipped?: (sessionId: string, reason: string) => void
  /** Serializes one session across renderer contexts that share the same stores. */
  serializeSessionOperation?: <Result>(sessionId: string, action: () => Promise<Result>) => Promise<Result>
  /** Idempotently restores the list entry before publishing the record of an orphaned session. */
  onOrphanedRowsRestored?: (session: Session) => Promise<void>
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isEmptyDiff(diff: SessionRowsDiff): boolean {
  return (
    diff.threads.upsert.length === 0 &&
    diff.threads.delete.length === 0 &&
    diff.messages.upsert.length === 0 &&
    diff.messages.delete.length === 0
  )
}

/** True when encoding needs no repair of the session's messages, ids or threads. */
function isRowShaped(session: Session): boolean {
  const normalized = normalizeSessionV1(session)
  return normalized.ok && !normalized.reshaped
}

/** True when a write cannot have changed a single row of the baseline. */
function hasUnchangedRows(baseline: SessionBaseline, next: Session): boolean {
  return next.messages === baseline.session.messages && hasSameThreadStructure(baseline.session, next)
}

function findLastIndex<Item>(items: Item[], match: (item: Item) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (match(items[index])) {
      return index
    }
  }
  return -1
}

interface SingleMessageWrite {
  rows: SessionRows
  record: SessionRowSnapshot['record']
  diff: ReturnType<typeof diffSessionRows>
}

/**
 * The single row a `changedMessageId` write touches, or null when what the hint
 * promises cannot be confirmed without encoding. Every check is a reference or
 * scalar comparison, so a rejected hint costs nothing beyond the encode the
 * caller then has to do anyway. Every other message must carry the baseline's
 * id at the same position, so the written session keeps the baseline's row shape.
 */
function planSingleMessageWrite(
  baseline: SessionBaseline,
  next: Session,
  changedMessageId: string
): SingleMessageWrite | null {
  const previous = baseline.session
  if (!hasSameThreadStructure(previous, next) || next.messages.length !== previous.messages.length) {
    return null
  }

  // Streaming targets sit at the end of the active path, so the search starts there.
  const index = findLastIndex(next.messages, (message) => message.id === changedMessageId)
  if (index < 0 || previous.messages[index].id !== changedMessageId) {
    return null
  }
  // The hint vouches for the content of the other messages; the ids show they are the rows' messages.
  for (let position = 0; position < next.messages.length; position += 1) {
    if (next.messages[position].id !== previous.messages[position].id) {
      return null
    }
  }

  const rowIndex = findLastIndex(baseline.rows.messages, (row) => row.messageId === changedMessageId)
  if (rowIndex < 0) {
    return null
  }
  const baseRow = baseline.rows.messages[rowIndex]
  const message = next.messages[index]
  // An unchanged message object means the write carries a change somewhere the
  // constant-time checks above cannot see.
  if (baseRow.message === message || baseRow.threadId !== next.id) {
    return null
  }
  // A message that became or stopped being a summary moves the row kind and can
  // move compaction points and fork pivots with it.
  if ((baseRow.kind === 'summary') !== (message.isSummary === true)) {
    return null
  }

  const row: MessageRow = {
    ...baseRow,
    message,
    status: messageRowStatus(message),
    updatedAt: messageRowUpdatedAt(message, baseRow.createdAt),
  }
  const messages = [...baseline.rows.messages]
  messages[rowIndex] = row
  return {
    rows: { ...baseline.rows, messages },
    record: withCommittedTopology(
      deriveSessionRecord(next, next.id, {
        record: baseline.record,
        before: previous.messages[index],
        after: message,
      }),
      baseline.record
    ),
    diff: diffSessionRows(
      { ...baseline.rows, threads: [], messages: [baseRow] },
      { ...baseline.rows, threads: [], messages: [row] }
    ),
  }
}

function toSessionRows(tree: SessionTree): SessionRows {
  return { sessionId: tree.session.id, threads: tree.threads, messages: tree.messages }
}

function toKnownRowState(baseline: SessionBaseline): KnownRowState {
  return {
    snapshot: {
      rows: baseline.rows,
      record: baseline.record,
      revision: baseline.revision,
      textTokens: baseline.textTokens,
    },
    session: baseline.session,
    version: baseline.version,
  }
}

/**
 * Session data repository whose public value remains `Session` while the
 * persistence protocol owns format classification and cross-store lifecycle.
 * Callers must update sessions immutably so row-level fast paths can prove the
 * scope of a hinted change; concurrency itself is checked with a content
 * fingerprint plus the row-store revision.
 */
export class RowBackedSessionRepository implements SessionDataRepositoryPort {
  private readonly records: SessionRecordStorePort
  private readonly rows: SessionRowStorePort
  private readonly persistence: SessionPersistenceProtocol
  private readonly now: () => number
  private readonly migrateLegacyBeforeRead: boolean
  private readonly requiresCompleteWorkModeView: boolean
  private readonly onMigrationSkipped?: (sessionId: string, reason: string) => void
  private readonly serializeSessionOperation?: RowBackedSessionRepositoryOptions['serializeSessionOperation']
  private readonly onOrphanedRowsRestored?: RowBackedSessionRepositoryOptions['onOrphanedRowsRestored']
  private readonly baselines = new Map<string, SessionBaseline>()
  private readonly observedVersions = new Map<string, PersistedSessionVersion>()
  private readonly revisionsByFingerprint = new Map<string, number | null>()
  private readonly deferredFingerprints = new WeakSet<PersistedSessionVersion>()
  private readonly operationTails = new Map<string, Promise<void>>()
  private readonly readBatches = new Map<
    string,
    {
      record: Promise<StoredSessionRecord | null>
      pending: number
      finish: () => void
    }
  >()
  private initialization: Promise<void> | null = null

  constructor(options: RowBackedSessionRepositoryOptions) {
    this.records = options.records
    this.rows = options.rows
    this.persistence = new SessionPersistenceProtocol(options.records, options.rows)
    this.now = options.now ?? (() => Date.now())
    this.migrateLegacyBeforeRead = options.migrateLegacyBeforeRead ?? false
    this.requiresCompleteWorkModeView = options.requiresCompleteWorkModeView ?? true
    this.onMigrationSkipped = options.onMigrationSkipped
    this.serializeSessionOperation = options.serializeSessionOperation
    this.onOrphanedRowsRestored = options.onOrphanedRowsRestored
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.runInitialize().catch((error: unknown) => {
        this.initialization = null
        throw error
      })
    }
    return this.initialization
  }

  getSession(id: string): Promise<Session | null> {
    return this.enqueueSessionRead(id, (record) => this.getSessionNow(id, { record }))
  }

  getCompleteSessionSource(id: string) {
    return this.enqueueSessionRead(id, async (record) => {
      const read = await this.readSessionNow(id, { record })
      return read ? { session: read.session, textTokens: read.textTokens } : null
    })
  }

  acceptSessionTextTokenResults(
    sessionId: string,
    results: readonly SessionTextTokenResult[]
  ): Promise<SessionTextTokenWriteResult> {
    return this.enqueueSessionOperation(sessionId, async () => {
      if (!this.rows.acceptTextTokenResults) throw new Error('Source-bound text token results are unavailable')
      return {
        sessionId,
        results: await this.rows.acceptTextTokenResults(
          results.filter((result) => result.source.sessionId === sessionId)
        ),
      }
    })
  }

  getSessionContextSource(request: SessionContextRequest): Promise<SessionContextSource | null> {
    return this.enqueueSessionRead(request.sessionId, async (marker) => {
      validateSessionContextRequest(request)
      if (!marker) return null
      if (isRowsSessionRecord(marker)) {
        const baseline = this.baselines.get(request.sessionId)
        const context = await this.rows.readContext(request, baseline)
        if (!context) throw new Error(`session ${request.sessionId} is stored as rows but has none`)
        return contextSourceFromRows(context)
      }
      assertSessionReadRevision(request, null)
      const session = await this.getSessionNow(request.sessionId, { record: marker })
      return session ? contextSourceFromSession(session, request) : null
    })
  }

  getSessionReadModel(id: string): Promise<SessionReadModel | null> {
    return this.enqueueSessionOperation(id, async () => {
      let marker = await this.readRecord(id)
      if (!marker) {
        this.forgetSessionState(id)
        return null
      }
      if (this.migrateLegacyBeforeRead && !isRowsSessionRecord(marker)) {
        await this.migrateSessionNow(id, { record: marker })
        marker = await this.records.getRecord(id)
        if (!marker) return null
      }
      if (isRowsSessionRecord(marker)) {
        let window = await this.rows.readMessageWindow({ sessionId: id, limit: 50 })
        if (!window) throw new Error(`session ${id} is stored as rows but has none`)
        window = this.overlayWindow(window)
        const {
          presentation,
          storageFormat: _format,
          activeThreadId: _active,
          forkCreatedAt: _forks,
          contextReadProjection: _contextReadProjection,
          topologyFingerprint: _topologyFingerprint,
          ...header
        } = window.record
        // These consumers need the complete graph: archive/fork cards, paused
        // tool decisions, live off-path controls, and work-mode cache warnings.
        if (
          presentation &&
          presentation.hasThreads === false &&
          presentation.hasForks === false &&
          Number.isSafeInteger(presentation.messageCount) &&
          presentation.messageCount >= window.messages.length &&
          presentation.generatingMessageCount === 0 &&
          presentation.pausedMessageCount === 0 &&
          header.type !== 'picture' &&
          (!this.requiresCompleteWorkModeView ||
            header.settings?.agentMode?.value === 'off' ||
            header.settings?.agentMode?.value === 'auto')
        ) {
          return {
            kind: 'window',
            header: { ...header, threadName: window.thread.name ?? undefined },
            summary: presentation,
            window,
          }
        }
      }
      const read = await this.readSessionNow(id, { record: marker })
      return read ? { kind: 'full', session: read.session, textTokens: read.textTokens } : null
    })
  }

  readSessionMessages(request: SessionMessagesRequest): Promise<SessionMessagesSource | null> {
    return this.enqueueSessionOperation(request.sessionId, async () => {
      validateSessionMessagesRequest(request)
      const marker = await this.records.getRecord(request.sessionId)
      if (!marker) return null
      if (isRowsSessionRecord(marker)) {
        const snapshot = await this.rows.readMessages(request)
        if (!snapshot) throw new Error(`session ${request.sessionId} is stored as rows but has none`)
        return {
          header: contextRecordHeader(snapshot.record),
          revision: snapshot.revision,
          messages: overlayTextTokenMessages(
            snapshot.messages.map((row) => row.message),
            snapshot.textTokens
          ),
          textTokens: snapshot.textTokens,
        }
      }
      assertSessionReadRevision(request, null)
      const session = await this.getSessionNow(request.sessionId, { record: marker })
      if (!session) return null
      const {
        messages: _messages,
        threads: _threads,
        messageForksHash: _forks,
        compactionPoints: _points,
        ...header
      } = session
      return {
        header,
        revision: null,
        messages: [...new Set(request.messageIds)].flatMap((id) => {
          const location = findMessageLocation(session, id)
          return location ? [location.list[location.index]] : []
        }),
      }
    })
  }

  patchSessionMessageDerivedData(
    sessionId: string,
    patches: SessionMessageDerivedPatch[]
  ): Promise<SessionMessageDerivedWriteResult> {
    return this.enqueueSessionOperation(sessionId, async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const marker = await this.records.getRecord(sessionId)
          if (!marker) throw new SessionNotFoundError(sessionId)
          if (!isRowsSessionRecord(marker)) {
            // The exclusive session lock covers this read and the derived-only update.
            // A legacy record remains authoritative even when interrupted row data exists.
            const session = decodeLegacyRecord(marker)
            let updated = session
            const accepted: SessionMessageDerivedPatch[] = []
            for (const patch of patches) {
              const location = findMessageLocation(updated, patch.messageId)
              const result = location ? applySessionMessageDerivedPatch(location.list[location.index], patch) : null
              if (!result) continue
              updated = applyMessageUpdate(updated, sessionId, patch.messageId, result.message)
              accepted.push(result.patch)
            }
            if (accepted.length) {
              await this.run('set-session', sessionId, () => this.records.setRecord(updated))
              this.forgetSessionState(sessionId)
            }
            return { sessionId, previousRevision: null, revision: null, patches: accepted }
          }
          const snapshot = await this.rows.readMessages({
            sessionId,
            messageIds: patches.map((patch) => patch.messageId),
          })
          if (!snapshot) throw new SessionNotFoundError(sessionId)
          const current = new Map(snapshot.messages.map((row) => [row.messageId, row]))
          const changed = new Map<string, MessageRow>()
          const accepted: SessionMessageDerivedPatch[] = []
          for (const patch of patches) {
            const row = current.get(patch.messageId)
            const result = row ? applySessionMessageDerivedPatch(row.message, patch) : null
            if (!row || !result) continue
            const updated = { ...row, message: result.message }
            current.set(row.messageId, updated)
            changed.set(row.messageId, updated)
            accepted.push(result.patch)
          }
          if (!accepted.length)
            return { sessionId, previousRevision: snapshot.revision, revision: snapshot.revision, patches: [] }
          try {
            const commit = await this.persistence.commitSelectedMessages(
              sessionId,
              [...changed.values()],
              snapshot.record,
              snapshot.revision
            )
            const baseline = this.baselines.get(sessionId)
            if (baseline?.revision === snapshot.revision) {
              const session = applySessionDerivedPatches(baseline.session, accepted).session
              const version = this.rememberSnapshot(
                sessionId,
                {
                  ...commit,
                  rows: {
                    ...baseline.rows,
                    messages: baseline.rows.messages.map((row) => changed.get(row.messageId) ?? row),
                  },
                },
                session
              )
              this.rememberObservedVersion(sessionId, version)
              this.rememberVersion(version)
            } else {
              this.forgetSessionState(sessionId)
            }
            return { sessionId, previousRevision: snapshot.revision, revision: commit.revision, patches: accepted }
          } catch (error) {
            if (error instanceof SessionRowConflictError && attempt < 2) continue
            throw error
          }
        }
        throw new Error(`session ${sessionId} changed repeatedly during its derived write`)
      } catch (error) {
        this.forgetSessionState(sessionId)
        if (error instanceof SessionRowConflictError)
          throw new SessionWriteConflictError(sessionId, error.expectedRevision, error.actualRevision)
        throw error
      }
    })
  }

  async readSessionSearchThreadsPage(
    request: SessionSearchThreadsPageRequest
  ): Promise<SessionSearchThreadsPage | null> {
    validateSessionThreadPageRequest(request)
    let marker = await this.records.getRecord(request.sessionId)
    if (!marker) {
      assertSessionThreadPageRevision(request, null)
      return null
    }
    if (!isRowsSessionRecord(marker)) assertSessionThreadPageRevision(request, null)
    if (this.migrateLegacyBeforeRead && !isRowsSessionRecord(marker)) {
      await this.enqueueSessionOperation(request.sessionId, () => this.migrateSessionNow(request.sessionId))
      marker = await this.records.getRecord(request.sessionId)
      if (!marker) return null
    }
    if (isRowsSessionRecord(marker) && this.rows.readThreadsPage) {
      const page = await this.rows.readThreadsPage(request)
      if (!page) throw new Error(`session ${request.sessionId} is stored as rows but has none`)
      return {
        kind: 'rows',
        header: contextRecordHeader(page.record),
        revision: page.revision,
        threadIds: page.threadIds,
        nextCursor: page.nextCursor,
      }
    }
    assertSessionThreadPageRevision(request, null)
    const session = await this.getSession(request.sessionId)
    return session ? { kind: 'full', session } : null
  }

  async readSessionMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null> {
    // Read-only windows use the row store's atomic snapshot/revision fence and
    // must not queue behind full-context hydration. They never update a write baseline.
    const marker = await this.records.getRecord(request.sessionId)
    if (!marker) return null
    if (!isRowsSessionRecord(marker))
      throw new SessionRowConflictError(
        request.sessionId,
        request.expectedRevision ?? request.cursor?.revision ?? null,
        null
      )
    const window = await this.rows.readMessageWindow(request)
    return window ? this.overlayWindow(window) : null
  }

  private async getSessionNow(
    id: string,
    observedRecord?: { record: StoredSessionRecord | null }
  ): Promise<Session | null> {
    return (await this.readSessionNow(id, observedRecord))?.session ?? null
  }

  /** Reads a session together with the token results overlaid on it; concurrent reads never share them. */
  private async readSessionNow(
    id: string,
    observedRecord?: { record: StoredSessionRecord | null }
  ): Promise<{ session: Session; textTokens?: SessionTextTokenRead } | null> {
    observedRecord ??= { record: await this.readRecord(id) }
    const baseline = this.baselines.get(id)
    const state = await this.inspectPersistedState(
      'get-session',
      id,
      baseline?.decoded ? baseline : null,
      observedRecord
    )
    if (state.kind === 'missing') {
      this.forgetSessionState(id)
      return null
    }
    this.rememberObservedVersion(id, state.version)
    this.rememberVersion(state.version)
    if (state.kind === 'rows') {
      this.rememberRowsState(id, state)
      const read = state.snapshot.textTokens
      if (read && this.rows.readTextTokenResults) {
        const textTokens =
          baseline?.decoded && baseline.revision === state.snapshot.revision
            ? { ...read, results: await this.rows.readTextTokenResults(Object.values(read.sources)) }
            : read
        const remembered = this.baselines.get(id)
        if (remembered) remembered.textTokens = textTokens
        return { session: overlaySessionTextTokens(state.session, textTokens), textTokens }
      }
      return { session: state.session, textTokens: read }
    }
    return { session: state.session }
  }

  setSession(session: Session, options: SessionDataWriteOptions = {}): Promise<void> {
    return this.enqueueSessionOperation(session.id, () => this.setSessionNow(session, options))
  }

  mutateSessionMessages(base: Session, mutation: SessionMessageMutation): Promise<void> {
    return this.enqueueSessionOperation(base.id, async () => {
      const cached = this.baselines.get(base.id)
      const acceptsTokens = Boolean(this.rows.acceptTextTokenResults)
      if (cached && isAppendBase(cached.session, base, acceptsTokens)) {
        let persistedMutation = mutation
        if (acceptsTokens && mutation.type === 'replace') {
          const location = findMessageLocation(cached.session, mutation.messageId)
          if (location) {
            const original = location.list[location.index]
            const message = restoreMessageTextTokens(mutation.message, original)
            persistedMutation = {
              ...mutation,
              message: {
                ...message,
                tokenCountMap: message.tokenCountMap,
                tokenCalculatedAt: message.tokenCalculatedAt,
                tokenCountApproximate: message.tokenCountApproximate,
              },
            }
          }
        }
        const next = applySessionMessageMutation(cached.session, persistedMutation)
        await this.setSessionNow(
          next,
          {
            baseSession: cached.session,
            changedMessageId: mutation.type === 'replace' ? mutation.messageId : undefined,
          },
          true
        )
      } else {
        await this.setSessionNow(applySessionMessageMutation(base, mutation), {
          baseSession: base,
          changedMessageId: mutation.type === 'replace' ? mutation.messageId : undefined,
        })
      }
    })
  }

  private async setSessionNow(
    session: Session,
    options: SessionDataWriteOptions,
    persistedTokens = false
  ): Promise<void> {
    try {
      const version = await this.persistSession(session, options, persistedTokens)
      this.rememberObservedVersion(session.id, version)
      this.rememberVersion(version)
    } catch (error) {
      this.forgetSessionState(session.id)
      throw error
    }
  }

  private async persistSession(
    session: Session,
    options: SessionDataWriteOptions,
    persistedTokens: boolean
  ): Promise<PersistedSessionVersion> {
    const id = session.id
    const cached = this.baselines.get(id)
    if (
      cached &&
      (session.messages.length > cached.session.messages.length || options.changedMessageId) &&
      options.baseSession &&
      isAppendBase(cached.session, options.baseSession, Boolean(this.rows.acceptTextTokenResults))
    ) {
      const candidate =
        !persistedTokens && this.rows.acceptTextTokenResults
          ? restorePersistedTextTokens(session, cached.session)
          : session
      const single = options.changedMessageId
        ? planSingleMessageWrite(cached, candidate, options.changedMessageId)
        : null
      const plannedWrite = single ?? planSessionAppend(cached.session, candidate, cached.rows)
      if (plannedWrite) {
        const marker = await this.records.getRecord(id)
        if (
          marker &&
          isRowsSessionRecord(marker) &&
          !hasReleasedClientContent(marker) &&
          (await this.rows.getRevision(id)) === cached.revision
        ) {
          const snapshot = await this.commitDiff(
            id,
            plannedWrite.diff,
            withCommittedTopology(plannedWrite.record, cached.record),
            cached.revision,
            plannedWrite.rows
          )
          return this.rememberSnapshot(id, snapshot, candidate, true)
        }
      }
    }
    const context = await this.resolveWriteContext(id, options)
    const baseline = context.baseline
    if (baseline && !persistedTokens && this.rows.acceptTextTokenResults)
      session = restorePersistedTextTokens(session, baseline.session)
    if (baseline && hasUnchangedRows(baseline, session)) {
      return await this.completeWrite(id, session, baseline)
    }
    if (baseline && options.changedMessageId) {
      const planned = planSingleMessageWrite(baseline, session, options.changedMessageId)
      if (planned) {
        const snapshot = await this.commitDiff(id, planned.diff, planned.record, baseline.revision, planned.rows)
        return this.rememberSnapshot(id, snapshot, session)
      }
    }

    const encoded = verifySessionTreeRoundTrip(session, {
      activeThreadId: id,
      now: this.now(),
      previousMessages: baseline?.rows.messages,
    })
    if (!encoded.ok) {
      return await this.writeUnmigratedSession(context.state, session, encoded.reason)
    }
    // Row fast paths plan from the baseline session, so it must describe the rows just written.
    // A write that repairs changed keeps the repaired session; otherwise the caller's object keeps its
    // identity. Forks that normalization drops have no rows, and fast paths take fork facts from the record.
    const stored = encoded.reshaped ? encoded.session : session

    const nextRows = toSessionRows(encoded.tree)
    if (baseline) {
      const diff = diffSessionRows(baseline.rows, nextRows)
      const fingerprint = this.fingerprint(stored)
      if (isEmptyDiff(diff) && fingerprint === baseline.version.fingerprint) {
        return this.rememberBaseline(id, {
          ...baseline,
          session: stored,
          decoded: false,
          version: { ...baseline.version, fingerprint },
        })
      }
      const snapshot = await this.commitDiff(id, diff, encoded.tree.session, baseline.revision, nextRows)
      return this.rememberSnapshot(id, snapshot, stored)
    }

    const result = await this.run('set-session', id, () =>
      this.persistence.promote(context.state, stored, nextRows, encoded.tree.session)
    )
    if (result.kind === 'anchored') {
      this.onMigrationSkipped?.(id, 'row-backed publish failed; kept the complete V1 session record')
      return { fingerprint: this.fingerprint(session), revision: null }
    }
    return this.rememberSnapshot(id, result.snapshot, stored)
  }

  deleteSession(id: string): Promise<void> {
    return this.enqueueSessionOperation(id, () => this.deleteSessionNow(id))
  }

  private async deleteSessionNow(id: string): Promise<void> {
    const cached = this.baselines.get(id)
    const expectedVersion = cached?.version ?? this.observedVersions.get(id)
    const state = await this.run('delete-session', id, () => this.persistence.inspectDeletionState(id))
    let matchesExpectedVersion = true
    if (expectedVersion) {
      if (state.record && isRowsSessionRecord(state.record) && expectedVersion.revision !== null) {
        matchesExpectedVersion = state.revision === expectedVersion.revision
      } else {
        const content = await this.inspectPersistedState('delete-session', id, cached)
        const actualVersion = content.kind === 'missing' ? null : content.version
        matchesExpectedVersion =
          actualVersion !== null &&
          actualVersion.fingerprint === expectedVersion.fingerprint &&
          (expectedVersion.revision === null || actualVersion.revision === expectedVersion.revision)
      }
    }
    if (!matchesExpectedVersion) {
      this.forgetSessionState(id)
      throw new SessionWriteConflictError(id, expectedVersion?.revision ?? null, state.revision)
    }
    try {
      await this.persistence.delete(id, state)
    } catch (error) {
      if (error instanceof SessionRowConflictError) {
        throw new SessionWriteConflictError(id, error.expectedRevision, error.actualRevision)
      }
      throw new SessionRepositoryError('delete-session', error, id)
    } finally {
      this.forgetSessionState(id)
    }
  }

  getAllSessionIds(): Promise<string[]> {
    return this.run('list-session-ids', undefined, () => this.records.listIds())
  }

  /**
   * Ids whose authoritative record is still V1, or whose row marker holds
   * content an earlier client wrote, ordered so passes are reproducible.
   */
  async listUnmigratedSessionIds(shouldSkip?: (id: string) => Promise<boolean>): Promise<string[]> {
    const ids = await this.run('list-session-ids', undefined, () => this.records.listIds())
    const unmigrated: string[] = []
    for (const id of ids) {
      if (await shouldSkip?.(id)) continue
      const record = await this.run('list-session-ids', id, () => this.records.getRecord(id))
      if (record && (!isRowsSessionRecord(record) || hasReleasedClientContent(record))) unmigrated.push(id)
    }
    return unmigrated.sort()
  }

  migrateSession(id: string): Promise<SessionMigrationOutcome> {
    return this.enqueueSessionOperation(id, () => this.migrateSessionNow(id))
  }

  private async migrateSessionNow(
    id: string,
    observedRecord?: { record: StoredSessionRecord | null }
  ): Promise<SessionMigrationOutcome> {
    const record = observedRecord ? observedRecord.record : await this.records.getRecord(id)
    if (record && isRowsSessionRecord(record) && hasReleasedClientContent(record)) {
      return (await this.absorbReleasedClientContent(id, record)) ? 'migrated' : 'skipped'
    }
    const state = await this.inspectPersistedState('get-session', id, null, { record })
    if (state.kind === 'missing') return 'missing'
    if (state.kind === 'rows') return 'already'
    const migrated = await this.writeMigratedSession(id, state, state.session)
    return migrated ? 'migrated' : 'skipped'
  }

  /** Must be called after a session's rows or record are written past this repository. */
  forgetBaseline(id: string): void {
    this.forgetSessionState(id)
  }

  forgetAllBaselines(): void {
    this.baselines.clear()
    this.observedVersions.clear()
  }

  private async completeWrite(
    id: string,
    session: Session,
    baseline: SessionBaseline
  ): Promise<PersistedSessionVersion> {
    const fingerprint = this.fingerprint(session)
    if (fingerprint === baseline.version.fingerprint) {
      return this.rememberBaseline(id, { ...baseline, session, decoded: false })
    }
    const record = withCommittedTopology(deriveSessionRecord(session, baseline.record.activeThreadId), baseline.record)
    record.contextReadProjection = baseline.record.contextReadProjection
    record.topologyFingerprint = baseline.record.topologyFingerprint
    const diff = diffSessionRows(baseline.rows, baseline.rows)
    const snapshot = await this.commitDiff(id, diff, record, baseline.revision, baseline.rows)
    return this.rememberSnapshot(id, snapshot, session)
  }

  private async runInitialize(): Promise<void> {
    await this.run('initialize', undefined, async () => {
      await this.records.initialize()
      await this.rows.initialize()
      await this.persistence.recoverOrphanedRows(
        (id, action) => this.enqueueSessionOperation(id, action),
        this.onOrphanedRowsRestored,
        (id, error) => this.onMigrationSkipped?.(id, `rows without a record were kept: ${describeError(error)}`)
      )
    })
  }

  /** Reads a session record after folding in any content an earlier client wrote into its row marker. */
  private async readRecord(id: string): Promise<StoredSessionRecord | null> {
    const record = await this.records.getRecord(id)
    if (!record || !isRowsSessionRecord(record) || !hasReleasedClientContent(record)) return record
    return (await this.absorbReleasedClientContent(id, record)) ?? record
  }

  /**
   * Moves content a client that predates row storage wrote into a row marker
   * into the rows, then republishes a clean marker. Runs inside the session's
   * operation queue. Returns null when the content could not be merged; it then
   * stays on the marker, which no row write replaces.
   */
  private async absorbReleasedClientContent(id: string, marker: SessionRecordV2): Promise<SessionRecordV2 | null> {
    this.forgetSessionState(id)
    try {
      const state = await this.inspectPersistedState('get-session', id, null, { record: marker })
      if (state.kind !== 'rows') return null
      const merged = mergeReleasedClientContent(state.session, migrateSession(releasedClientSession(marker)))
      let clean = state.snapshot.record
      if (merged) {
        const encoded = verifySessionTreeRoundTrip(merged, {
          activeThreadId: id,
          now: this.now(),
          previousMessages: state.snapshot.rows.messages,
        })
        if (!encoded.ok) {
          this.onMigrationSkipped?.(id, `content written by an earlier version was kept: ${encoded.reason}`)
          return null
        }
        const nextRows = toSessionRows(encoded.tree)
        const committed = await this.persistence.commit(
          id,
          diffSessionRows(state.snapshot.rows, nextRows),
          encoded.tree.session,
          state.snapshot.revision,
          nextRows
        )
        clean = committed.record
      }
      await this.records.setRecord(clean)
      return clean
    } catch (error) {
      this.onMigrationSkipped?.(id, `content written by an earlier version was kept: ${describeError(error)}`)
      return null
    } finally {
      this.forgetSessionState(id)
    }
  }

  private async run<Result>(
    operation: SessionRepositoryOperation,
    sessionId: string | undefined,
    action: () => Promise<Result>
  ): Promise<Result> {
    try {
      return await action()
    } catch (error) {
      if (error instanceof SessionRepositoryError) throw error
      throw new SessionRepositoryError(operation, error, sessionId)
    }
  }

  /** Keeps background migration, foreground writes and deletes ordered per id. */
  private enqueueSessionOperation<Result>(id: string, action: () => Promise<Result>): Promise<Result> {
    // A new exclusive operation closes the current read batch to later readers.
    this.readBatches.delete(id)
    const previous = this.operationTails.get(id) ?? Promise.resolve()
    const result = previous
      .catch(() => undefined)
      .then(() => (this.serializeSessionOperation ? this.serializeSessionOperation(id, action) : action()))
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.operationTails.set(id, tail)
    void tail.then(() => {
      if (this.operationTails.get(id) === tail) this.operationTails.delete(id)
    })
    return result
  }

  /** Concurrent reads share one storage lock; writes remain barriers on both sides. */
  private enqueueSessionRead<Result>(
    id: string,
    action: (record: StoredSessionRecord | null) => Promise<Result>
  ): Promise<Result> {
    let batch = this.readBatches.get(id)
    if (!batch) {
      let resolveRecord!: (record: StoredSessionRecord | null) => void
      let rejectRecord!: (error: unknown) => void
      let finish!: () => void
      const record = new Promise<StoredSessionRecord | null>((resolve, reject) => {
        resolveRecord = resolve
        rejectRecord = reject
      })
      const finished = new Promise<void>((resolve) => {
        finish = resolve
      })
      batch = { record, pending: 0, finish }
      // Record normalization can write legacy content back. Complete it before
      // exposing the record to readers, while holding the cross-context lock.
      void this.enqueueSessionOperation(id, async () => {
        resolveRecord(await this.readRecord(id))
        await finished
      }).catch(rejectRecord)
      this.readBatches.set(id, batch)
    }
    const current = batch
    current.pending += 1
    return current.record.then(action).finally(() => {
      current.pending -= 1
      if (current.pending === 0) {
        if (this.readBatches.get(id) === current) this.readBatches.delete(id)
        current.finish()
      }
    })
  }

  /** Stores a V1 session through the same promotion/recovery protocol used by foreground writes. */
  private async writeMigratedSession(
    id: string,
    state: Extract<PersistedSessionState, { kind: 'legacy' | 'interrupted-promotion' }>,
    session: Session
  ): Promise<boolean> {
    const verified = verifySessionTreeRoundTrip(session, { activeThreadId: session.id, now: this.now() })
    if (!verified.ok) {
      this.onMigrationSkipped?.(id, verified.reason)
      return false
    }
    const result = await this.run('get-session', id, () =>
      this.persistence.promote(state, session, toSessionRows(verified.tree), verified.tree.session)
    )
    if (result.kind === 'anchored') {
      this.onMigrationSkipped?.(id, 'row-backed publish failed; kept the complete V1 session record')
      return false
    }
    return true
  }

  private async resolveWriteContext(id: string, options: SessionDataWriteOptions): Promise<SessionWriteContext> {
    const cached = this.baselines.get(id)
    const state = await this.inspectPersistedState('set-session', id, cached)
    const baseFingerprint = options.baseSession
      ? cached?.session === options.baseSession
        ? cached.version.fingerprint
        : this.fingerprint(options.baseSession)
      : undefined
    const expectedRevision = baseFingerprint
      ? (this.revisionsByFingerprint.get(baseFingerprint) ??
        (cached?.version.fingerprint === baseFingerprint ? cached.revision : null))
      : (cached?.revision ?? null)

    if (state.kind === 'missing') {
      if (cached || options.baseSession) {
        this.baselines.delete(id)
        throw new SessionWriteConflictError(id, expectedRevision, state.revision)
      }
      return { state }
    }

    if (state.kind === 'legacy' || state.kind === 'interrupted-promotion') {
      if (options.baseSession && baseFingerprint !== state.version.fingerprint) {
        this.baselines.delete(id)
        throw new SessionWriteConflictError(id, expectedRevision, state.revision)
      }
      if (cached && !options.baseSession) {
        this.baselines.delete(id)
        throw new SessionWriteConflictError(id, cached.revision, state.revision)
      }
      return { state }
    }

    if (options.baseSession && baseFingerprint !== state.version.fingerprint) {
      this.baselines.delete(id)
      throw new SessionWriteConflictError(id, expectedRevision, state.version.revision)
    }
    if (cached && cached.revision !== state.snapshot.revision) {
      this.baselines.delete(id)
      throw new SessionWriteConflictError(id, cached.revision, state.snapshot.revision)
    }
    if (!cached && !options.baseSession) {
      throw new SessionWriteConflictError(id, null, state.snapshot.revision)
    }
    if (cached) return { state, baseline: cached }
    // Row fast paths plan from the baseline session, so the caller's snapshot serves only when repairs
    // would leave its messages, ids and threads as they are.
    const callerBase =
      options.baseSession && !this.rows.acceptTextTokenResults && isRowShaped(options.baseSession)
        ? options.baseSession
        : undefined
    return {
      state,
      baseline: {
        rows: state.snapshot.rows,
        record: state.snapshot.record,
        revision: state.snapshot.revision,
        version: state.version,
        session: callerBase ?? state.session,
        decoded: !callerBase,
      },
    }
  }

  private async commitDiff(
    id: string,
    diff: SessionRowsDiff,
    record: SessionRecordV2,
    expectedRevision: number,
    rows: SessionRows
  ): Promise<SessionRowSnapshot> {
    try {
      return await this.persistence.commit(id, diff, record, expectedRevision, rows)
    } catch (error) {
      if (error instanceof SessionRowConflictError) {
        throw new SessionWriteConflictError(id, error.expectedRevision, error.actualRevision)
      }
      throw new SessionRepositoryError('set-session', error, id)
    }
  }

  private async writeUnmigratedSession(
    state: PersistedSessionState,
    session: Session,
    reason: string
  ): Promise<PersistedSessionVersion> {
    if (state.kind === 'rows') {
      throw new SessionRepositoryError('set-session', new Error(reason), session.id)
    }
    this.onMigrationSkipped?.(session.id, reason)
    await this.run('set-session', session.id, () => this.records.setRecord(session))
    return {
      fingerprint: this.fingerprint(session),
      revision: null,
    }
  }

  private inspectPersistedState(
    operation: 'get-session' | 'set-session' | 'delete-session',
    id: string,
    baseline: SessionBaseline | null = this.baselines.get(id) ?? null,
    observedRecord?: { record: StoredSessionRecord | null }
  ): Promise<PersistedSessionState> {
    return this.run(operation, id, () =>
      this.persistence.inspectPersistedState(id, baseline ? toKnownRowState(baseline) : undefined, observedRecord)
    )
  }

  private rememberRowsState(id: string, state: Extract<PersistedSessionState, { kind: 'rows' }>): void {
    this.rememberBaseline(id, {
      rows: state.snapshot.rows,
      textTokens: state.snapshot.textTokens,
      record: state.snapshot.record,
      revision: state.snapshot.revision,
      version: state.version,
      session: state.session,
      decoded: true,
    })
  }

  private rememberSnapshot(
    id: string,
    snapshot: SessionRowSnapshot,
    session: Session,
    deferFingerprint = false
  ): PersistedSessionVersion {
    let fingerprint: string | undefined
    const version: PersistedSessionVersion = deferFingerprint
      ? {
          revision: snapshot.revision,
          get fingerprint() {
            if (fingerprint === undefined) fingerprint = materialize()
            return fingerprint
          },
        }
      : { fingerprint: this.fingerprint(session), revision: snapshot.revision }
    const materialize = () => {
      fingerprint = this.fingerprint(session)
      this.deferredFingerprints.delete(version)
      this.rememberVersion(version)
      return fingerprint
    }
    if (deferFingerprint) this.deferredFingerprints.add(version)
    return this.rememberBaseline(id, {
      rows: snapshot.rows,
      record: snapshot.record,
      revision: snapshot.revision,
      version,
      session,
      decoded: false,
    })
  }

  private rememberBaseline(id: string, baseline: SessionBaseline): PersistedSessionVersion {
    this.baselines.delete(id)
    this.baselines.set(id, baseline)
    while (this.baselines.size > BASELINE_LIMIT) {
      const oldest = this.baselines.keys().next()
      if (oldest.done) break
      this.baselines.delete(oldest.value)
    }
    return baseline.version
  }

  private fingerprint(session: Session): string {
    return this.persistence.fingerprint(session)
  }

  private overlayWindow(window: SessionMessageWindow): SessionMessageWindow {
    const messages = overlayTextTokenMessages(
      window.messages.map((row) => row.message),
      window.textTokens
    )
    return {
      ...window,
      messages: window.messages.map((row, index) =>
        messages[index] === row.message ? row : { ...row, message: messages[index] }
      ),
    }
  }

  private rememberObservedVersion(id: string, version: PersistedSessionVersion): void {
    this.observedVersions.set(id, version)
  }

  private forgetSessionState(id: string): void {
    this.baselines.delete(id)
    this.observedVersions.delete(id)
  }

  private rememberVersion(version: PersistedSessionVersion): void {
    // Identity and row revision prove a tail append. Materialize its content
    // fingerprint only when a later operation needs a content comparison.
    if (this.deferredFingerprints.has(version)) return
    this.revisionsByFingerprint.delete(version.fingerprint)
    this.revisionsByFingerprint.set(version.fingerprint, version.revision)
    while (this.revisionsByFingerprint.size > VERSION_TOKEN_LIMIT) {
      const oldest = this.revisionsByFingerprint.keys().next()
      if (oldest.done) return
      this.revisionsByFingerprint.delete(oldest.value)
    }
  }
}
