import { v4 as uuid } from 'uuid'
import type { SessionBranchMessagesRequest, SessionBranchPreviewRequest } from '../ports/session-branch-source'
import type {
  SessionMessageMetadataRequest,
  SessionMessageRelationsRequest,
  SessionThreadStateRequest,
} from '../ports/session-row-relations'
import {
  type GeneratingMessageRef,
  type SessionMessagesRequest,
  type SessionMessagesSnapshot,
  type SessionRowCommit,
  SessionRowConflictError,
  type SessionRowMutationResult,
  type SessionRowSnapshot,
  SessionRowStoreError,
  type SessionRowStorePort,
  type SessionRows,
  type SessionRowsDiff,
  type SessionThreadPage,
  type SessionThreadPageRequest,
} from '../ports/session-row-store'
import type { SessionRowIterationRequest, SessionRowWriter, SessionStoredRow } from '../ports/session-row-transfer'
import type { SessionTextTokenRead, SessionTextTokenResult, SessionTextTokenSource } from '../ports/session-text-tokens'
import {
  SESSION_TOKEN_PAGE_MESSAGES,
  type SessionTokenCachedValue,
  type SessionTokenCacheRequest,
  type SessionTokenCacheResult,
  validateTokenCacheRequest,
  validTokenCacheResult,
} from '../ports/session-token-cache'
import type {
  SessionThreadRead,
  SessionThreadRequest,
  SessionTranscriptPage,
  SessionTranscriptRequest,
} from '../ports/session-transcript-source'
import { deriveMessageFacts } from '../session/message-facts'
import type { MessageRow, MessageRowMetadata, MessageRowStatus, ThreadRow } from '../session/session-tree/types'
import { throwIfAborted } from '../utils/abort'
import { applyMemoryRanges, projectMemoryRows } from './memory-session-row-mutations'
import {
  assertBranchPreviewRevision,
  readBranchPreviewFromMetadata,
  validateBranchPreviewRequest,
} from './session-branch-preview'
import { readBranchMessagesPage, validateBranchMessagesRequest } from './session-branch-reader'
import { assertSessionReadRevision, validateSessionMessagesRequest } from './session-message-selection'
import { readMetadataSelection, readRelationsPage, type SessionRelationReader } from './session-row-relations-read'
import { createTextTokenSource, isValidTextTokenResult } from './session-text-token-sql'
import { assertSessionThreadPageRevision, validateSessionThreadPageRequest } from './session-thread-page'
import {
  assertTranscriptRevision,
  readTranscriptPage,
  type SessionTranscriptReader,
  transcriptOrder,
  transcriptThread,
  validateTranscriptRequest,
} from './session-transcript-read'

interface SessionRowState {
  threads: Map<string, ThreadRow>
  messages: Map<string, MessageRow>
  record: SessionRowCommit['record']
  revision: number
}

type SessionRowCollections = Pick<SessionRowState, 'threads' | 'messages'>

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item))
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  const source = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    copy[key] = cloneValue(source[key])
  }
  return copy
}

function clone<Value>(value: Value): Value {
  return cloneValue(value) as Value
}

function requireIdentity(sessionId: string, threadId: string, messageId?: string): void {
  if (!sessionId) {
    throw new Error('row is missing a sessionId')
  }
  if (!threadId) {
    throw new Error('row is missing a threadId')
  }
  if (messageId !== undefined && !messageId) {
    throw new Error('row is missing a messageId')
  }
}

function buildState(threads: ThreadRow[], messages: MessageRow[], sessionId: string): SessionRowCollections {
  const state: SessionRowCollections = { threads: new Map(), messages: new Map() }
  for (const thread of threads) {
    requireIdentity(thread.sessionId, thread.threadId)
    if (thread.sessionId !== sessionId) {
      throw new Error(`thread ${thread.threadId} belongs to session ${thread.sessionId}`)
    }
    state.threads.set(thread.threadId, clone(thread))
  }
  for (const message of messages) {
    requireIdentity(message.sessionId, message.threadId, message.messageId)
    if (message.sessionId !== sessionId) {
      throw new Error(`message ${message.messageId} belongs to session ${message.sessionId}`)
    }
    state.messages.set(message.messageId, clone(message))
  }
  return state
}

