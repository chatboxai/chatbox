import { v5 as uuidv5 } from 'uuid'
import type { SessionArtifactRequest } from '../../ports/session-artifact-source'
import type { SessionAttachmentFactsRequest } from '../../ports/session-attachment-source'
import type {
  SessionBranchMessagesRequest,
  SessionBranchPreviewRequest,
  SessionBranchStorePort,
} from '../../ports/session-branch-source'
import type { SessionContextRequest, SessionContextSource } from '../../ports/session-context-source'
import type { SessionMessageDerivedWriteResult, SessionMessagesSource } from '../../ports/session-message-source'
import type { SessionRecordStorePort } from '../../ports/session-record-store'
import {
  type SessionCommand,
  type SessionCommandDelta,
  SessionWriteConflictError,
} from '../../ports/session-repository'
import type {
  SessionKnownMessageMetadata,
  SessionMessageRelationsCursor,
  SessionMessageRelationsSelector,
  SessionRowRelationsPort,
} from '../../ports/session-row-relations'
import type {
  SessionConversationStateRequest,
  SessionCopyRequest,
  SessionForkOptionsPage,
  SessionForkOptionsRequest,
  SessionHeaderRead,
  SessionRowRepositoryPort,
  SessionThreadCopyRequest,
  SessionThreadSummariesPage,
} from '../../ports/session-row-repository'
import {
  type SessionMessagesRequest,
  type SessionRowCommit,
  SessionRowConflictError,
  type SessionRowStorePort,
  type SessionThreadPageRequest,
} from '../../ports/session-row-store'
import type { SessionSearchCandidatesRequest, SessionSearchWindowRequest } from '../../ports/session-search-source'
import type { CurrentThreadIdentity } from '../../ports/session-structure-command'
import type { SessionTextTokenResult, SessionTextTokenWriteResult } from '../../ports/session-text-tokens'
import type { SessionTokenCacheResult } from '../../ports/session-token-cache'
import type { SessionTokenPageRequest, SessionTokenPlanRequest } from '../../ports/session-token-source'
import type { SessionThreadRequest, SessionTranscriptRequest } from '../../ports/session-transcript-source'
import { iterateRowResourceReferences } from '../../resources/row-resources'
import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from '../../session/message-facts'
import type { MessageRow, SessionRecordV2, SessionRowRecord, ThreadRow } from '../../session/session-tree/types'
import { type Message, type SessionHeader, SessionHeaderSchema } from '../../types/session'
import { throwIfAborted } from '../../utils/abort'
import { applySessionMessageDerivedPatch, type SessionMessageDerivedPatch } from './message-derived-data'
import { iterateRowArtifactMarkdown } from './row-artifact'
import { iterateRowAttachmentFacts } from './row-attachments'
import { createRowTokenPlan, readRowContextSource, readRowTokenPage } from './row-context'
import { readRowConversationState } from './row-conversation-state'
import { readRowPromptCacheDecision } from './row-prompt-cache'
import { readRowSearchWindow, selectedSearchCandidates } from './row-search'
import { SessionRowMigration } from './SessionRowMigration'
import type { SessionRowWriteQueue } from './SessionRowWriteQueue'
import { SessionNotFoundError } from './SessionWriteCoordinator'
import { planBackgroundFollowUp } from './session-background-command'
import { emptySessionCommandPlan, planSessionCommand, type SessionCommandPlan } from './session-command'
import { planCompactionStructure } from './session-compaction-command'
import { prepareSessionCopyShape } from './session-copy-shape'
import { planForkStructure } from './session-fork-command'
import { deriveSessionGenerationControl } from './session-generation-control'
import { planGenerationSegmentSplit } from './session-generation-segment-command'
import { planMessageStructure } from './session-message-structure'
import { sessionRowHeader } from './session-row-header'
import {
  newMessageRow,
  readBranchPoint,
  readMetadata,
  type StructureCommandReader,
  type StructurePlan,
} from './session-structure-plan'
import { currentThreadIdentity, planThreadStructure } from './session-thread-command'
import { copyThreadMetadata, stageSessionCopy } from './session-thread-copy'

export interface RowBackedSessionRepositoryOptions {
  records: SessionRecordStorePort
  rows: SessionRowStorePort & SessionRowRelationsPort & SessionBranchStorePort
  writes: SessionRowWriteQueue
  now?: () => number
  onRecordProjectionError?: (sessionId: string, error: unknown) => void
}

function requireRowRecord(record: SessionRecordV2): SessionRowRecord {
  if (record.storageFormat !== 'rows' || record.rowFormatVersion !== 3 || record.rowAuthority !== 1)
    throw new Error('Session row format is unavailable')
  return record as SessionRowRecord
}

function incrementRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
    throw new Error('Session revision exhausted')
  return revision + 1
}

function hasChanges(plan: SessionCommandPlan, previous: SessionRowRecord): boolean {
  const diff = plan.diff
  return (
    plan.record !== previous ||
    diff.threads.upsert.length > 0 ||
    diff.threads.delete.length > 0 ||
    diff.messages.upsert.length > 0 ||
    diff.messages.delete.length > 0 ||
    Boolean(diff.messageMetadataUpsert?.length) ||
    Boolean(
      diff.siblingShifts?.length ||
        diff.reparentChildren?.length ||
        diff.replaceMessagePivots?.length ||
        diff.deleteSubtrees?.length ||
        diff.deleteThreadMessages?.length ||
        diff.deleteSessionMessages ||
        diff.deleteArchivedThreads ||
        diff.expandForks?.length
    )
  )
}

