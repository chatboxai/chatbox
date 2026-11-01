import {
  DEFAULT_TRANSCRIPT_PAGE_BYTES,
  SessionRowConflictError,
  type SessionRowCommit,
  type SessionCommandDelta,
  type SessionTranscriptAnchor,
  type SessionTranscriptCursor,
  type SessionTranscriptOrigin,
  type SessionTranscriptPage,
  type SessionTranscriptRequest,
  type SessionTranscriptThread,
  type SessionBranchMessagesRequest,
  type SessionBranchMessagesPage,
} from '@chatbox/core/ports'
import type { MessageRow, MessageRowMetadata } from '@chatbox/core/session/session-tree'
import type { Message, Updater } from '@chatbox/core'

export function sessionTranscriptPageSize(platform: 'rn' | 'capacitor' | 'electron' | 'web'): number {
  return platform === 'rn' || platform === 'capacitor' ? 20 : 100
}

export interface SessionTranscriptViewportAnchor extends SessionTranscriptAnchor {
  blockId?: string
  /** The message's own origin relative to the viewport, captured with the identified point. */
  messageOffset?: number
  /** The identified block/text point (or message origin) relative to the viewport. */
  offset: number
}

export interface SessionTranscriptLayoutRequest {
  requestId: number
  kind: 'head' | 'tail' | 'anchor' | 'preserve'
  anchor: SessionTranscriptAnchor | SessionTranscriptViewportAnchor
  rebase?: boolean
}

export interface SessionTranscriptOperation {
  requestId: number
  /** Identifies one branch change across repeated reads at newer content revisions. */
  branchOperationId?: number
  kind: 'open' | 'older' | 'newer' | 'navigate' | 'branch'
  phase: 'reading' | 'layout' | 'error'
  error?: Error
}

export interface SessionTranscriptWindowState {
  sessionId: string
  pageSize: number
  maxBytes: number
  revision: number | null
  windowEpoch: number
  pages: readonly SessionTranscriptWindowPage[]
  rows: readonly MessageRow[]
  threads: readonly SessionTranscriptThread[]
  hasOlder: boolean
  hasNewer: boolean
  firstWindowReady: boolean
  operation: SessionTranscriptOperation | null
  layout: SessionTranscriptLayoutRequest | null
}

export interface SessionTranscriptWindowPage extends Omit<SessionTranscriptPage, 'payloadBytes'> {
  /** A retained prefix has unknown bytes until it is read again. */
  payloadBytes: number | null
}

export interface SessionTranscriptWindowSource {
  prefetchThreadLinks?(
    request: import('@chatbox/core/ports').SessionThreadRequest & { signal?: AbortSignal }
  ): Promise<void>
  readTranscriptWindow(request: SessionTranscriptRequest): Promise<SessionTranscriptPage | null>
}

export type SessionTranscriptBranchCommit = SessionRowCommit & {
  previousRevision: number
  /** A loaded shared message; null means a loaded thread's root branches. */
  sharedPrefixEnd: SessionTranscriptAnchor
} & ({ origin: SessionTranscriptOrigin; cursor?: never } | { cursor: SessionTranscriptCursor; origin?: never })

export interface SessionTranscriptWindowOptions {
  sessionId: string
  pageSize: number
  maxBytes?: number
  source: SessionTranscriptWindowSource
  captureAnchor?(): SessionTranscriptViewportAnchor | null
}

export class SessionTranscriptWindowError extends Error {
  readonly name = 'SessionTranscriptWindowError'
}

function initialState(sessionId: string, pageSize: number, maxBytes: number): SessionTranscriptWindowState {
  return {
    sessionId,
    pageSize,
    maxBytes,
    revision: null,
    windowEpoch: 0,
    pages: [],
    rows: [],
    threads: [],
    hasOlder: false,
    hasNewer: false,
    firstWindowReady: false,
    operation: null,
    layout: null,
  }
}

function withPages(
  state: SessionTranscriptWindowState,
  pages: readonly SessionTranscriptWindowPage[]
): SessionTranscriptWindowState {
  const rows = pages.flatMap((page) => page.messages)
  const threads = new Map<string, SessionTranscriptThread>()
  for (const page of pages) for (const thread of page.threads) threads.set(thread.threadId, thread)
  return {
    ...state,
    revision: pages[0]?.revision ?? state.revision,
    pages,
    rows,
    threads: [...threads.values()],
    hasOlder: Boolean(pages[0]?.older),
    hasNewer: Boolean(pages.at(-1)?.newer),
  }
}

function projectThread(thread: SessionTranscriptThread): SessionTranscriptThread {
  const { sessionId, threadId, threadOrder, name, createdAt, rootMessageId, activeLeafMessageId, summary, control } =
    thread
  return {
    sessionId,
    threadId,
    threadOrder,
    name,
    createdAt,
    rootMessageId,
    activeLeafMessageId,
    summary,
    control,
  }
}

function messageAnchor(row: MessageRow): SessionTranscriptAnchor {
  return { threadId: row.threadId, messageId: row.messageId }
}

function cursorAt(
  page: SessionTranscriptWindowPage,
  row: MessageRow,
  direction: SessionTranscriptCursor['direction'],
  limit: number,
  maxBytes: number
): SessionTranscriptCursor {
  const thread = page.threads.find((item) => item.threadId === row.threadId)
  if (!thread) throw new SessionTranscriptWindowError('Message thread metadata is missing')
  return {
    sessionId: page.record.id,
    revision: page.revision,
    threadId: row.threadId,
    threadOrder: thread.threadOrder,
    messageId: row.messageId,
    direction,
    limit,
    maxBytes,
    scope: 'transcript',
  }
}

function projectPrefix(
  pages: readonly SessionTranscriptWindowPage[],
  end: SessionTranscriptAnchor,
  commit: SessionRowCommit,
  limit: number,
  maxBytes: number
): SessionTranscriptWindowPage[] {
  const retained: SessionTranscriptWindowPage[] = []
  let found = false
  for (const page of pages) {
    const index = page.messages.findIndex((row) =>
      end.messageId === null ? row.threadId === end.threadId : row.messageId === end.messageId
    )
    const count = index < 0 ? page.messages.length : index + (end.messageId === null ? 0 : 1)
    const messages = page.messages.slice(0, count)
    if (messages.length > 0) {
      const ids = new Set(messages.map((row) => row.threadId))
      const projected: SessionTranscriptWindowPage = {
        ...page,
        record: commit.record,
        revision: commit.revision,
        messages,
        payloadBytes: count === page.messages.length ? page.payloadBytes : null,
        threads: page.threads.filter((thread) => ids.has(thread.threadId)),
        anchor: messageAnchor(messages[0]),
        older: page.older ? { ...page.older, revision: commit.revision } : null,
        newer: page.newer ? { ...page.newer, revision: commit.revision } : null,
      }
      projected.newer = cursorAt(projected, messages[messages.length - 1], 'after', limit, maxBytes)
      retained.push(projected)
    }
    if (index >= 0) {
      found = true
      break
    }
  }
  if (!found && pages.length > 0) throw new SessionTranscriptWindowError('The shared branch anchor is not loaded')
  return retained
}