function validateCommit(sessionId: string, threads: ThreadRow[], commit: SessionRowCommit): void {
  const active = threads.filter((thread) => thread.seq === -1)
  if (
    !Number.isSafeInteger(commit.revision) ||
    commit.revision <= 0 ||
    active.length !== 1 ||
    commit.record.id !== sessionId ||
    commit.record.activeThreadId !== active[0].threadId
  ) {
    throw new Error(`session ${sessionId} has invalid commit metadata`)
  }
}

/**
 * In-memory `SessionRowStorePort`. Every operation builds the next
 * state before publishing it, so a rejected row leaves the store untouched the
 * way an aborted transaction would.
 */
export class InMemorySessionRowStore implements SessionRowStorePort {
  private readonly tokenCache = new Map<string, { payloadId: string; value: SessionTokenCachedValue }>()
  private readonly payloadIds = new Map<string, Map<string, string>>()
  private readonly textTokenResults = new Map<string, SessionTextTokenResult['value']>()
  private readonly statusIndex = new Map<string, Map<string, MessageRowMetadata[]>>()
  private readonly pausedIndex = new Map<string, Map<string, Array<{ row: MessageRowMetadata; depth: number }>>>()
  private readonly childrenIndex = new Map<string, Map<string, MessageRowMetadata[]>>()
  private readonly threadSummaryIndex = new Map<string, ThreadRow[]>()
  private readonly sessions = new Map<string, SessionRowState>()
  private readonly revisions = new Map<string, number>()
  private readonly payloadBytes = new Map<string, Map<string, number>>()
  private readonly orderedThreads = new Map<string, ThreadRow[]>()
  initializeCount = 0

  initialize(): Promise<void> {
    this.initializeCount += 1
    return Promise.resolve()
  }

  private relationReader(sessionId: string, state: SessionRowState): SessionRelationReader {
    const index = this.childrenIndex.get(sessionId)
    return {
      path: async (threadId, messageId, direction, limit) => {
        const rows: MessageRowMetadata[] = []
        let id: string | null = messageId
        while (id !== null && rows.length < limit) {
          const found = state.messages.get(id)
          if (!found || found.threadId !== threadId) break
          const { message, ...row } = found
          rows.push(row)
          id = direction === 'ancestors' ? row.parentMessageId : row.activeChildId
        }
        if (rows.length && rows.length < limit && id !== null)
          throw new Error('Relationship path contains a missing message')
        return rows
      },
      status: async (threadId, options) => {
        const rows = this.statusIndex.get(sessionId)?.get(JSON.stringify([threadId, options.status])) ?? []
        let low = 0,
          high = rows.length
        while (low < high) {
          const mid = (low + high) >>> 1
          if (options.afterId !== undefined && rows[mid].messageId <= options.afterId) low = mid + 1
          else high = mid
        }
        return rows.slice(low, low + options.limit)
      },
      selectedFacts: async (threadId, options) => {
        const rows = this.pausedIndex.get(sessionId)?.get(threadId) ?? []
        let low = 0
        let high = rows.length
        while (low < high) {
          const mid = (low + high) >>> 1
          if (rows[mid].depth <= (options.afterDepth ?? -1)) low = mid + 1
          else high = mid
        }
        return rows.slice(low, low + options.limit)
      },
      message: async (id) => {
        const row = state.messages.get(id)
        if (!row) return null
        const { message, ...metadata } = row
        return metadata
      },
      children: async (threadId, selector, limit) => {
        const values = index?.get(JSON.stringify([threadId, selector.parentMessageId, selector.branchId ?? null])) ?? []
        const boundary = selector.boundary
        let low = 0
        let high = values.length
        while (low < high) {
          const mid = (low + high) >>> 1
          const row = values[mid]
          if (
            !boundary ||
            row.seq < boundary.seq ||
            (row.seq === boundary.seq &&
              (row.messageId < boundary.messageId || (!selector.reverse && row.messageId === boundary.messageId)))
          )
            low = mid + 1
          else high = mid
        }
        const start = boundary ? low : selector.reverse ? values.length : 0
        return selector.reverse
          ? values.slice(Math.max(0, start - limit), start).reverse()
          : values.slice(start, start + limit)
      },
    }
  }
  async readMessageMetadata(request: SessionMessageMetadataRequest) {
    const state = this.sessions.get(request.sessionId)
    assertSessionReadRevision(request, this.revisions.get(request.sessionId) ?? null)
    return state
      ? clone(await readMetadataSelection(request, state, this.relationReader(request.sessionId, state)))
      : null
  }
  async readMessageRelationsPage(request: SessionMessageRelationsRequest) {
    const state = this.sessions.get(request.sessionId)
    assertSessionReadRevision(request, this.revisions.get(request.sessionId) ?? null)
    return state ? clone(await readRelationsPage(request, state, this.relationReader(request.sessionId, state))) : null
  }
  async readThreadState(request: SessionThreadStateRequest) {
    const state = this.sessions.get(request.sessionId)
    assertSessionReadRevision(request, this.revisions.get(request.sessionId) ?? null)
    if (!state) return null
    const id = request.threadId ?? state.record.activeThreadId
    const thread = state.threads.get(id)
    if (!thread) return null
    return clone(
      thread.summary
        ? {
            record: state.record,
            revision: state.revision,
            status: 'ready' as const,
            thread: { ...thread, summary: thread.summary },
          }
        : {
            record: state.record,
            revision: state.revision,
            status: 'projection-unavailable' as const,
            messageIds: [],
            threadIds: [id],
          }
    )
  }
  async readThreadSummariesPage(request: SessionThreadPageRequest) {
    validateSessionThreadPageRequest(request)
    const state = this.sessions.get(request.sessionId)
    assertSessionThreadPageRevision(request, this.revisions.get(request.sessionId) ?? null)
    if (!state) return null
    const values = this.threadSummaryIndex.get(request.sessionId) ?? []
    const offset = request.cursor?.offset ?? 0
    return clone({
      record: state.record,
      revision: state.revision,
      threads: values.slice(offset, offset + request.limit).map(transcriptThread),
      nextCursor:
        offset + request.limit < values.length
          ? { sessionId: request.sessionId, revision: state.revision, offset: offset + request.limit }
          : null,
    })
  }