/** The write queue owns every mutation, projection repair, and deletion of a session. */
export class RowBackedSessionRepository implements SessionRowRepositoryPort {
  private readonly records: SessionRecordStorePort
  private readonly rows: SessionRowStorePort & SessionRowRelationsPort & SessionBranchStorePort
  private readonly writes: SessionRowWriteQueue
  private readonly migration: SessionRowMigration
  private readonly onRecordProjectionError?: RowBackedSessionRepositoryOptions['onRecordProjectionError']
  private initialization?: Promise<void>

  constructor(options: RowBackedSessionRepositoryOptions) {
    this.records = options.records
    this.rows = options.rows
    this.writes = options.writes
    this.onRecordProjectionError = options.onRecordProjectionError
    this.migration = new SessionRowMigration(this.records, this.rows, this.writes, options.now)
  }

  initialize(): Promise<void> {
    this.initialization ??= Promise.all([this.records.initialize(), this.rows.initialize()])
      .then(() => undefined)
      .catch((error: unknown) => {
        this.initialization = undefined
        throw error
      })
    return this.initialization
  }

  private async ensureRows(
    sessionId: string,
    upgradeSettings?: SessionHeader['settings']
  ): Promise<SessionRowCommit | null> {
    await this.initialize()
    const result = await this.migration.ensureRows(sessionId, upgradeSettings)
    if (result) {
      requireRowRecord(result.record)
      if (result.recordProjectionError !== undefined)
        this.reportProjectionError(sessionId, result.recordProjectionError)
    }
    return result
  }

  /** Publish normalized legacy settings with the initial row candidate, preserving retryable source data. */
  async upgradeLegacySessionSettings(
    sessionId: string,
    settings: NonNullable<SessionHeader['settings']>
  ): Promise<void> {
    const commit = await this.ensureRows(sessionId, settings)
    if (!commit || commit.record.settings?.provider) return
    await this.executeSessionCommand(sessionId, {
      type: 'header',
      updater: (header) => {
        if (!header) throw new SessionNotFoundError(sessionId)
        return header.settings?.provider ? header : { ...header, settings }
      },
    })
  }

  private async readHeader(commit: SessionRowCommit): Promise<SessionHeaderRead> {
    const record = requireRowRecord(commit.record)
    const state = await this.rows.readThreadState({
      sessionId: record.id,
      threadId: record.activeThreadId,
      expectedRevision: commit.revision,
    })
    if (!state || state.status !== 'ready' || !state.thread.summary || !state.thread.control)
      throw new Error('Active thread projection is unavailable')
    return {
      header: { ...sessionRowHeader(record), threadName: state.thread.name ?? undefined },
      revision: commit.revision,
      activeThreadId: record.activeThreadId,
      summary: state.thread.summary,
      control: state.thread.control,
    }
  }

  async getSessionHeader(sessionId: string): Promise<SessionHeaderRead | null> {
    const commit = await this.ensureRows(sessionId)
    return commit ? this.readHeader(commit) : null
  }

  async projectSessionMetadata<T>(sessionId: string, project: () => Promise<T>): Promise<T> {
    await this.initialize()
    return this.writes.run(sessionId, project)
  }

  async repairSessionRecordProjection(sessionId: string): Promise<void> {
    await this.initialize()
    const result = await this.migration.repairRecordProjection(sessionId)
    if (result?.recordProjectionError !== undefined) throw result.recordProjectionError
  }

  async projectLatestSession<T>(
    sessionId: string,
    project: (current: SessionHeaderRead | null) => Promise<T>
  ): Promise<T> {
    await this.ensureRows(sessionId)
    return this.writes.run(sessionId, async () => {
      const commit = await this.rows.readCommit(sessionId)
      return project(commit ? await this.readHeader(commit) : null)
    })
  }

  private async searchBatch<T>(
    sessionId: string,
    signal: AbortSignal | undefined,
    read: (current: SessionHeaderRead) => Promise<T>
  ): Promise<T | null> {
    throwIfAborted(signal)
    if (!(await this.ensureRows(sessionId))) return null
    throwIfAborted(signal)
    return this.writes.run(sessionId, async () => {
      throwIfAborted(signal)
      const commit = await this.rows.readCommit(sessionId)
      if (!commit) return null
      const current = await this.readHeader(commit)
      throwIfAborted(signal)
      const result = await read(current)
      throwIfAborted(signal)
      return result
    })
  }

  readSessionSearchWindow(request: SessionSearchWindowRequest) {
    return this.searchBatch(request.sessionId, request.signal, async (current) => ({
      current,
      page: await readRowSearchWindow(this.rows, current, request),
    }))
  }

  readSessionSearchCandidates(request: SessionSearchCandidatesRequest) {
    if (request.messageIds.length > 100) throw new RangeError('Too many search candidates')
    return this.searchBatch(request.sessionId, request.signal, async (current) => ({
      current,
      selectedMessageIds: await selectedSearchCandidates(this.rows, current, request.messageIds),
    }))
  }

  async readSessionTranscriptWindow(request: SessionTranscriptRequest) {
    if (!(await this.ensureRows(request.sessionId))) return null
    return this.rows.readTranscriptWindow(request)
  }

  async readSessionBranchPreview(request: SessionBranchPreviewRequest) {
    if (!(await this.ensureRows(request.sessionId))) return null
    return this.rows.readBranchPreview(request)
  }

  async readSessionBranchMessagesPage(request: SessionBranchMessagesRequest) {
    if (!(await this.ensureRows(request.sessionId))) return null
    return this.rows.readBranchMessagesPage(request)
  }