function loadedAnchor(
  state: SessionTranscriptWindowState,
  origin: SessionTranscriptOrigin
): SessionTranscriptAnchor | null {
  if (origin === 'head' || origin === 'tail') {
    if (state.pages.length === 0 || (origin === 'head' ? state.hasOlder : state.hasNewer)) return null
    const row = origin === 'head' ? state.rows[0] : state.rows.at(-1)
    return row ? messageAnchor(row) : state.pages[0].anchor
  }
  if ('messageId' in origin) {
    const row = state.rows.find((candidate) => candidate.messageId === origin.messageId)
    return row ? messageAnchor(row) : null
  }
  const thread = state.threads.find((candidate) => candidate.threadId === origin.threadId)
  if (!thread) return null
  const id = origin.edge === 'head' ? thread.rootMessageId : thread.activeLeafMessageId
  if (id === null) return { threadId: thread.threadId, messageId: null }
  const row = state.rows.find((candidate) => candidate.threadId === thread.threadId && candidate.messageId === id)
  return row ? messageAnchor(row) : null
}

function layoutKind(origin: SessionTranscriptOrigin): SessionTranscriptLayoutRequest['kind'] {
  if (origin === 'head' || origin === 'tail') return origin
  return 'edge' in origin && origin.edge === 'tail' && origin.align !== 'center' ? 'tail' : 'anchor'
}

function navigationOrigin(origin: SessionTranscriptOrigin): SessionTranscriptOrigin {
  return typeof origin === 'object' && ('messageId' in origin || origin.edge === 'head')
    ? { ...origin, align: 'center' }
    : origin
}

/** Owns one mounted conversation's loaded pages and asynchronous navigation. */
export class SessionTranscriptWindowController {
  private readonly maxBytes: number
  private state: SessionTranscriptWindowState
  private sequence = 0
  private readonly listeners = new Set<() => void>()
  private liveNotification: ReturnType<typeof setTimeout> | null = null
  private retryIntent: (() => Promise<boolean>) | null = null
  private pendingNavigation: {
    owner?: object
    origin: SessionTranscriptOrigin
    layout?: {
      kind: SessionTranscriptLayoutRequest['kind']
      anchor?: SessionTranscriptLayoutRequest['anchor']
      rebase?: boolean
    }
  } | null = null
  private pendingBranch: {
    commit: SessionTranscriptBranchCommit
    anchor: SessionTranscriptLayoutRequest['anchor']
  } | null = null
  private browseProgress: { older?: number; newer?: number } = {}