  async readCommit(sessionId: string): Promise<SessionRowCommit | null> {
    const state = this.sessions.get(sessionId)
    return state ? clone({ record: state.record, revision: state.revision }) : null
  }

  async readThread(request: SessionThreadRequest): Promise<SessionThreadRead | null> {
    const state = this.sessions.get(request.sessionId)
    assertSessionReadRevision(request, this.revisions.get(request.sessionId) ?? null)
    if (!state) return null
    const thread = state.threads.get(request.threadId ?? state.record.activeThreadId)
    return thread ? clone({ record: state.record, revision: state.revision, thread: transcriptThread(thread) }) : null
  }

  private transcriptReader(sessionId: string, state: SessionRowState): SessionTranscriptReader {
    const ordered = this.orderedThreads.get(sessionId) ?? []
    const sizes = this.payloadBytes.get(sessionId)
    return {
      thread: async (id) => {
        const row = state.threads.get(id)
        return row ? transcriptThread(row) : null
      },
      adjacent: async (thread, direction) => {
        const order = thread ? transcriptOrder(thread.seq) : direction === 'after' ? -1 : Infinity
        let low = 0
        let high = ordered.length
        while (low < high) {
          const mid = (low + high) >>> 1
          if (
            transcriptOrder(ordered[mid].seq) < order ||
            (direction === 'after' && transcriptOrder(ordered[mid].seq) === order)
          )
            low = mid + 1
          else high = mid
        }
        const row = ordered[direction === 'before' ? low - 1 : low]
        return row ? transcriptThread(row) : null
      },
      message: async (id) => {
        const row = state.messages.get(id)
        if (!row) return null
        const { message, ...metadata } = row
        return { ...metadata, payloadBytes: sizes?.get(id) ?? 0 }
      },
      payloads: async (ids) =>
        ids.map((id) => {
          const row = state.messages.get(id)
          if (!row) throw new Error('Transcript payload is missing')
          return clone(row)
        }),
    }
  }

  async readBranchPreview(request: SessionBranchPreviewRequest) {
    validateBranchPreviewRequest(request)
    const state = this.sessions.get(request.sessionId)
    assertBranchPreviewRevision(request, state ?? null)
    return state
      ? clone(
          await readBranchPreviewFromMetadata(request, state, this.relationReader(request.sessionId, state).message)
        )
      : null
  }