  async *iterateSessionResourceReferences(sessionId: string, signal?: AbortSignal) {
    if (!(await this.ensureRows(sessionId))) throw new Error('Resource scan session is unavailable')
    yield* iterateRowResourceReferences(this.rows, sessionId, signal)
  }

  async *iterateSessionAttachmentFacts(request: SessionAttachmentFactsRequest) {
    if (!(await this.ensureRows(request.sessionId))) throw new Error('Attachment source session is unavailable')
    yield* iterateRowAttachmentFacts(this.rows, request)
  }

  async readSessionGeneratingMessageIds(sessionId: string): Promise<string[]> {
    if (!(await this.ensureRows(sessionId))) return []
    return (await this.rows.findMessagesByStatus('generating'))
      .filter((ref) => ref.sessionId === sessionId)
      .map((ref) => ref.messageId)
  }

  async readSessionGenerationControl(request: {
    sessionId: string
    activeGenerationMessageIds: readonly string[]
    includePersisted?: boolean
    expectedRevision?: number
  }) {
    const commit = await this.ensureRows(request.sessionId)
    if (!commit) return null
    if (request.expectedRevision !== undefined && request.expectedRevision !== commit.revision)
      throw new SessionRowConflictError(request.sessionId, request.expectedRevision, commit.revision)
    const reader = await this.commandReader(commit)
    const ids = new Set(request.activeGenerationMessageIds)
    if (request.includePersisted) {
      for (const reference of await this.rows.findMessagesByStatus('generating'))
        if (reference.sessionId === request.sessionId && reference.threadId === reader.activeThread.threadId)
          ids.add(reference.messageId)
    }
    const rows = await reader.metadata([...ids])
    const control = deriveSessionGenerationControl(reader.activeThread, rows)
    const cancellableMessages = []
    for (const row of rows.filter((entry) => control.cancellableMessageIds.includes(entry.messageId))) {
      let current = row
      if (current.branchId === null && current.parentMessageId !== null) {
        let cursor: SessionMessageRelationsCursor | undefined
        const positions = new Set<string>()
        do {
          const page = await this.rows.readMessageRelationsPage({
            sessionId: request.sessionId,
            threadId: row.threadId,
            selector: { kind: 'ancestors', messageId: row.messageId },
            limit: 200,
            expectedRevision: commit.revision,
            cursor,
          })
          if (!page || page.status !== 'ready') throw new Error('Generation branch ancestry is unavailable')
          const branch = page.rows.find((ancestor) => ancestor.branchId !== null)
          if (branch) {
            current = branch
            break
          }
          current = page.rows.at(-1) ?? current
          cursor = page.nextCursor ?? undefined
          if (cursor) {
            if (positions.has(cursor.position)) throw new Error('Generation branch ancestry contains a cycle')
            positions.add(cursor.position)
          }
        } while (cursor)
      }
      const point =
        current.branchId && current.parentMessageId ? await readMetadata(reader, current.parentMessageId) : undefined
      cancellableMessages.push({
        messageId: row.messageId,
        threadId: row.threadId,
        branchId: current.branchId,
        ...(point?.forkPivotId ? { forkPivotId: point.forkPivotId } : {}),
      })
    }
    const pausedMessageIds: string[] = []
    if ((reader.activeThread.summary?.pausedMessageCount ?? 0) > 0) {
      let cursor: SessionMessageRelationsCursor | undefined
      do {
        const page = await this.rows.readMessageRelationsPage({
          sessionId: request.sessionId,
          threadId: reader.record.activeThreadId,
          selector: { kind: 'selected-facts', paused: true },
          limit: 200,
          expectedRevision: commit.revision,
          cursor,
        })
        if (!page || page.status !== 'ready') throw new Error('Paused message projection is unavailable')
        pausedMessageIds.push(...page.rows.map((row) => row.messageId))
        cursor = page.nextCursor ?? undefined
      } while (cursor)
    }
    const latestId = reader.activeThread.summary?.lastConversationMessageId
    const latest = latestId ? await readMetadata(reader, latestId) : undefined
    return {
      sessionId: request.sessionId,
      revision: commit.revision,
      activeThreadId: reader.record.activeThreadId,
      ...control,
      cancellableMessages,
      pausedMessageIds,
      latestMessageHasWebSearchSignInError: latest?.facts.webSearchSignInError ?? false,
    }
  }

  async readSessionThread(request: SessionThreadRequest) {
    if (!(await this.ensureRows(request.sessionId))) return null
    return this.rows.readThread(request)
  }

  async readSessionThreadSummariesPage(request: SessionThreadPageRequest): Promise<SessionThreadSummariesPage | null> {
    if (!(await this.ensureRows(request.sessionId))) return null
    const page = await this.rows.readThreadSummariesPage(request)
    return page
      ? {
          sessionId: request.sessionId,
          revision: page.revision,
          activeThreadId: page.record.activeThreadId,
          threads: page.threads,
          nextCursor: page.nextCursor,
        }
      : null
  }

  async *iterateSessionArtifactMarkdown(request: SessionArtifactRequest): AsyncIterable<string> {
    throwIfAborted(request.signal)
    await this.ensureRows(request.sessionId)
    yield* iterateRowArtifactMarkdown(this.rows, request)
  }

  async readSessionMessages(request: SessionMessagesRequest): Promise<SessionMessagesSource | null> {
    if (!(await this.ensureRows(request.sessionId))) return null
    const read = await this.rows.readMessages(request)
    return read
      ? {
          header: sessionRowHeader(requireRowRecord(read.record)),
          revision: read.revision,
          messages: read.messages.map((row) => row.message),
        }
      : null
  }