  constructor(private readonly options: SessionTranscriptWindowOptions) {
    if (!Number.isSafeInteger(options.pageSize) || options.pageSize < 1)
      throw new SessionTranscriptWindowError('Page size must be a positive integer')
    this.maxBytes = options.maxBytes ?? DEFAULT_TRANSCRIPT_PAGE_BYTES
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1)
      throw new SessionTranscriptWindowError('Page byte budget must be a positive integer')
    this.state = initialState(options.sessionId, options.pageSize, this.maxBytes)
  }

  getSnapshot = (): SessionTranscriptWindowState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) this.cancelLiveNotification()
    }
  }

  private cancelLiveNotification(): void {
    if (this.liveNotification === null) return
    clearTimeout(this.liveNotification)
    this.liveNotification = null
  }

  private publish(state: SessionTranscriptWindowState, deferLiveNotification = false): void {
    this.state = state
    if (deferLiveNotification) {
      if (this.liveNotification === null && this.listeners.size) {
        this.liveNotification = setTimeout(() => {
          this.liveNotification = null
          for (const listener of this.listeners) listener()
        }, 16)
      }
      return
    }
    this.cancelLiveNotification()
    for (const listener of this.listeners) listener()
  }

  private begin(kind: SessionTranscriptOperation['kind'], branchOperationId?: number): number {
    const requestId = ++this.sequence
    this.retryIntent = null
    this.pendingNavigation = null
    this.pendingBranch = null
    this.publish({
      ...this.state,
      layout: null,
      operation: {
        requestId,
        kind,
        phase: 'reading',
        ...(kind === 'branch' ? { branchOperationId: branchOperationId ?? requestId } : {}),
      },
    })
    return requestId
  }

  private validate(page: SessionTranscriptPage | null, expectedRevision?: number): SessionTranscriptPage {
    if (!page) throw new SessionTranscriptWindowError('Conversation no longer exists')
    if (page.record.id !== this.options.sessionId || page.messages.length > this.options.pageSize)
      throw new SessionTranscriptWindowError('The response does not belong to this window')
    if (expectedRevision !== undefined && page.revision !== expectedRevision)
      throw new SessionRowConflictError(this.options.sessionId, expectedRevision, page.revision)
    const ids = new Set<string>()
    for (const row of page.messages) {
      if (row.sessionId !== this.options.sessionId || ids.has(row.messageId))
        throw new SessionTranscriptWindowError('The response contains invalid message identities')
      ids.add(row.messageId)
    }
    for (const cursor of [page.older, page.newer]) {
      if (
        cursor &&
        (cursor.sessionId !== this.options.sessionId ||
          cursor.revision !== page.revision ||
          cursor.limit !== this.options.pageSize ||
          cursor.maxBytes !== this.maxBytes ||
          cursor.scope !== 'transcript')
      )
        throw new SessionTranscriptWindowError('The response cursor does not match this window')
    }
    if (
      !Number.isSafeInteger(page.payloadBytes) ||
      page.payloadBytes < 0 ||
      (page.payloadBytes > this.maxBytes && page.messages.length > 1)
    )
      throw new SessionTranscriptWindowError('The response exceeds the page byte budget')
    return page
  }

  private finishLayout(
    requestId: number,
    pages: readonly SessionTranscriptWindowPage[],
    layout: Omit<SessionTranscriptLayoutRequest, 'requestId'>,
    operation = this.state.operation
  ): void {
    this.pendingNavigation ??= {
      origin:
        layout.kind === 'tail'
          ? { threadId: layout.anchor.threadId, edge: 'tail' }
          : layout.anchor.messageId
            ? { messageId: layout.anchor.messageId }
            : { threadId: layout.anchor.threadId, edge: 'head' },
      layout: { kind: layout.kind, anchor: layout.anchor },
    }
    const mounted = new Map(this.state.rows.map((row) => [row.messageId, row]))
    const visiblePages =
      pages === this.state.pages
        ? pages
        : pages.map((page) => {
            let changed = false
            const messages = page.messages.map((row) => {
              const live = mounted.get(row.messageId)
              if (
                live?.threadId === row.threadId &&
                live.message !== row.message &&
                live.message.generating &&
                row.message.generating
              ) {
                changed = true
                return { ...row, message: live.message }
              }
              return row
            })
            return changed ? { ...page, messages, payloadBytes: null } : page
          })
    this.publish({
      ...withPages(this.state, visiblePages),
      windowEpoch: layout.rebase ? requestId : this.state.windowEpoch,
      operation: {
        requestId,
        kind: operation?.kind ?? 'navigate',
        phase: 'layout',
        ...(operation?.branchOperationId !== undefined ? { branchOperationId: operation.branchOperationId } : {}),
      },
      layout: { ...layout, requestId },
    })
  }

  private fail(requestId: number, error: unknown): false {
    if (requestId === this.sequence) {
      const newerRevision =
        error instanceof SessionRowConflictError &&
        error.sessionId === this.options.sessionId &&
        error.expectedRevision !== null &&
        error.actualRevision !== null &&
        error.actualRevision > error.expectedRevision
      if (!newerRevision) {
        this.pendingNavigation = null
        this.pendingBranch = null
      }
      this.publish({
        ...this.state,
        layout: null,
        operation: {
          requestId,
          kind: this.state.operation?.kind ?? 'open',
          ...(this.state.operation?.branchOperationId !== undefined
            ? { branchOperationId: this.state.operation.branchOperationId }
            : {}),
          phase: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        },
      })
    }
    return false
  }

  private async replace(
    origin: SessionTranscriptOrigin,
    kind: 'open' | 'navigate' | 'branch',
    revision?: number,
    layout?: {
      kind: SessionTranscriptLayoutRequest['kind']
      anchor?: SessionTranscriptLayoutRequest['anchor']
      rebase?: boolean
    },
    branchOperationId?: number,
    owner?: object
  ): Promise<boolean> {
    const requestId = this.begin(kind, branchOperationId)
    const branchId = this.state.operation?.branchOperationId
    this.pendingNavigation = { origin, layout, owner }
    this.browseProgress = {}
    this.retryIntent = () => this.replace(origin, kind, revision, layout, branchId, owner)
    try {
      const result = await this.options.source.readTranscriptWindow({
        sessionId: this.options.sessionId,
        limit: this.options.pageSize,
        maxBytes: this.maxBytes,
        origin,
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      })
      if (requestId !== this.sequence) return false
      const page = this.validate(result, revision)
      this.finishLayout(requestId, [page], {
        kind:
          layout?.kind ??
          (typeof origin === 'object' && 'messageId' in origin && origin.align !== 'center'
            ? 'head'
            : layoutKind(origin)),
        anchor: layout?.anchor ?? page.anchor,
        rebase: layout?.rebase ?? true,
      })
      return true
    } catch (error) {
      if (requestId === this.sequence && error instanceof SessionRowConflictError)
        this.retryIntent = () => this.replace(origin, kind, undefined, layout, branchId, owner)
      return this.fail(requestId, error)
    }
  }

  open = (origin: SessionTranscriptOrigin = 'tail'): Promise<boolean> => {
    this.close()
    return this.replace(navigationOrigin(origin), 'open')
  }

  /** Search opens a page centered on the target, including when the target is already loaded. */
  openSearch = (messageId: string): Promise<boolean> => this.replace({ messageId, align: 'center' }, 'navigate')

  private recoverVisibleAnchor(branchOperationId?: number): Promise<boolean> {
    const anchor =
      this.options.captureAnchor?.() ??
      (this.state.rows[0]
        ? {
            ...messageAnchor(this.state.rows[0]),
            offset: 0,
          }
        : null)
    const kind = branchOperationId === undefined ? 'navigate' : 'branch'
    return anchor?.messageId
      ? this.replace({ messageId: anchor.messageId }, kind, undefined, { kind: 'preserve', anchor }, branchOperationId)
      : this.replace(
          anchor ? { threadId: anchor.threadId, edge: 'head' } : 'tail',
          kind,
          undefined,
          undefined,
          branchOperationId
        )
  }

  private retainRevision(commit: SessionRowCommit): void {
    const pages = this.state.pages.map((page) => ({
      ...page,
      record: commit.record,
      revision: commit.revision,
      older: page.older ? { ...page.older, revision: commit.revision } : null,
      newer: page.newer ? { ...page.newer, revision: commit.revision } : null,
    }))
    this.publish({ ...withPages(this.state, pages), revision: commit.revision })
  }

  /** Resume a projected read or refresh the mounted window after a structural commit. */
  refresh = (
    removedMessages: readonly string[] = [],
    removedThreads: readonly string[] = [],
    contentCommit?: SessionRowCommit
  ): Promise<boolean> => {
    const operation = this.state.operation
    const error = operation?.phase === 'error' ? operation.error : null
    if (
      contentCommit?.record.id === this.options.sessionId &&
      this.state.revision === contentCommit.revision &&
      !removedMessages.length &&
      !removedThreads.length &&
      (operation?.kind === 'older' || operation?.kind === 'newer') &&
      (operation.phase === 'reading' ||
        (error instanceof SessionRowConflictError &&
          error.sessionId === this.options.sessionId &&
          error.expectedRevision !== null &&
          error.actualRevision !== null &&
          error.actualRevision > error.expectedRevision &&
          error.actualRevision <= contentCommit.revision))
    )
      return this.readContinuation(operation.kind)
    if (
      this.pendingBranch &&
      contentCommit &&
      this.state.revision === contentCommit.revision &&
      !removedMessages.length &&
      !removedThreads.length
    ) {
      const { commit, anchor } = this.pendingBranch
      const base = {
        ...contentCommit,
        previousRevision: commit.previousRevision,
        sharedPrefixEnd: commit.sharedPrefixEnd,
      }
      const nextCommit: SessionTranscriptBranchCommit = commit.cursor
        ? { ...base, cursor: { ...commit.cursor, revision: contentCommit.revision } }
        : { ...base, origin: commit.origin }
      const prefix = projectPrefix(
        this.state.pages,
        commit.sharedPrefixEnd,
        contentCommit,
        this.options.pageSize,
        this.maxBytes
      )
      const requestId = this.begin('branch', operation?.branchOperationId)
      this.retainRevision(contentCommit)
      return this.readBranch(requestId, nextCommit, prefix, anchor)
    }
    const messages = new Set(removedMessages)
    const threads = new Set(removedThreads)
    const pending = this.pendingNavigation
    if (pending) {
      const targetId =
        typeof pending.origin === 'object' && 'messageId' in pending.origin ? pending.origin.messageId : undefined
      const targetThread =
        typeof pending.origin === 'object' && 'threadId' in pending.origin
          ? pending.origin.threadId
          : targetId
            ? (pending.layout?.anchor?.threadId ?? this.state.rows.find((row) => row.messageId === targetId)?.threadId)
            : undefined
      if ((!targetId || !messages.has(targetId)) && (!targetThread || !threads.has(targetThread))) {
        const layout =
          pending.layout && !targetId ? { kind: pending.layout.kind, rebase: pending.layout.rebase } : pending.layout
        return this.replace(
          pending.origin,
          operation?.kind === 'branch' ? 'branch' : 'navigate',
          undefined,
          layout,
          operation?.branchOperationId,
          pending.owner
        )
      }
    }
    if (!removedMessages.length && !removedThreads.length) return this.recoverVisibleAnchor()
    const captured = this.options.captureAnchor?.()
    if (captured && !threads.has(captured.threadId) && captured.messageId && !messages.has(captured.messageId))
      return this.replace({ messageId: captured.messageId }, 'navigate', undefined, {
        kind: 'preserve',
        anchor: captured,
        rebase: false,
      })
    const surviving = this.state.rows.find((row) => !threads.has(row.threadId) && !messages.has(row.messageId))
    return this.replace(surviving ? { messageId: surviving.messageId } : 'tail', 'navigate', undefined, {
      kind: surviving ? 'anchor' : 'tail',
      rebase: false,
    })
  }

  /** Live generation owns only rows that are currently displayed. */
  updateMessage = (messageId: string, updater: Updater<Message>): void => {
    let changed = false
    let generating = true
    const pages = this.state.pages.map((page) => {
      if (!page.messages.some((row) => row.messageId === messageId)) return page
      changed = true
      return {
        ...page,
        payloadBytes: null,
        messages: page.messages.map((row) => {
          if (row.messageId !== messageId) return row
          const message = typeof updater === 'function' ? updater(row.message) : { ...row.message, ...updater }
          generating &&= message.generating === true
          return { ...row, message }
        }),
      }
    })
    // Apply every chunk immediately; notify mounted views once the stream yields to the host event loop.
    if (changed) this.publish({ ...this.state, pages, rows: pages.flatMap((page) => page.messages) }, generating)
  }

  private projectMetadata(
    metadata: readonly MessageRowMetadata[],
    threads: readonly SessionTranscriptThread[],
    content?: { rows: readonly MessageRow[]; preserveLive: boolean }
  ): readonly SessionTranscriptWindowPage[] {
    if (!metadata.length && !threads.length && !content?.rows.length) return this.state.pages
    const updates = new Map(metadata.map((row) => [row.messageId, row]))
    const bodies = new Map(content?.rows.map((row) => [row.messageId, row]) ?? [])
    const threadUpdates = new Map(threads.map((thread) => [thread.threadId, projectThread(thread)]))
    const pages = this.state.pages.map((page) => {
      let bodyChanged = false
      const messages = page.messages.map((row) => {
        const body = bodies.get(row.messageId)
        const update = updates.get(row.messageId) ?? body
        if (!update) return row
        const message =
          body && !(content?.preserveLive && row.message.generating && body.message.generating)
            ? body.message
            : row.message
        bodyChanged ||= message !== row.message
        return { ...update, message }
      })
      return {
        ...page,
        payloadBytes: bodyChanged ? null : page.payloadBytes,
        threads: page.threads.map((thread) => threadUpdates.get(thread.threadId) ?? thread),
        messages,
      }
    })
    return pages
  }

  /** Projects committed points before structural navigation retains their prefix. */
  updateMetadata = (
    metadata: readonly MessageRowMetadata[],
    threads: readonly SessionTranscriptThread[],
    content?: { rows: readonly MessageRow[]; preserveLive: boolean }
  ): void => {
    const pages = this.projectMetadata(metadata, threads, content)
    if (pages !== this.state.pages) this.publish(withPages(this.state, pages))
  }

  /** Project committed message removals into the mounted pages without navigating. */
  applyRemovals = (commit: SessionCommandDelta): boolean => {
    const diff = commit.diff
    if (
      !diff.messages.delete.length ||
      commit.structureResult?.navigation ||
      commit.record.id !== this.options.sessionId ||
      this.state.revision !== commit.previousRevision ||
      !this.state.pages.length ||
      diff.threads.delete.length ||
      diff.deleteSessionMessages ||
      diff.deleteArchivedThreads ||
      diff.deleteThreadMessages?.length ||
      diff.deleteSubtrees?.length ||
      diff.insertParents?.length ||
      diff.expandForks?.length ||
      commit.appendedMessageIds.length
    )
      return false
    const removed = new Set(diff.messages.delete)
    const bodies = new Map(diff.messages.upsert.map((row) => [row.messageId, row]))
    const metadata = new Map(diff.messageMetadataUpsert?.map((row) => [row.messageId, row]) ?? [])
    const replacements = new Map(
      diff.replaceMessagePivots?.map((row) => [row.messageId, row.replacementMessageId]) ?? []
    )
    const threads = new Map(diff.threads.upsert.map((thread) => [thread.threadId, projectThread(thread)]))
    const pages = this.state.pages.map(
      (page): SessionTranscriptWindowPage => ({
        ...page,
        record: commit.record,
        revision: commit.revision,
        payloadBytes: null,
        threads: page.threads.map((thread) => threads.get(thread.threadId) ?? thread),
        messages: page.messages.flatMap((original) => {
          if (removed.has(original.messageId)) {
            const replacementId = replacements.get(original.messageId)
            const replacement = replacementId ? bodies.get(replacementId) : undefined
            return replacement ? [replacement] : []
          }
          let row = original
          for (const shift of diff.siblingShifts ?? [])
            if (
              original.threadId === shift.threadId &&
              original.parentMessageId === shift.parentMessageId &&
              original.siblingOrder > shift.afterSiblingOrder
            )
              row = { ...row, siblingOrder: row.siblingOrder + shift.delta }
          for (const reparent of diff.reparentChildren ?? [])
            if (original.threadId === reparent.threadId && original.parentMessageId === reparent.parentMessageId)
              row = {
                ...row,
                parentMessageId: reparent.newParentMessageId,
                siblingOrder: original.siblingOrder + reparent.siblingOrderOffset,
                ...('branchId' in reparent ? { branchId: reparent.branchId } : {}),
              }
          for (const replacement of diff.replaceMessagePivots ?? [])
            if (original.threadId === replacement.threadId)
              row = {
                ...row,
                parentMessageId:
                  original.parentMessageId === replacement.messageId
                    ? replacement.replacementMessageId
                    : row.parentMessageId,
                activeChildId:
                  original.activeChildId === replacement.messageId
                    ? replacement.replacementMessageId
                    : row.activeChildId,
              }
          const body = bodies.get(row.messageId)
          const update = metadata.get(row.messageId) ?? body
          return [{ ...(update ?? row), message: body?.message ?? row.message }]
        }),
      })
    )
    const retained = pages.filter((page) => page.messages.length > 0)
    this.removalHasOlder = this.state.hasOlder
    if (!retained.length)
      retained.push({
        ...pages[0],
        messages: [],
        anchor: { threadId: pages[0].anchor.threadId, messageId: null },
        older: null,
        newer: null,
      })
    for (let index = 0; index < retained.length; index++) {
      const page = retained[index]
      const first = page.messages[0]
      const last = page.messages.at(-1)
      page.older =
        first && (index > 0 || this.state.hasOlder)
          ? cursorAt(page, first, 'before', this.options.pageSize, this.maxBytes)
          : null
      page.newer =
        last && (index < retained.length - 1 || this.state.hasNewer)
          ? cursorAt(page, last, 'after', this.options.pageSize, this.maxBytes)
          : null
      if (removed.has(page.anchor.messageId ?? '')) page.anchor = first ? messageAnchor(first) : page.anchor
    }
    this.sequence += 1
    this.pendingNavigation = null
    this.pendingBranch = null
    this.retryIntent = null
    this.browseProgress = {}
    const lastPage = retained[retained.length - 1]
    const lastRow = lastPage.messages.at(-1)
    const lastThread = lastPage.threads.find(
      (thread) => thread.threadId === (lastRow?.threadId ?? lastPage.anchor.threadId)
    )
    this.removalReadTarget = this.state.hasNewer
      ? null
      : (lastRow?.activeChildId ?? (!lastRow ? (lastThread?.activeLeafMessageId ?? null) : null))
    if (this.removalReadTarget && lastRow)
      lastPage.newer = cursorAt(lastPage, lastRow, 'after', this.options.pageSize, this.maxBytes)
    this.publish({ ...withPages(this.state, retained), operation: null, layout: null })
    return true
  }

  private removalHasOlder = false
  private removalReadTarget: string | null = null

  rejectRemovalProjection = (): void => {
    const requestId = this.begin('navigate')
    this.retryIntent = () => this.open('tail')
    this.fail(
      requestId,
      new SessionTranscriptWindowError('The loaded conversation is out of date. Retry to load the committed messages.')
    )
  }

  /** A deletion may expose an uncached selected sibling or the sole loaded row's parent. */
  completeRemovals = async (
    read: (request: SessionBranchMessagesRequest) => Promise<SessionBranchMessagesPage | null>
  ): Promise<boolean> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = this.state
      const last = state.rows.at(-1)
      const thread = state.threads.find(
        (thread) => thread.threadId === (last?.threadId ?? state.pages[0]?.anchor.threadId)
      )
      const firstId = last?.activeChildId ?? (!last ? thread?.activeLeafMessageId : null)
      if (
        (state.hasNewer && firstId !== this.removalReadTarget) ||
        !firstId ||
        state.rows.some((row) => row.messageId === firstId) ||
        !thread ||
        state.operation
      )
        return true
      const revision = state.revision
      if (revision === null) return false
      const sequence = this.sequence
      try {
        const next = await read({
          sessionId: this.options.sessionId,
          firstMessageId: firstId,
          expectedRevision: revision,
          limit: this.options.pageSize,
          maxBytes: this.maxBytes,
        })
        if (this.state.revision !== revision) continue
        if (this.sequence !== sequence) return false
        if (
          !next ||
          next.revision !== revision ||
          next.firstMessageId !== firstId ||
          next.record.id !== this.options.sessionId ||
          next.messages.length > this.options.pageSize ||
          next.threadId !== thread.threadId
        )
          throw new SessionTranscriptWindowError('Removal neighbor does not match the mounted conversation')
        const pages = this.state.pages.map((page) => ({ ...page, messages: [...page.messages] }))
        let tail = pages[pages.length - 1]
        const bytes = (row: MessageRow) => new TextEncoder().encode(JSON.stringify(row.message)).length
        let tailBytes = tail.messages.reduce((sum, row) => sum + bytes(row), 0)
        const known = new Set(state.rows.map((row) => row.messageId))
        for (const row of next.messages) {
          if (known.has(row.messageId) || row.threadId !== thread.threadId || row.sessionId !== this.options.sessionId)
            throw new SessionTranscriptWindowError('Removal neighbor repeated a loaded message')
          known.add(row.messageId)
          const size = bytes(row)
          if (
            tail.messages.length >= this.options.pageSize ||
            (tail.messages.length > 0 && tailBytes + size > this.maxBytes)
          ) {
            tail = { ...tail, messages: [], anchor: messageAnchor(row) }
            pages.push(tail)
            tailBytes = 0
          }
          tail.messages.push(row)
          tailBytes += size
        }
        for (let index = 0; index < pages.length; index++) {
          const page = pages[index]
          const first = page.messages[0]
          const end = page.messages.at(-1)
          page.older =
            first && (index > 0 || state.hasOlder || this.removalHasOlder)
              ? cursorAt(page, first, 'before', this.options.pageSize, this.maxBytes)
              : null
          page.newer =
            end && (index < pages.length - 1 || next.nextCursor)
              ? cursorAt(page, end, 'after', this.options.pageSize, this.maxBytes)
              : null
        }
        this.removalReadTarget = null
        this.publish(withPages(this.state, pages))
        return true
      } catch (error) {
        if (this.state.revision !== revision) continue
        if (this.sequence !== sequence) return false
        const requestId = this.begin('newer')
        this.retryIntent = () => {
          this.publish({ ...this.state, operation: null })
          return this.completeRemovals(read)
        }
        return this.fail(requestId, error)
      }
    }
    return false
  }

  /** Apply complete thread changes to the mounted pages at their committed revision. */
  applyThreadCommit = (commit: SessionCommandDelta): boolean => {
    if (
      commit.record.id !== this.options.sessionId ||
      this.state.revision !== commit.previousRevision ||
      !this.state.pages.length
    )
      return false
    const diff = commit.diff
    const removed = new Set(diff.threads.delete)
    const cleared = new Set(diff.deleteThreadMessages ?? [])
    const active = diff.threads.upsert.find((thread) => thread.threadId === commit.record.activeThreadId)
    const appended = new Set(commit.appendedMessageIds)
    const created =
      active &&
      active.threadId !== this.state.pages[0].record.activeThreadId &&
      diff.messages.upsert.some((row) => row.threadId === active.threadId && appended.has(row.messageId))
    if (!created && !cleared.size && !removed.size) return false

    const threads = new Map(this.state.threads.map((thread) => [thread.threadId, thread]))
    for (const thread of diff.threads.upsert) threads.set(thread.threadId, projectThread(thread))
    for (const id of removed) threads.delete(id)
    const bodies = new Map(diff.messages.upsert.map((row) => [row.messageId, row]))
    const metadata = new Map(diff.messageMetadataUpsert?.map((row) => [row.messageId, row]) ?? [])
    const deletedMessages = new Set(diff.messages.delete)
    let pages: SessionTranscriptWindowPage[] = this.state.pages.map((page) => {
      const messages = page.messages.flatMap((row) => {
        if (removed.has(row.threadId) || cleared.has(row.threadId) || deletedMessages.has(row.messageId)) return []
        const body = bodies.get(row.messageId)
        const update = metadata.get(row.messageId)
        return [body ?? (update ? { ...update, message: row.message } : row)]
      })
      const unchanged =
        messages.length === page.messages.length &&
        messages.every((row, index) => row.message === page.messages[index].message)
      return {
        ...page,
        record: commit.record,
        revision: commit.revision,
        payloadBytes: unchanged ? page.payloadBytes : null,
        messages,
      }
    })
    const known = new Set(pages.flatMap((page) => page.messages.map((row) => row.messageId)))
    const added = diff.messages.upsert.filter(
      (row) => !removed.has(row.threadId) && !known.has(row.messageId) && (created || cleared.has(row.threadId))
    )
    // A historical window cannot be joined across messages it has not loaded.
    const retain = !created || !this.state.hasNewer
    pages = retain ? pages.filter((page) => page.messages.length > 0) : []
    for (const row of added) {
      let page = pages.at(-1)
      const bytes = new TextEncoder().encode(JSON.stringify(row.message)).length
      if (
        !page ||
        page.messages.length >= this.options.pageSize ||
        (page.messages.length > 0 && (page.payloadBytes ?? this.maxBytes) + bytes > this.maxBytes)
      ) {
        page = {
          record: commit.record,
          revision: commit.revision,
          messages: [],
          threads: [],
          payloadBytes: 0,
          anchor: messageAnchor(row),
          older: null,
          newer: null,
        }
        pages.push(page)
      }
      page.messages = [...page.messages, row]
      page.payloadBytes = (page.payloadBytes ?? 0) + bytes
    }
    for (const page of pages)
      page.payloadBytes ??= page.messages.reduce(
        (sum, row) => sum + new TextEncoder().encode(JSON.stringify(row.message)).length,
        0
      )
    const target = threads.get(commit.record.activeThreadId)
    if (!pages.length) {
      // An uncached surviving thread is loaded atomically by the navigation path.
      if (!target || target.rootMessageId !== null) return false
      pages = [
        {
          record: commit.record,
          revision: commit.revision,
          messages: [],
          threads: [target],
          payloadBytes: 0,
          anchor: { threadId: target.threadId, messageId: null },
          older: null,
          newer: null,
        },
      ]
    }
    const last = pages.at(-1)!.messages.at(-1)
    const hasNewer = !created && this.state.hasNewer && last?.messageId !== target?.activeLeafMessageId
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]
      const ids = new Set(page.messages.map((row) => row.threadId))
      if (index === pages.length - 1 && target?.rootMessageId === null && !hasNewer) ids.add(target.threadId)
      page.threads = [...threads.values()].filter((thread) => ids.has(thread.threadId))
      const first = page.messages[0]
      const end = page.messages.at(-1)
      if (first) page.anchor = messageAnchor(first)
      page.older =
        first && (index > 0 || this.state.hasOlder || !retain)
          ? cursorAt(page, first, 'before', this.options.pageSize, this.maxBytes)
          : null
      if (
        !first &&
        target?.rootMessageId === null &&
        this.state.hasOlder &&
        removed.has(this.state.pages[0].record.activeThreadId)
      ) {
        page.older = {
          sessionId: this.options.sessionId,
          revision: commit.revision,
          threadId: target.threadId,
          threadOrder: target.threadOrder,
          messageId: null,
          direction: 'before',
          scope: 'transcript',
          limit: this.options.pageSize,
          maxBytes: this.maxBytes,
        }
      }
      page.newer =
        end && (index < pages.length - 1 || hasNewer)
          ? cursorAt(page, end, 'after', this.options.pageSize, this.maxBytes)
          : null
    }
    const captured = this.options.captureAnchor?.()
    const anchor =
      captured?.messageId && pages.some((page) => page.messages.some((row) => row.messageId === captured.messageId))
        ? captured
        : pages[0].anchor
    const requestId = this.begin('navigate')
    this.browseProgress = {}
    this.finishLayout(requestId, pages, {
      kind:
        created ||
        ((cleared.has(commit.record.activeThreadId) || removed.has(this.state.pages[0].record.activeThreadId)) &&
          !hasNewer)
          ? 'tail'
          : 'preserve',
      anchor: created ? messageAnchor(added.at(-1)!) : anchor,
    })
    return true
  }

  /** A newly committed branch contains its entire new chain and needs no body read. */
  applyCreatedBranch = (commit: SessionCommandDelta, preserveLive: boolean): boolean => {
    const navigation = commit.structureResult?.navigation
    if (
      navigation?.type !== 'branch' ||
      navigation.mode !== 'create' ||
      commit.record.id !== this.options.sessionId ||
      this.state.revision !== commit.previousRevision
    )
      return false
    const end = navigation.sharedPrefixEnd
    const thread = commit.diff.threads.upsert.find((item) => item.threadId === end.threadId)
    if (!thread) return false
    const bodies = new Map(commit.diff.messages.upsert.map((row) => [row.messageId, row]))
    const chain: MessageRow[] = []
    const identities = new Set<string>()
    let parentId = end.messageId
    for (const id of commit.appendedMessageIds) {
      const row = bodies.get(id)
      if (
        !row ||
        row.sessionId !== this.options.sessionId ||
        row.threadId !== end.threadId ||
        row.parentMessageId !== parentId ||
        identities.has(id)
      )
        return false
      chain.push(row)
      identities.add(id)
      parentId = id
    }
    if ((chain[0]?.messageId ?? null) !== navigation.firstMessageId || thread.activeLeafMessageId !== parentId)
      return false
    const hasPrefix = this.state.rows.some((row) => row.threadId === end.threadId && row.messageId === end.messageId)
    if (!hasPrefix && !chain.length) return false
    const captured = this.options.captureAnchor?.()
    const projected = this.projectMetadata(commit.diff.messageMetadataUpsert ?? [], commit.diff.threads.upsert, {
      rows: commit.diff.messages.upsert,
      preserveLive,
    })
    const prefix = hasPrefix ? projectPrefix(projected, end, commit, this.options.pageSize, this.maxBytes) : []
    const messages: MessageRow[] = []
    let payloadBytes = 0
    for (const row of chain) {
      const bytes = new TextEncoder().encode(JSON.stringify(row.message)).length
      if (messages.length >= this.options.pageSize || (messages.length > 0 && payloadBytes + bytes > this.maxBytes))
        break
      messages.push(row)
      payloadBytes += bytes
    }
    const page: SessionTranscriptWindowPage = {
      record: commit.record,
      revision: commit.revision,
      messages,
      payloadBytes,
      threads: [projectThread(thread)],
      anchor: messages.length ? messageAnchor(messages[0]) : end,
      older: null,
      newer: null,
    }
    const first = messages[0] ?? this.state.rows.find((row) => row.messageId === end.messageId)!
    const last = messages.at(-1) ?? first
    page.older = cursorAt(page, first, 'before', this.options.pageSize, this.maxBytes)
    if (messages.length < chain.length || thread.threadId !== commit.record.activeThreadId)
      page.newer = cursorAt(page, last, 'after', this.options.pageSize, this.maxBytes)
    const pages = messages.length ? [...prefix, page] : prefix
    if (!messages.length) {
      const tail = pages[pages.length - 1]
      tail.newer = page.newer
      tail.payloadBytes ??= tail.messages.reduce(
        (bytes, row) => bytes + new TextEncoder().encode(JSON.stringify(row.message)).length,
        0
      )
    }
    const anchor =
      captured?.messageId && prefix.some((entry) => entry.messages.some((row) => row.messageId === captured.messageId))
        ? captured
        : hasPrefix
          ? end
          : page.anchor
    const requestId = ++this.sequence
    this.retryIntent = null
    this.pendingNavigation = null
    this.pendingBranch = null
    this.browseProgress = {}
    this.finishLayout(
      requestId,
      pages,
      { kind: 'preserve', anchor },
      {
        requestId,
        kind: 'branch',
        phase: 'layout',
        branchOperationId: requestId,
      }
    )
    return true
  }

  applyRows = (
    commit: SessionRowCommit,
    previousRevision: number | null,
    rows: readonly MessageRow[],
    appendedIds: readonly string[],
    preserveLive: boolean
  ): boolean => {
    if (this.state.revision !== previousRevision || commit.record.id !== this.options.sessionId) return false
    const reading = this.state.operation?.phase === 'reading'
    const error = this.state.operation?.phase === 'error' ? this.state.operation.error : null
    const resolvedConflict =
      previousRevision !== null &&
      error instanceof SessionRowConflictError &&
      error.sessionId === this.options.sessionId &&
      error.expectedRevision !== null &&
      error.actualRevision !== null &&
      error.expectedRevision < error.actualRevision &&
      error.expectedRevision <= previousRevision &&
      error.actualRevision <= commit.revision
    const updates = new Map(rows.map((row) => [row.messageId, row]))
    const known = new Set(this.state.rows.map((row) => row.messageId))
    const append =
      !reading && !this.state.hasNewer
        ? appendedIds.flatMap((id) => {
            const row = updates.get(id)
            return row && !known.has(id) ? [row] : []
          })
        : []
    const pages: SessionTranscriptWindowPage[] = this.state.pages.map((page) => {
      let bodyChanged = false
      const messages = page.messages.map((row) => {
        const update = updates.get(row.messageId)
        if (!update) return row
        if (preserveLive && row.message.generating && update.message.generating)
          return { ...update, message: row.message }
        bodyChanged ||= update.message !== row.message
        return update
      })
      return {
        ...page,
        record: commit.record,
        revision: commit.revision,
        older: page.older ? { ...page.older, revision: commit.revision } : null,
        newer: page.newer ? { ...page.newer, revision: commit.revision } : null,
        payloadBytes: bodyChanged ? null : page.payloadBytes,
        messages,
      }
    })
    if (!pages.length) return false
    const tail = pages[pages.length - 1]
    if (append.length) {
      if (tail.payloadBytes === null && tail.messages.length < this.options.pageSize) return false
      const lastId = append[append.length - 1].messageId
      for (const page of pages)
        page.threads = page.threads.map((thread) =>
          thread.threadId === commit.record.activeThreadId
            ? {
                ...thread,
                activeLeafMessageId: lastId,
                rootMessageId:
                  thread.rootMessageId ??
                  append.find((row) => row.threadId === thread.threadId && row.parentMessageId === null)?.messageId ??
                  null,
              }
            : thread
        )
      for (const row of append) {
        const bytes = new TextEncoder().encode(JSON.stringify(row.message)).length
        let page = pages[pages.length - 1]
        if (
          page.messages.length >= this.options.pageSize ||
          (page.messages.length > 0 && (page.payloadBytes ?? 0) + bytes > this.maxBytes)
        ) {
          page = {
            ...page,
            anchor: messageAnchor(row),
            messages: [],
            payloadBytes: 0,
            older: cursorAt(page, row, 'before', this.options.pageSize, this.maxBytes),
          }
          pages.push(page)
        }
        page.messages = [...page.messages, row]
        page.payloadBytes = (page.payloadBytes ?? 0) + bytes
      }
      for (let index = 0; index < pages.length - 1; index++) {
        const page = pages[index]
        page.newer = cursorAt(
          page,
          page.messages[page.messages.length - 1],
          'after',
          this.options.pageSize,
          this.maxBytes
        )
      }
    } else if (appendedIds.length && tail.messages.length) {
      tail.newer = cursorAt(
        tail,
        tail.messages[tail.messages.length - 1],
        'after',
        this.options.pageSize,
        this.maxBytes
      )
    }
    this.publish(withPages(this.state, pages))
    return !reading && !resolvedConflict
  }

  navigate = async (
    origin: SessionTranscriptOrigin,
    expectedRevision?: number,
    options?: { forceRead?: boolean; owner?: object }
  ): Promise<boolean> => {
    origin = navigationOrigin(origin)
    const canReuse = !options?.forceRead && (expectedRevision === undefined || this.state.revision === expectedRevision)
    const anchor = canReuse ? loadedAnchor(this.state, origin) : null
    if (!anchor) return this.replace(origin, 'navigate', expectedRevision, undefined, undefined, options?.owner)
    const requestId = this.begin('navigate')
    this.pendingNavigation = { origin, layout: { kind: layoutKind(origin), anchor }, owner: options?.owner }
    this.browseProgress = {}
    this.retryIntent = null
    this.finishLayout(requestId, this.state.pages, { kind: layoutKind(origin), anchor })
    return true
  }

  /** Loads a branch whose shared prefix is outside the mounted window. */
  navigateBranch = (origin: SessionTranscriptOrigin, expectedRevision: number): Promise<boolean> =>
    this.replace(origin, 'branch', expectedRevision)

  viewThread = (threadId: string): Promise<boolean> => this.navigate({ threadId, edge: 'head' })

  showSwitchedThread = (commit: SessionRowCommit): Promise<boolean> => {
    if (commit.record.id !== this.options.sessionId) {
      return Promise.resolve(
        this.fail(
          this.begin('navigate'),
          new SessionTranscriptWindowError('The commit belongs to another conversation')
        )
      )
    }
    const origin = { threadId: commit.record.activeThreadId, edge: 'tail' as const }
    if (this.state.revision === commit.revision) return this.navigate(origin, commit.revision)
    this.retainRevision(commit)
    return this.replace(origin, 'navigate', commit.revision, { kind: 'tail', rebase: false })
  }

  private async extend(direction: 'older' | 'newer', progress?: number): Promise<boolean> {
    if (this.state.operation && this.state.operation.phase !== 'error') return false
    const page = direction === 'older' ? this.state.pages[0] : this.state.pages.at(-1)
    const cursor = page?.[direction]
    if (!page || !cursor || this.state.revision === null) return false
    if (progress !== undefined && this.browseProgress[direction] === progress) return false
    if (progress !== undefined) this.browseProgress[direction] = progress
    return this.readContinuation(direction)
  }

  private async readContinuation(direction: 'older' | 'newer'): Promise<boolean> {
    const page = direction === 'older' ? this.state.pages[0] : this.state.pages.at(-1)
    const cursor = page?.[direction]
    if (!page || !cursor || this.state.revision === null) return false
    const revision = this.state.revision
    const requestId = this.begin(direction)
    this.retryIntent = () => this.extend(direction)
    try {
      const result = await this.options.source.readTranscriptWindow({
        sessionId: this.options.sessionId,
        limit: this.options.pageSize,
        maxBytes: this.maxBytes,
        cursor,
        expectedRevision: revision,
      })
      if (requestId !== this.sequence) return false
      const next = this.validate(result, revision)
      const existing = new Set(this.state.rows.map((row) => row.messageId))
      if (next.messages.some((row) => existing.has(row.messageId)))
        throw new SessionTranscriptWindowError('A continuation repeated a loaded message')
      const anchor = this.options.captureAnchor?.() ?? null
      const pages = direction === 'older' ? [next, ...this.state.pages] : [...this.state.pages, next]
      this.finishLayout(requestId, pages, {
        kind: 'preserve',
        anchor: anchor ?? page.anchor,
      })
      return true
    } catch (error) {
      if (requestId === this.sequence && error instanceof SessionRowConflictError)
        this.retryIntent = () => this.recoverVisibleAnchor()
      return this.fail(requestId, error)
    }
  }

  /** Automatic edge callbacks must reuse a progress token until the user scrolls again. */
  loadOlder = (progress?: number): Promise<boolean> => this.extend('older', progress)
  /** Omit the progress token only for an explicit load action. */
  loadNewer = (progress?: number): Promise<boolean> => this.extend('newer', progress)

  applyBranchCommit = async (commit: SessionTranscriptBranchCommit): Promise<boolean> => {
    const requestId = this.begin('branch')
    try {
      if (commit.record.id !== this.options.sessionId || this.state.revision !== commit.previousRevision)
        throw new SessionTranscriptWindowError('The branch commit does not continue the loaded revision')
      const prefix = projectPrefix(
        this.state.pages,
        commit.sharedPrefixEnd,
        commit,
        this.options.pageSize,
        this.maxBytes
      )
      const captured = this.options.captureAnchor?.()
      this.retainRevision(commit)
      const anchor =
        captured?.messageId && prefix.some((page) => page.messages.some((row) => row.messageId === captured.messageId))
          ? captured
          : commit.sharedPrefixEnd
      return this.readBranch(requestId, commit, prefix, anchor)
    } catch (error) {
      return this.fail(requestId, error)
    }
  }

  private async readBranch(
    requestId: number,
    commit: SessionTranscriptBranchCommit,
    prefix: readonly SessionTranscriptWindowPage[],
    anchor: SessionTranscriptAnchor | SessionTranscriptViewportAnchor
  ): Promise<boolean> {
    this.pendingBranch = { commit, anchor }
    this.pendingNavigation = {
      origin: anchor.messageId ? { messageId: anchor.messageId } : { threadId: anchor.threadId, edge: 'head' },
      layout: { kind: 'preserve', anchor },
    }
    const branchOperationId = this.state.operation?.branchOperationId
    this.retryIntent = () => this.readBranch(this.begin('branch', branchOperationId), commit, prefix, anchor)
    try {
      const result = await this.options.source.readTranscriptWindow({
        sessionId: this.options.sessionId,
        limit: this.options.pageSize,
        maxBytes: this.maxBytes,
        ...(commit.cursor ? { cursor: commit.cursor } : { origin: commit.origin }),
        expectedRevision: commit.revision,
      })
      if (requestId !== this.sequence) return false
      const page = this.validate(result, commit.revision)
      const retained = new Set(prefix.flatMap((entry) => entry.messages.map((row) => row.messageId)))
      if (page.messages.some((row) => retained.has(row.messageId)))
        throw new SessionTranscriptWindowError('The selected branch repeated a shared message')
      const pages = [...prefix, page]
      this.browseProgress = {}
      this.finishLayout(requestId, pages, { kind: 'preserve', anchor })
      return true
    } catch (error) {
      if (requestId === this.sequence && error instanceof SessionRowConflictError)
        this.retryIntent = () => this.recoverVisibleAnchor(branchOperationId)
      return this.fail(requestId, error)
    }
  }

  acknowledgeLayout = (requestId: number): boolean => {
    if (this.state.layout?.requestId !== requestId || requestId !== this.sequence) return false
    this.retryIntent = null
    this.pendingNavigation = null
    this.pendingBranch = null
    this.publish({ ...this.state, layout: null, operation: null, firstWindowReady: true })
    return true
  }

  /** Cancels an owned navigation, including reads restarted by a content refresh. */
  cancelNavigation = (owner: object): boolean => {
    if (this.pendingNavigation?.owner !== owner) return false
    return this.cancelCurrentOperation()
  }

  /** User reading intent cancels navigation while keeping pagination and branch updates intact. */
  interruptNavigation = (): boolean => {
    if (this.state.operation?.kind !== 'navigate') return false
    return this.cancelCurrentOperation()
  }

  /** Gives an already loaded window back to user scrolling without completing the interrupted navigation. */
  cancelLayout = (requestId: number): boolean => {
    if (this.state.layout?.requestId !== requestId || requestId !== this.sequence) return false
    return this.cancelCurrentOperation()
  }

  private cancelCurrentOperation(): boolean {
    this.sequence += 1
    this.retryIntent = null
    this.pendingNavigation = null
    this.pendingBranch = null
    this.publish({ ...this.state, layout: null, operation: null })
    return true
  }

  rejectLayout = (requestId: number, error: unknown): void => {
    const layout = this.state.layout
    if (!layout || layout.requestId !== requestId || requestId !== this.sequence) return
    const branchOperationId = this.state.operation?.branchOperationId
    this.retryIntent = async () => {
      const next = this.begin(branchOperationId === undefined ? 'navigate' : 'branch', branchOperationId)
      this.finishLayout(next, this.state.pages, layout)
      return true
    }
    this.fail(requestId, error)
  }

  retry = (): Promise<boolean> =>
    this.state.operation?.phase === 'error' ? (this.retryIntent?.() ?? Promise.resolve(false)) : Promise.resolve(false)

  /** Invalidates pending reads and releases pages; a later open starts a fresh view. */
  close = (): void => {
    this.sequence += 1
    this.retryIntent = null
    this.pendingNavigation = null
    this.pendingBranch = null
    this.browseProgress = {}
    this.publish(initialState(this.options.sessionId, this.options.pageSize, this.maxBytes))
  }
}