  async readBranchMessagesPage(request: SessionBranchMessagesRequest) {
    validateBranchMessagesRequest(request)
    const state = this.sessions.get(request.sessionId)
    assertSessionReadRevision(
      { sessionId: request.sessionId, expectedRevision: request.expectedRevision ?? request.cursor?.revision },
      this.revisions.get(request.sessionId) ?? null
    )
    return state
      ? clone(await readBranchMessagesPage(request, state, this.transcriptReader(request.sessionId, state)))
      : null
  }

  async readTranscriptWindow(request: SessionTranscriptRequest): Promise<SessionTranscriptPage | null> {
    validateTranscriptRequest(request)
    const state = this.sessions.get(request.sessionId)
    assertTranscriptRevision(request, this.revisions.get(request.sessionId) ?? null)
    return state
      ? clone(await readTranscriptPage(request, state, this.transcriptReader(request.sessionId, state)))
      : null
  }

  readSnapshot(sessionId: string): Promise<SessionRowSnapshot | null> {
    const state = this.sessions.get(sessionId)
    if (!state) {
      return Promise.resolve(null)
    }
    return Promise.resolve({
      rows: {
        sessionId,
        threads: [...state.threads.values()].map((thread) => clone(thread)),
        messages: [...state.messages.values()].map((message) => clone(message)),
      },
      record: clone(state.record),
      revision: state.revision,
    })
  }

  async readThreadsPage(request: SessionThreadPageRequest): Promise<SessionThreadPage | null> {
    try {
      validateSessionThreadPageRequest(request)
      const state = this.sessions.get(request.sessionId)
      assertSessionThreadPageRevision(request, this.revisions.get(request.sessionId) ?? null)
      if (!state) return null
      const threads = [...state.threads.values()].sort((left, right) =>
        left.seq === -1
          ? -1
          : right.seq === -1
            ? 1
            : right.seq - left.seq || right.threadId.localeCompare(left.threadId)
      )
      const offset = request.cursor?.offset ?? 0
      const threadIds = threads.slice(offset, offset + request.limit).map((thread) => thread.threadId)
      const nextOffset = offset + threadIds.length
      return clone({
        record: state.record,
        revision: state.revision,
        threadIds,
        nextCursor:
          nextOffset < threads.length
            ? { sessionId: request.sessionId, revision: state.revision, offset: nextOffset }
            : null,
      })
    } catch (error) {
      if (error instanceof SessionRowConflictError) throw error
      throw new SessionRowStoreError('read-thread-page', error, request.sessionId)
    }
  }

  async readTokenCache(request: SessionTokenCacheRequest) {
    validateTokenCacheRequest(request)
    const state = this.sessions.get(request.sessionId)
    assertSessionReadRevision(request, this.revisions.get(request.sessionId) ?? null)
    if (!state) return null
    const entries = [...new Set(request.messageIds)].flatMap((messageId) => {
      const payloadId = this.payloadIds.get(request.sessionId)?.get(messageId)
      if (!payloadId) return []
      const cached = this.tokenCache.get(JSON.stringify([request.sessionId, messageId, request.cacheKey]))
      return [
        {
          sessionId: request.sessionId,
          messageId,
          payloadId,
          payloadBytes: this.payloadBytes.get(request.sessionId)!.get(messageId)!,
          ...(cached?.payloadId === payloadId ? { value: cached.value } : {}),
        },
      ]
    })
    return clone({ record: state.record, revision: state.revision, entries })
  }
  async acceptTokenCache(results: readonly SessionTokenCacheResult[]): Promise<void> {
    if (results.length > SESSION_TOKEN_PAGE_MESSAGES) throw new Error('Token cache write exceeds page size')
    for (const result of results) {
      if (!validTokenCacheResult(result)) continue
      const { identity, cacheKey, value } = result
      if (this.payloadIds.get(identity.sessionId)?.get(identity.messageId) !== identity.payloadId) continue
      const key = JSON.stringify([identity.sessionId, identity.messageId, cacheKey])
      const previous = this.tokenCache.get(key)
      if (previous?.payloadId === identity.payloadId && !previous.value.approximate && value.approximate) continue
      this.tokenCache.set(key, { payloadId: identity.payloadId, value: clone(value) })
    }
  }