  async readSessionConversationState(request: SessionConversationStateRequest) {
    if (!(await this.ensureRows(request.sessionId))) return null
    return readRowConversationState(this.rows, request)
  }

  async readPreviousUserMessage(sessionId: string, targetMessageId: string): Promise<Message | null> {
    const commit = await this.ensureRows(sessionId)
    if (!commit) return null
    const target = await this.rows.readMessageMetadata({
      sessionId,
      messageIds: [targetMessageId],
      expectedRevision: commit.revision,
    })
    if (!target || target.status !== 'ready') throw new Error('Message ancestry projection is unavailable')
    const row = target.rows[0]
    if (!row) return null
    let cursor: SessionMessageRelationsCursor | undefined
    do {
      const page = await this.rows.readMessageRelationsPage({
        sessionId,
        threadId: row.threadId,
        selector: { kind: 'ancestors', messageId: targetMessageId },
        expectedRevision: commit.revision,
        limit: 200,
        cursor,
      })
      if (!page || page.status !== 'ready') throw new Error('Message ancestry projection is unavailable')
      const user = page.rows.find(
        (entry) => entry.messageId !== targetMessageId && entry.facts.role === 'user' && !entry.facts.isForkMarker
      )
      if (user) {
        const selected = await this.rows.readMessages({
          sessionId,
          messageIds: [user.messageId],
          expectedRevision: commit.revision,
        })
        const message = selected?.messages[0]?.message
        if (!message) throw new Error('Previous user message is unavailable')
        return message
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return null
  }

  async readSessionPromptCacheDecision(
    request: import('../../ports/session-prompt-cache-source').SessionPromptCacheRequest
  ) {
    if (!(await this.ensureRows(request.sessionId))) return false
    return readRowPromptCacheDecision(this.rows, request)
  }

  async readSessionNamingMessages(request: {
    sessionId: string
    expectedRevision: number
  }): Promise<SessionMessagesSource | null> {
    const commit = await this.ensureRows(request.sessionId)
    if (!commit) return null
    if (commit.revision !== request.expectedRevision)
      throw new SessionRowConflictError(request.sessionId, request.expectedRevision, commit.revision)
    const reader = await this.commandReader(commit)
    const ids: string[] = []
    let cursor = reader.activeThread.rootMessageId
    const starts = new Set<string>()
    while (cursor && ids.length < 4) {
      if (starts.has(cursor)) throw new Error('Cyclic naming path')
      starts.add(cursor)
      const rows = await reader.relations(
        reader.activeThread.threadId,
        { kind: 'selected-path', messageId: cursor },
        200
      )
      for (const row of rows) {
        if (row.facts.role !== 'system') ids.push(row.messageId)
        if (ids.length === 4) break
      }
      cursor = rows.at(-1)?.activeChildId ?? null
    }
    return this.readSessionMessages({ ...request, messageIds: ids })
  }

  async getSessionContextSource(request: SessionContextRequest): Promise<SessionContextSource | null> {
    if (!(await this.ensureRows(request.sessionId))) return null
    return readRowContextSource(this.rows, request)
  }

  async acceptSessionTokenCacheResults(sessionId: string, results: readonly SessionTokenCacheResult[]): Promise<void> {
    if (results.some((result) => result.identity.sessionId !== sessionId))
      throw new Error('Token cache belongs to another session')
    await this.initialize()
    await this.rows.acceptTokenCache(results)
  }

  async createSessionTokenPlan(request: SessionTokenPlanRequest) {
    if (!(await this.ensureRows(request.sessionId))) return null
    return createRowTokenPlan(this.rows, request)
  }

  async readSessionTokenPage(request: SessionTokenPageRequest) {
    await this.initialize()
    return readRowTokenPage(this.rows, request)
  }

  async acceptSessionTextTokenResults(
    sessionId: string,
    results: readonly SessionTextTokenResult[]
  ): Promise<SessionTextTokenWriteResult> {
    if (results.some((result) => result.source.sessionId !== sessionId))
      throw new Error('Text token source belongs to another session')
    if (!(await this.ensureRows(sessionId))) return { sessionId, results: [] }
    return this.writes.run(sessionId, async () => {
      if (!(await this.rows.readCommit(sessionId))) return { sessionId, results: [] }
      if (!this.rows.acceptTextTokenResults) throw new Error('Text token row storage is unavailable')
      return { sessionId, results: await this.rows.acceptTextTokenResults(results) }
    })
  }

  async patchSessionMessageDerivedData(
    sessionId: string,
    patches: SessionMessageDerivedPatch[]
  ): Promise<SessionMessageDerivedWriteResult> {
    if (!(await this.ensureRows(sessionId))) throw new SessionNotFoundError(sessionId)
    return this.withWrite(sessionId, async () => {
      const commit = await this.requireCommit(sessionId)
      const reader = await this.commandReader(commit)
      const rows = new Map(
        (await reader.messages(patches.map((patch) => patch.messageId))).map((row) => [row.messageId, row])
      )
      const changed = new Map<string, MessageRow>()
      const accepted: SessionMessageDerivedPatch[] = []
      for (const patch of patches) {
        const row = rows.get(patch.messageId)
        const result = row && applySessionMessageDerivedPatch(row.message, patch)
        if (!row || !result) continue
        const updated = { ...row, message: result.message, facts: deriveMessageFacts(result.message) }
        rows.set(row.messageId, updated)
        changed.set(row.messageId, updated)
        accepted.push(result.patch)
      }
      const plan = emptySessionCommandPlan(reader.record)
      plan.diff.messages.upsert = [...changed.values()]
      const delta = await this.commitPlan(commit, reader.activeThread, plan)
      return { sessionId, previousRevision: commit.revision, revision: delta.revision, patches: accepted }
    })
  }

  copySessionThreadRows(request: SessionThreadCopyRequest): Promise<SessionCommandDelta> {
    const { threadId, ...fields } = request
    return this.copySessionRows({ ...fields, scope: { type: 'thread', threadId } })
  }

  async copySessionRows(request: SessionCopyRequest): Promise<SessionCommandDelta> {
    const source = await this.ensureRows(request.sessionId)
    if (!source) throw new SessionNotFoundError(request.sessionId)
    const verifySource = async () => {
      const current = await this.rows.getRevision(request.sessionId)
      if (current !== request.expectedRevision)
        throw new SessionWriteConflictError(request.sessionId, request.expectedRevision, current)
    }
    if (source.revision !== request.expectedRevision)
      throw new SessionWriteConflictError(request.sessionId, request.expectedRevision, source.revision)
    const sourceRecord = requireRowRecord(source.record)
    const sourceThreadId = request.scope.type === 'thread' ? request.scope.threadId : sourceRecord.activeThreadId
    const state = await this.rows.readThreadState({
      sessionId: request.sessionId,
      threadId: sourceThreadId,
      expectedRevision: request.expectedRevision,
    })
    if (state?.status !== 'ready') throw new Error('Copy source thread is missing')
    if (request.appendForkMarkerId && request.scope.type !== 'session')
      throw new Error('Fork markers require a complete conversation copy')
    const shape = request.appendForkMarkerId
      ? await prepareSessionCopyShape(
          await this.commandReader(source),
          this.rows,
          request.appendForkMarkerId,
          request.createdAt
        )
      : undefined
    const active = sourceRecord.activeThreadId === sourceThreadId
    const settings = active
      ? sourceRecord.settings
      : sourceRecord.settings || state.thread.sessionPromptContextSnapshot
        ? { ...sourceRecord.settings, sessionPromptContextSnapshot: state.thread.sessionPromptContextSnapshot }
        : undefined
    const record: SessionRowRecord = {
      ...sourceRecord,
      id: request.targetSessionId,
      activeThreadId: request.targetSessionId,
      name: request.scope.type === 'thread' ? state.thread.name || sourceRecord.name : sourceRecord.name,
      settings,
    }
    const mapThreadId = (id: string) =>
      id === sourceThreadId ? record.id : uuidv5(`${record.id}\u0000thread\u0000${id}`, uuidv5.URL)
    const mapThread = (row: ThreadRow): ThreadRow => {
      const current = row.threadId === sourceThreadId
      const thread = copyThreadMetadata(
        current && shape ? shape.thread : row,
        record.id,
        mapThreadId(row.threadId),
        current ? -1 : row.seq
      )
      return current ? { ...thread, createdAt: request.createdAt, sessionPromptContextSnapshot: undefined } : thread
    }
    const thread = mapThread(state.thread)
    const header = {
      ...sessionRowHeader(record),
      threadName: thread.name ?? (request.scope.type === 'thread' ? '' : undefined),
    }
    return this.withWrite(record.id, async () => {
      const expectedTargetRevision = await this.rows.getRevision(record.id)
      if ((await this.rows.readCommit(record.id)) || (await this.records.getRecord(record.id)))
        throw new Error('Session identity already exists')
      const revision = incrementRevision(expectedTargetRevision ?? 0)
      await stageSessionCopy({
        store: this.rows,
        sourceSessionId: request.sessionId,
        sourceRevision: request.expectedRevision,
        sourceThreadId: request.scope.type === 'thread' ? sourceThreadId : undefined,
        record,
        expectedTargetRevision,
        mapThread,
        mapThreadId,
        transformActiveMessage: shape?.transform,
        appendMessages: shape ? [shape.marker] : undefined,
        verifySource,
      })
      const projectionError = await this.projectRecord(record)
      return {
        record,
        revision,
        sessionId: record.id,
        previousRevision: null,
        header,
        diff: { sessionId: record.id, threads: { upsert: [thread], delete: [] }, messages: { upsert: [], delete: [] } },
        appendedMessageIds: [],
        ...(projectionError === undefined ? {} : { recordProjectionError: projectionError }),
      }
    })
  }

  async createSessionRows(header: SessionHeader, messages: readonly Message[]): Promise<SessionCommandDelta> {
    await this.initialize()
    header = SessionHeaderSchema.strict().parse(header)
    return this.withWrite(header.id, async () => {
      const previousRevision = await this.rows.getRevision(header.id)
      if ((await this.rows.readCommit(header.id)) || (await this.records.getRecord(header.id)))
        throw new Error('Session identity already exists')
      const { threadName, ...fields } = header
      const record: SessionRowRecord = {
        ...fields,
        activeThreadId: header.id,
        storageFormat: 'rows',
        rowFormatVersion: 3,
        rowAuthority: 1,
      }
      if (new Set(messages.map((message) => message.id)).size !== messages.length)
        throw new Error('Duplicate new message identity')
      const rows = messages.map((message, index) => ({
        ...newMessageRow(header.id, header.id, message, messages[index - 1]?.id ?? null, 0),
        activeChildId: messages[index + 1]?.id ?? null,
        selected: true,
      }))
      let summary = emptyThreadSummary()
      for (const row of rows) summary = addSummaryRow(summary, { ...row, facts: row.facts! })
      const thread: ThreadRow = {
        sessionId: header.id,
        threadId: header.id,
        seq: -1,
        name: threadName ?? null,
        createdAt: messages[0]?.timestamp ?? 0,
        rootMessageId: rows[0]?.messageId ?? null,
        activeLeafMessageId: rows.at(-1)?.messageId ?? null,
        compactionPoints: [],
        summary,
        control: {
          generatingAssistantCount: rows.filter((row) => row.status === 'generating' && row.facts?.role === 'assistant')
            .length,
        },
      }
      const revision = incrementRevision(previousRevision ?? 0)
      await this.rows.writeRows(
        { record, revision, rows: { sessionId: header.id, threads: [thread], messages: rows } },
        previousRevision
      )
      const projectionError = await this.projectRecord(record)
      return {
        record,
        revision,
        sessionId: header.id,
        previousRevision: null,
        header,
        diff: {
          sessionId: header.id,
          threads: { upsert: [thread], delete: [] },
          messages: { upsert: rows, delete: [] },
        },
        appendedMessageIds: rows.map((row) => row.messageId),
        ...(projectionError === undefined ? {} : { recordProjectionError: projectionError }),
      }
    })
  }

  async executeSessionCommand(
    sessionId: string,
    command: SessionCommand,
    expectedRevision?: number
  ): Promise<{ kind: 'rows'; delta: SessionCommandDelta }> {
    if (!(await this.ensureRows(sessionId))) throw new SessionNotFoundError(sessionId)
    return this.withWrite(sessionId, async () => {
      const commit = await this.requireCommit(sessionId)
      if (expectedRevision !== undefined && expectedRevision !== commit.revision)
        throw new SessionWriteConflictError(sessionId, expectedRevision, commit.revision)
      const reader = await this.commandReader(commit)
      let plan: SessionCommandPlan | StructurePlan
      if (command.type === 'structure') {
        const operation = command.operation
        if (
          operation.action === 'thread-title-commit' ||
          operation.action === 'thread-create' ||
          operation.action === 'thread-switch' ||
          operation.action === 'thread-delete' ||
          operation.action === 'thread-rename'
        )
          plan = await planThreadStructure(reader, operation)
        else if (operation.action === 'generation-segment-split')
          plan = await planGenerationSegmentSplit(reader, operation)
        else if (
          operation.action === 'message-recover' ||
          operation.action === 'message-retry' ||
          operation.action === 'message-remove' ||
          operation.action === 'message-insert-after' ||
          operation.action === 'session-clear' ||
          operation.action === 'set-system-prompt'
        )
          plan = await planMessageStructure(reader, operation)
        else if (operation.action === 'compaction-commit') plan = await planCompactionStructure(reader, operation)
        else if (operation.action === 'background-follow-up') plan = await planBackgroundFollowUp(reader, operation)
        else plan = await planForkStructure(reader, operation)
        if (
          'result' in plan &&
          (operation.action === 'thread-switch' ||
            operation.action === 'thread-create' ||
            operation.action === 'thread-delete')
        ) {
          const cancelled = new Set(plan.result.cancelMessageIds)
          for (const scope of plan.result.affectedScopes ?? []) {
            if (scope.type !== 'thread') continue
            const thread = await reader.thread(scope.threadId)
            if (!thread?.control) throw new Error('Thread generation control is unavailable')
            if (thread.control.generatingAssistantCount === 0) continue
            let cursor: SessionMessageRelationsCursor | undefined
            do {
              const page = await this.rows.readMessageRelationsPage({
                sessionId,
                threadId: scope.threadId,
                selector: { kind: 'status', status: 'generating' },
                limit: 200,
                expectedRevision: commit.revision,
                cursor,
              })
              if (!page || page.status !== 'ready') throw new Error('Generating message projection is unavailable')
              for (const row of page.rows) if (row.facts.role === 'assistant') cancelled.add(row.messageId)
              cursor = page.nextCursor ?? undefined
            } while (cursor)
          }
          plan.result.cancelMessageIds = [...cancelled]
        }
        const runtimeIds = operation.activeGenerationMessageIds ?? []
        if (runtimeIds.length && 'result' in plan) {
          const scopes = plan.result.affectedScopes ?? []
          const affected = new Set(plan.result.affectedMessageIds ?? [])
          const cancelled = new Set(plan.result.cancelMessageIds)
          for (const row of await reader.metadata(runtimeIds)) {
            if (
              affected.has(row.messageId) ||
              scopes.some(
                (scope) => scope.type === 'session' || (scope.type === 'thread' && scope.threadId === row.threadId)
              )
            ) {
              cancelled.add(row.messageId)
              continue
            }
            const roots = new Set(
              scopes.flatMap((scope) =>
                scope.type === 'subtree' && scope.threadId === row.threadId ? [scope.rootMessageId] : []
              )
            )
            let start: string | null = row.messageId
            while (roots.size && start) {
              const ancestors = await reader.relations(row.threadId, { kind: 'ancestors', messageId: start }, 200)
              if (!ancestors.length) throw new Error('Missing runtime message ancestry')
              if (ancestors.some((ancestor) => roots.has(ancestor.messageId))) {
                cancelled.add(row.messageId)
                break
              }
              start = ancestors.at(-1)!.parentMessageId
            }
          }
          plan.result.cancelMessageIds = [...cancelled]
        }
      } else {
        const ids =
          command.type === 'append'
            ? command.messages.map((message) => message.id)
            : command.type === 'update'
              ? [command.messageId]
              : []
        const selected = await reader.messages(ids)
        const tail =
          command.type === 'append' ? await readMetadata(reader, reader.activeThread.activeLeafMessageId) : undefined
        const last =
          tail && tail.pendingBranchSeq === undefined
            ? (
                await reader.relations(
                  tail.threadId,
                  { kind: 'children', parentMessageId: tail.messageId, reverse: true },
                  1
                )
              )[0]
            : undefined
        plan = planSessionCommand(
          {
            record: reader.record,
            revision: commit.revision,
            thread: reader.activeThread,
            tail,
            nextChildSeq: (last?.seq ?? -1) + 1,
          },
          command,
          selected
        )
      }
      return { kind: 'rows', delta: await this.commitPlan(commit, reader.activeThread, plan) }
    })
  }

  async getCurrentThreadIdentity(sessionId: string): Promise<CurrentThreadIdentity | null> {
    const commit = await this.ensureRows(sessionId)
    return commit ? currentThreadIdentity(await this.commandReader(commit)) : null
  }

  async deleteSession(sessionId: string, projectDeletion?: () => Promise<void>): Promise<void> {
    await this.initialize()
    await this.withWrite(sessionId, async () => {
      const revision = await this.rows.getRevision(sessionId)
      await this.rows.deleteRows(sessionId, revision)
      await this.records.removeRecord(sessionId)
      await projectDeletion?.()
    })
  }

  async getAllSessionIds(): Promise<string[]> {
    await this.initialize()
    const [records, rows] = await Promise.all([this.records.listIds(), this.rows.listSessionIds()])
    return [...new Set([...records, ...rows])]
  }

  private async requireCommit(sessionId: string): Promise<SessionRowCommit> {
    const commit = await this.rows.readCommit(sessionId)
    if (!commit) throw new SessionNotFoundError(sessionId)
    requireRowRecord(commit.record)
    return commit
  }

  private withWrite<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    return this.writes.run(sessionId, async () => {
      try {
        return await action()
      } catch (error) {
        if (error instanceof SessionRowConflictError)
          throw new SessionWriteConflictError(sessionId, error.expectedRevision, error.actualRevision)
        throw error
      }
    })
  }

  private async projectRecord(record: SessionRowRecord): Promise<unknown | undefined> {
    try {
      await this.records.setRecord(record)
      return undefined
    } catch (error) {
      this.reportProjectionError(record.id, error)
      return error
    }
  }

  private reportProjectionError(sessionId: string, error: unknown): void {
    try {
      this.onRecordProjectionError?.(sessionId, error)
    } catch {
      /* A diagnostic sink cannot change a committed result. */
    }
  }

  private async commitPlan(
    previous: SessionRowCommit,
    active: ThreadRow,
    plan: SessionCommandPlan | StructurePlan
  ): Promise<SessionCommandDelta> {
    const record = requireRowRecord(previous.record)
    const changed = hasChanges(plan, record)
    const revision = changed ? incrementRevision(previous.revision) : previous.revision
    const published = changed
      ? await this.rows.applyDiff(plan.diff, { record: plan.record, revision }, previous.revision)
      : { record: plan.record, revision, threads: [active], messageMetadata: [] }
    const committedRecord = requireRowRecord(published.record)
    const nextActive = published.threads.find((thread) => thread.threadId === committedRecord.activeThreadId)
    if (!nextActive) throw new Error('The committed result has no active thread projection')
    const recordProjectionError = changed ? await this.projectRecord(committedRecord) : undefined
    const bodyIds = new Set(plan.diff.messages.upsert.map((row) => row.messageId))
    const metadataIds = new Set(plan.diff.messageMetadataUpsert?.map((row) => row.messageId))
    const structural = 'result' in plan && plan.result.applied
    plan.diff.messageMetadataUpsert = published.messageMetadata.filter(
      (row) => structural || metadataIds.has(row.messageId) || !bodyIds.has(row.messageId)
    )
    const metadata = new Map(published.messageMetadata.map((row) => [row.messageId, row]))
    plan.diff.messages.upsert = plan.diff.messages.upsert.flatMap((row) => {
      const committed = metadata.get(row.messageId)
      return committed ? [{ ...committed, message: row.message }] : []
    })
    for (const thread of published.threads) {
      const index = plan.diff.threads.upsert.findIndex((candidate) => candidate.threadId === thread.threadId)
      if (index < 0) plan.diff.threads.upsert.push(thread)
      else plan.diff.threads.upsert[index] = thread
    }
    return {
      record: committedRecord,
      revision: published.revision,
      sessionId: record.id,
      previousRevision: previous.revision,
      header: { ...sessionRowHeader(committedRecord), threadName: nextActive.name ?? undefined },
      previousHeader: { ...sessionRowHeader(record), threadName: active.name ?? undefined },
      diff: plan.diff,
      appendedMessageIds: plan.appendedMessageIds,
      ...('result' in plan ? { structureResult: plan.result } : {}),
      ...(recordProjectionError === undefined ? {} : { recordProjectionError }),
    }
  }

  private async commandReader(commit: SessionRowCommit): Promise<StructureCommandReader> {
    const record = requireRowRecord(commit.record)
    const sessionId = record.id
    const expectedRevision = commit.revision
    const thread = async (threadId: string): Promise<ThreadRow | null> => {
      const read = await this.rows.readThreadState({ sessionId, threadId, expectedRevision })
      if (!read) return null
      if (read.status !== 'ready') throw new Error('Thread projection is unavailable')
      return read.thread
    }
    const activeThread = await thread(record.activeThreadId)
    if (!activeThread) throw new Error('Active thread is missing')
    return {
      record,
      revision: commit.revision,
      activeThread,
      thread,
      metadata: async (ids) => {
        const unique = [...new Set(ids)]
        const rows: SessionKnownMessageMetadata[] = []
        for (let offset = 0; offset < unique.length; offset += 200) {
          const read = await this.rows.readMessageMetadata({
            sessionId,
            messageIds: unique.slice(offset, offset + 200),
            expectedRevision,
          })
          if (!read) throw new SessionNotFoundError(sessionId)
          if (read.status !== 'ready') throw new Error('Message projection is unavailable')
          rows.push(...read.rows)
        }
        return rows
      },
      messages: async (ids) => {
        const unique = [...new Set(ids)]
        const rows: MessageRow[] = []
        for (let offset = 0; offset < unique.length; offset += 200) {
          const read = await this.rows.readMessages({
            sessionId,
            messageIds: unique.slice(offset, offset + 200),
            expectedRevision,
          })
          if (!read) throw new SessionNotFoundError(sessionId)
          rows.push(...read.messages)
        }
        return rows
      },
      relations: async (threadId: string, selector: SessionMessageRelationsSelector, limit: number) => {
        const read = await this.rows.readMessageRelationsPage({
          sessionId,
          threadId,
          selector,
          limit,
          expectedRevision,
        })
        if (!read) throw new SessionNotFoundError(sessionId)
        if (read.status !== 'ready')
          throw new Error(
            read.status === 'target-missing' ? 'Relation target is missing' : 'Relation projection is unavailable'
          )
        return read.rows
      },
      latestArchivedThread: async () => {
        const read = await this.rows.readThreadSummariesPage({ sessionId, limit: 2 })
        if (!read) throw new SessionNotFoundError(sessionId)
        if (read.revision !== expectedRevision)
          throw new SessionRowConflictError(sessionId, expectedRevision, read.revision)
        const archived = read.threads.find((row) => row.threadId !== record.activeThreadId)
        return archived ? thread(archived.threadId) : null
      },
    }
  }

  async readSessionForkOptionsPage(request: SessionForkOptionsRequest): Promise<SessionForkOptionsPage | null> {
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 200)
      throw new Error('Invalid fork page limit')
    const commit = await this.ensureRows(request.sessionId)
    if (!commit) return null
    const expected = request.expectedRevision ?? request.cursor?.revision
    if (expected !== undefined && expected !== commit.revision)
      throw new SessionRowConflictError(request.sessionId, expected, commit.revision)
    if (request.cursor && request.cursor.pivotId !== request.pivotId)
      throw new Error('Fork cursor belongs to another pivot')
    const reader = await this.commandReader(commit)
    const pivot = await readMetadata(reader, request.pivotId)
    if (!pivot || pivot.forkCreatedAt === undefined) return null
    const point = await readBranchPoint(reader, pivot)
    const selected = await readMetadata(reader, point.activeChildId)
    let boundary: { seq: number; messageId: string } | undefined
    if (request.cursor) {
      const previous = (
        await reader.relations(
          point.threadId,
          { kind: 'children', parentMessageId: point.messageId, branchId: request.cursor.afterBranchId },
          1
        )
      )[0]
      if (
        previous?.seq !== request.cursor.afterSeq &&
        !(point.pendingBranchId === request.cursor.afterBranchId && point.pendingBranchSeq === request.cursor.afterSeq)
      )
        throw new Error('Fork cursor target is missing')
      boundary = { seq: request.cursor.afterSeq, messageId: previous?.messageId ?? '' }
    }
    const page = await this.rows.readMessageRelationsPage({
      sessionId: request.sessionId,
      threadId: point.threadId,
      selector: { kind: 'children', parentMessageId: point.messageId, boundary },
      limit: request.limit,
      expectedRevision: commit.revision,
    })
    if (!page || page.status !== 'ready') throw new Error('Fork projection is unavailable')
    const branches: SessionForkOptionsPage['branches'] = page.rows.map((row) => {
      if (row.branchId === null) throw new Error('Fork branch identity is missing')
      return {
        branchId: row.branchId,
        firstMessageId: row.messageId,
        seq: row.seq,
        selected: point.activeChildId === row.messageId,
      }
    })
    if (
      point.pendingBranchId &&
      point.pendingBranchSeq !== undefined &&
      (!boundary || point.pendingBranchSeq > boundary.seq) &&
      (!page.nextCursor || point.pendingBranchSeq < (page.rows.at(-1)?.seq ?? Infinity))
    )
      branches.push({
        branchId: point.pendingBranchId,
        firstMessageId: null,
        seq: point.pendingBranchSeq,
        selected: true,
      })
    branches.sort((a, b) => a.seq - b.seq || a.branchId.localeCompare(b.branchId))
    const hasMore = branches.length > request.limit || Boolean(page.nextCursor)
    const visible = branches.slice(0, request.limit)
    const last = visible.at(-1)
    return {
      sessionId: request.sessionId,
      revision: commit.revision,
      threadId: point.threadId,
      pivotId: pivot.messageId,
      branchPointId: point.messageId,
      createdAt: pivot.forkCreatedAt,
      selectedBranchId: point.pendingBranchId ?? selected?.branchId ?? '',
      branches: visible,
      nextCursor:
        hasMore && last
          ? { revision: commit.revision, pivotId: pivot.messageId, afterSeq: last.seq, afterBranchId: last.branchId }
          : null,
    }
  }
}