  async readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null> {
    try {
      validateSessionMessagesRequest(request)
      const state = this.sessions.get(request.sessionId)
      assertSessionReadRevision(request, this.revisions.get(request.sessionId) ?? null)
      if (!state) return null
      return clone({
        record: state.record,
        revision: state.revision,
        textTokens: await this.tokenSnapshot(request.sessionId, request.messageIds),
        messages: [...new Set(request.messageIds)].flatMap((id) => {
          const row = state.messages.get(id)
          return row ? [row] : []
        }),
      })
    } catch (error) {
      if (error instanceof SessionRowConflictError) throw error
      throw new SessionRowStoreError('read-messages', error, request.sessionId)
    }
  }

  private tokenKey(source: Pick<SessionTextTokenSource, 'sessionId' | 'messageId' | 'payloadId'>, tokenizer: string) {
    return JSON.stringify([source.sessionId, source.messageId, source.payloadId, tokenizer])
  }
  private async tokenSnapshot(sessionId: string, ids: readonly string[]): Promise<SessionTextTokenRead> {
    const sources: Record<string, SessionTextTokenSource> = Object.create(null)
    for (const id of ids) {
      const message = this.sessions.get(sessionId)?.messages.get(id)?.message
      const payload = this.payloadIds.get(sessionId)?.get(id)
      if (message && payload) {
        const source = createTextTokenSource(sessionId, message, payload)
        if (source) sources[id] = source
      }
    }
    return { sources, results: await this.readTextTokenResults(Object.values(sources)) }
  }
  async readTextTokenResults(sources: readonly SessionTextTokenSource[]): Promise<SessionTextTokenResult[]> {
    const result: SessionTextTokenResult[] = []
    for (const source of sources) {
      if (this.payloadIds.get(source.sessionId)?.get(source.messageId) !== source.payloadId) continue
      for (const tokenizer of ['default', 'deepseek']) {
        const value = this.textTokenResults.get(this.tokenKey(source, tokenizer))
        if (value && isValidTextTokenResult({ source, value })) result.push({ source, value: clone(value) })
      }
    }
    return result
  }
  async acceptTextTokenResults(results: readonly SessionTextTokenResult[]): Promise<SessionTextTokenResult[]> {
    const sources: SessionTextTokenSource[] = []
    for (const result of results) {
      if (
        !isValidTextTokenResult(result) ||
        this.payloadIds.get(result.source.sessionId)?.get(result.source.messageId) !== result.source.payloadId
      )
        continue
      const key = this.tokenKey(result.source, result.value.tokenizerType)
      const old = this.textTokenResults.get(key)
      if (
        !old ||
        (result.value.calculatedAt >= old.calculatedAt &&
          (old.approximate === true || result.value.approximate !== true))
      )
        this.textTokenResults.set(key, clone(result.value))
      sources.push(result.source)
    }
    return this.readTextTokenResults([...new Map(sources.map((source) => [source.payloadId, source])).values()])
  }
  private replacePayloadIds(sessionId: string, ids: Map<string, string>) {
    const previous = this.payloadIds.get(sessionId)
    for (const [id, payloadId] of previous ?? [])
      if (ids.get(id) !== payloadId)
        for (const tokenizer of ['default', 'deepseek'])
          this.textTokenResults.delete(this.tokenKey({ sessionId, messageId: id, payloadId }, tokenizer))
    this.payloadIds.set(sessionId, ids)
  }

  async *iterateRows(request: SessionRowIterationRequest): AsyncGenerator<SessionStoredRow> {
    const { sessionId, threadId, signal } = request
    const state = this.sessions.get(sessionId)
    if (!state) throw new Error('Session is missing')
    const revision = request.expectedRevision ?? state.revision
    const check = () => {
      throwIfAborted(signal)
      const actual = this.revisions.get(sessionId) ?? null
      if (actual !== revision) throw new SessionRowConflictError(sessionId, revision, actual)
    }
    check()
    const threads = [...state.threads.values()].sort((a, b) => transcriptOrder(a.seq) - transcriptOrder(b.seq))
    if (threadId && !state.threads.has(threadId)) throw new Error('Thread is missing')
    for (const thread of threads) {
      if (threadId && thread.threadId !== threadId) continue
      check()
      yield { kind: 'thread', thread: clone(thread) }
    }
    for (const row of state.messages.values()) {
      if (threadId && row.threadId !== threadId) continue
      check()
      yield { kind: 'message', message: clone(row) }
    }
    check()
  }

  async stageRows(commit: SessionRowCommit, expectedRevision: number | null): Promise<SessionRowWriter> {
    if (
      commit.record.rowFormatVersion !== 3 ||
      !Number.isSafeInteger(commit.revision) ||
      commit.revision !== (expectedRevision ?? 0) + 1
    )
      throw new Error('Invalid staged revision')
    commit = clone(commit)
    const sessionId = commit.record.id
    const actual = this.revisions.get(sessionId) ?? null
    if (actual !== expectedRevision) throw new SessionRowConflictError(sessionId, expectedRevision, actual)
    const threads = new Map<string, ThreadRow>()
    const messages = new Map<string, MessageRow>()
    let closed = false
    const assertOpen = () => {
      if (closed) throw new Error('Session row writer is closed')
    }
    return {
      appendThread: async (thread) => {
        assertOpen()
        if (thread.sessionId !== sessionId || threads.has(thread.threadId)) throw new Error('Invalid staged thread')
        threads.set(thread.threadId, clone(thread))
      },
      appendMessage: async (row) => {
        assertOpen()
        if (row.sessionId !== sessionId || row.messageId !== row.message.id || messages.has(row.messageId))
          throw new Error('Invalid staged message')
        messages.set(row.messageId, clone({ ...row, facts: deriveMessageFacts(row.message) }))
      },
      publish: async () => {
        assertOpen()
        const rows = { sessionId, threads: [...threads.values()], messages: [...messages.values()] }
        await this.writeRows({ ...commit, rows }, expectedRevision)
        closed = true
      },
      dispose: async () => {
        closed = true
        threads.clear()
        messages.clear()
      },
    }
  }

  writeRows(snapshot: SessionRowSnapshot, expectedRevision?: number | null): Promise<void> {
    const { rows, record, revision } = snapshot
    if (!rows.sessionId) {
      return Promise.reject(new SessionRowStoreError('write-rows', new Error('rows are missing a sessionId')))
    }
    const actualRevision = this.revisions.get(rows.sessionId) ?? null
    if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
      return Promise.reject(new SessionRowConflictError(rows.sessionId, expectedRevision, actualRevision))
    }
    let next: SessionRowCollections
    try {
      validateCommit(rows.sessionId, rows.threads, { record, revision })
      next = buildState(rows.threads, rows.messages, rows.sessionId)
      if (record.rowFormatVersion === 3) projectMemoryRows(next.messages, next.threads)
    } catch (error) {
      return Promise.reject(new SessionRowStoreError('write-rows', error, rows.sessionId))
    }
    this.replacePayloadIds(
      rows.sessionId,
      new Map(rows.messages.map((row) => [row.messageId, `${rows.sessionId}:${row.messageId}:${uuid()}`]))
    )
    this.publish(rows.sessionId, { ...next, record: clone(record), revision })
    return Promise.resolve()
  }

  applyDiff(
    diff: SessionRowsDiff,
    commit: SessionRowCommit,
    expectedRevision?: number
  ): Promise<SessionRowMutationResult> {
    if (!diff.sessionId) {
      return Promise.reject(new SessionRowStoreError('apply-diff', new Error('diff is missing a sessionId')))
    }
    if (expectedRevision === undefined)
      return Promise.reject(
        new SessionRowStoreError(
          'apply-diff',
          new Error('Local row edits require an expected revision'),
          diff.sessionId
        )
      )
    const current = this.sessions.get(diff.sessionId)
    if (expectedRevision !== undefined) {
      const actualRevision = this.revisions.get(diff.sessionId) ?? null
      if (actualRevision !== expectedRevision) {
        return Promise.reject(new SessionRowConflictError(diff.sessionId, expectedRevision, actualRevision))
      }
    }
    const next: SessionRowState = {
      threads: new Map(current?.threads),
      messages: new Map(current?.messages),
      record: clone(commit.record),
      revision: commit.revision,
    }
    try {
      if (commit.record.rowFormatVersion !== 3) throw new Error('Session rows require a format upgrade before editing')
      applyMemoryRanges(next.messages, next.threads, diff, commit.record.activeThreadId)
      for (const thread of diff.threads.upsert) {
        requireIdentity(thread.sessionId, thread.threadId)
        if (thread.sessionId !== diff.sessionId) {
          throw new Error(`thread ${thread.threadId} belongs to session ${thread.sessionId}`)
        }
        next.threads.set(thread.threadId, clone(thread))
      }
      for (const row of diff.messageMetadataUpsert ?? []) {
        const previous = next.messages.get(row.messageId)
        if (expectedRevision === undefined || !previous || row.sessionId !== diff.sessionId)
          throw new Error('Invalid structural message edit')
        next.messages.set(row.messageId, { ...clone(row), message: previous.message })
      }
      for (const message of diff.messages.upsert) {
        requireIdentity(message.sessionId, message.threadId, message.messageId)
        if (message.sessionId !== diff.sessionId) {
          throw new Error(`message ${message.messageId} belongs to session ${message.sessionId}`)
        }
        next.messages.set(message.messageId, {
          ...clone(message),
          ...(commit.record.rowFormatVersion === 3 ? { facts: deriveMessageFacts(message.message) } : {}),
        })
      }
    } catch (error) {
      return Promise.reject(new SessionRowStoreError('apply-diff', error, diff.sessionId))
    }
    for (const threadId of diff.threads.delete) {
      next.threads.delete(threadId)
    }
    for (const messageId of diff.messages.delete) {
      next.messages.delete(messageId)
    }
    let changedForks: string[] = []
    if (next.threads.size > 0 || next.messages.size > 0) {
      try {
        validateCommit(diff.sessionId, [...next.threads.values()], commit)
        if (commit.record.rowFormatVersion === 3) changedForks = projectMemoryRows(next.messages, next.threads)
      } catch (error) {
        return Promise.reject(new SessionRowStoreError('apply-diff', error, diff.sessionId))
      }
    }
    const payloads = new Map(this.payloadIds.get(diff.sessionId))
    for (const row of diff.messages.upsert) payloads.set(row.messageId, `${diff.sessionId}:${row.messageId}:${uuid()}`)
    for (const id of payloads.keys()) if (!next.messages.has(id)) payloads.delete(id)
    this.replacePayloadIds(diff.sessionId, payloads)
    this.publish(diff.sessionId, next)
    const changedThreads = new Set([
      commit.record.activeThreadId,
      ...diff.threads.upsert.map((row) => row.threadId),
      ...diff.messages.upsert.map((row) => row.threadId),
      ...(diff.messageMetadataUpsert ?? []).map((row) => row.threadId),
      ...(diff.expandForks ?? []).map((row) => row.threadId),
      ...(diff.deleteSubtrees ?? []).map((row) => row.threadId),
      ...(diff.reparentChildren ?? []).map((row) => row.threadId),
      ...(diff.deleteThreadMessages ?? []),
    ])
    const publishedIds = new Set([
      ...(diff.messageMetadataUpsert ?? []).map((row) => row.messageId),
      ...diff.messages.upsert.map((row) => row.messageId),
      ...changedForks,
    ])
    return Promise.resolve({
      ...commit,
      messageMetadata: [...publishedIds].flatMap((id) => {
        const row = next.messages.get(id)
        if (!row) return []
        const { message, ...metadata } = row
        return [clone(metadata)]
      }),
      threads: [...changedThreads].flatMap((id) => {
        const row = next.threads.get(id)
        return row ? [clone(row)] : []
      }),
    })
  }

  deleteRows(sessionId: string, expectedRevision?: number | null): Promise<void> {
    const actualRevision = this.revisions.get(sessionId) ?? null
    if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
      return Promise.reject(new SessionRowConflictError(sessionId, expectedRevision, actualRevision))
    }
    if (actualRevision === Number.MAX_SAFE_INTEGER) {
      return Promise.reject(
        new SessionRowStoreError('delete-rows', new Error('session row revision is exhausted'), sessionId)
      )
    }
    this.sessions.delete(sessionId)
    this.replacePayloadIds(sessionId, new Map())
    this.statusIndex.delete(sessionId)
    this.pausedIndex.delete(sessionId)
    this.childrenIndex.delete(sessionId)
    this.threadSummaryIndex.delete(sessionId)
    this.orderedThreads.delete(sessionId)
    this.payloadBytes.delete(sessionId)
    if (actualRevision !== null) this.revisions.set(sessionId, actualRevision + 1)
    return Promise.resolve()
  }

  hasRows(sessionId: string): Promise<boolean> {
    return Promise.resolve(this.sessions.has(sessionId))
  }

  getRevision(sessionId: string): Promise<number | null> {
    return Promise.resolve(this.revisions.get(sessionId) ?? null)
  }

  listSessionIds(): Promise<string[]> {
    return Promise.resolve([...this.sessions.keys()])
  }

  findMessagesByStatus(status: MessageRowStatus): Promise<GeneratingMessageRef[]> {
    const refs: GeneratingMessageRef[] = []
    for (const state of this.sessions.values()) {
      for (const message of state.messages.values()) {
        if (message.status === status) {
          refs.push({ sessionId: message.sessionId, threadId: message.threadId, messageId: message.messageId })
        }
      }
    }
    return Promise.resolve(refs)
  }

  clear(): void {
    this.sessions.clear()
    this.statusIndex.clear()
    this.pausedIndex.clear()
    this.childrenIndex.clear()
    this.threadSummaryIndex.clear()
    this.orderedThreads.clear()
    this.payloadBytes.clear()
    this.revisions.clear()
  }

  snapshot(): SessionRowSnapshot[] {
    return [...this.sessions.entries()].map(([sessionId, state]) => ({
      rows: {
        sessionId,
        threads: [...state.threads.values()].map((thread) => clone(thread)),
        messages: [...state.messages.values()].map((message) => clone(message)),
      },
      record: clone(state.record),
      revision: state.revision,
    }))
  }

  private publish(sessionId: string, state: SessionRowState): void {
    this.revisions.set(sessionId, state.revision)
    if (state.threads.size === 0 && state.messages.size === 0) {
      this.sessions.delete(sessionId)
      this.payloadBytes.delete(sessionId)
      this.statusIndex.delete(sessionId)
      this.pausedIndex.delete(sessionId)
      this.childrenIndex.delete(sessionId)
      this.threadSummaryIndex.delete(sessionId)
      this.orderedThreads.delete(sessionId)
      return
    }
    const previous = this.sessions.get(sessionId)
    const sizes = new Map(this.payloadBytes.get(sessionId))
    for (const [id, row] of state.messages) {
      if (previous?.messages.get(id)?.message !== row.message || !sizes.has(id))
        sizes.set(id, new TextEncoder().encode(JSON.stringify(row.message)).length)
    }
    for (const id of sizes.keys()) if (!state.messages.has(id)) sizes.delete(id)
    this.payloadBytes.set(sessionId, sizes)
    this.orderedThreads.set(
      sessionId,
      [...state.threads.values()]
        .filter((row) => row.rootMessageId !== null)
        .sort((a, b) => transcriptOrder(a.seq) - transcriptOrder(b.seq))
    )
    const statuses = new Map<string, MessageRowMetadata[]>()
    const children = new Map<string, MessageRowMetadata[]>()
    for (const row of state.messages.values()) {
      const { message, ...metadata } = row
      const statusKey = JSON.stringify([row.threadId, row.status])
      const matching = statuses.get(statusKey) ?? []
      matching.push(metadata)
      statuses.set(statusKey, matching)
      for (const branch of row.branchId === null ? [null] : [null, row.branchId]) {
        const key = JSON.stringify([row.threadId, row.parentMessageId, branch])
        const list = children.get(key) ?? []
        list.push(metadata)
        children.set(key, list)
      }
    }
    for (const values of children.values())
      values.sort((a, b) => a.seq - b.seq || (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0))
    const paused = new Map<string, Array<{ row: MessageRowMetadata; depth: number }>>()
    for (const thread of state.threads.values()) {
      const rows: Array<{ row: MessageRowMetadata; depth: number }> = []
      let id = thread.rootMessageId
      let depth = 0
      while (id !== null && depth <= state.messages.size) {
        const found = state.messages.get(id)
        if (!found) break
        const { message, ...row } = found
        if (row.selected && row.facts?.paused) rows.push({ row, depth })
        id = row.activeChildId
        depth++
      }
      paused.set(thread.threadId, rows)
    }
    for (const rows of statuses.values())
      rows.sort((a, b) => (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0))
    this.statusIndex.set(sessionId, statuses)
    this.pausedIndex.set(sessionId, paused)
    this.childrenIndex.set(sessionId, children)
    this.threadSummaryIndex.set(
      sessionId,
      [...state.threads.values()].sort((a, b) =>
        a.seq === -1 ? -1 : b.seq === -1 ? 1 : b.seq - a.seq || b.threadId.localeCompare(a.threadId)
      )
    )
    this.sessions.set(sessionId, state)
  }
}
