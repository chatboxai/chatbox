export type GenerationRuntimePhase = 'preparing' | 'streaming' | 'paused' | 'stopping'

export interface GenerationRuntimeState {
  readonly sessionId: string
  readonly messageId: string
  readonly phase: GenerationRuntimePhase
  readonly abortController: AbortController
}

export interface GenerationRuntimeStoreOptions {
  createAbortController?: () => AbortController
}

/**
 * Owns transient generation controls outside persisted Session/Message data.
 *
 * A Session can temporarily have multiple runtimes because alternative replies
 * intentionally bypass the per-session generation lock. A new runtime replaces
 * only an older runtime for the same message. Persisted messages expose
 * `generating` for recovery and rendering, while AbortControllers always remain
 * in this in-memory store.
 */
export class GenerationRuntimeStore {
  private readonly states = new Map<string, Map<string, GenerationRuntimeState>>()
  private readonly pendingAbortReasons = new Map<string, Map<string, unknown>>()
  private readonly unsettledStreamDrains = new Map<string, Set<Promise<void>>>()
  private readonly listeners = new Set<() => void>()
  private readonly createAbortController: () => AbortController
  private version = 0

  constructor(options: GenerationRuntimeStoreOptions = {}) {
    this.createAbortController = options.createAbortController ?? (() => new AbortController())
  }

  start(sessionId: string, messageId: string): GenerationRuntimeState {
    const sessionStates = this.getOrCreateSessionStates(sessionId)
    sessionStates.get(messageId)?.abortController.abort()
    const pendingAbortReasons = this.pendingAbortReasons.get(sessionId)
    const hasPendingAbort = pendingAbortReasons?.has(messageId) ?? false
    const pendingAbortReason = pendingAbortReasons?.get(messageId)
    if (hasPendingAbort) {
      pendingAbortReasons?.delete(messageId)
      if (pendingAbortReasons?.size === 0) this.pendingAbortReasons.delete(sessionId)
    }
    const state: GenerationRuntimeState = {
      sessionId,
      messageId,
      phase: 'preparing',
      abortController: this.createAbortController(),
    }
    if (hasPendingAbort) state.abortController.abort(pendingAbortReason)
    sessionStates.set(messageId, state)
    this.notify()
    return state
  }

  get(sessionId: string, messageId?: string): GenerationRuntimeState | undefined {
    const sessionStates = this.states.get(sessionId)
    if (!sessionStates) return undefined
    if (messageId !== undefined) return sessionStates.get(messageId)
    return [...sessionStates.values()].at(-1)
  }

  list(sessionId: string): readonly GenerationRuntimeState[] {
    return [...(this.states.get(sessionId)?.values() ?? [])]
  }

  getActiveMessageIds(sessionId: string): ReadonlySet<string> {
    return new Set(this.list(sessionId).map((runtime) => runtime.messageId))
  }

  /**
   * Abort an active runtime or remember the request for the placeholder window
   * before GenerationService registers its controller.
   */
  requestAbort(sessionId: string, messageId: string, reason?: unknown): void {
    if (this.abort(sessionId, messageId, reason)) return
    let pendingAbortReasons = this.pendingAbortReasons.get(sessionId)
    if (!pendingAbortReasons) {
      pendingAbortReasons = new Map()
      this.pendingAbortReasons.set(sessionId, pendingAbortReasons)
    }
    pendingAbortReasons.set(messageId, reason)
  }

  setPhase(
    sessionId: string,
    messageId: string,
    phase: GenerationRuntimePhase,
    expected?: GenerationRuntimeState
  ): GenerationRuntimeState | undefined {
    const current = this.getMatchingState(sessionId, messageId, expected)
    if (!current) return undefined
    if (current.phase === 'stopping') return current
    const next = { ...current, phase }
    this.states.get(sessionId)?.set(messageId, next)
    this.notify()
    return next
  }

  abort(sessionId: string, messageId?: string, reason?: unknown, expected?: GenerationRuntimeState): boolean {
    if (messageId === undefined) {
      const sessionStates = this.states.get(sessionId)
      const hadPendingAbort = this.pendingAbortReasons.delete(sessionId)
      if (sessionStates) {
        for (const state of sessionStates.values()) state.abortController.abort(reason)
        this.states.delete(sessionId)
      }
      if (sessionStates || hadPendingAbort) this.notify()
      return Boolean(sessionStates || hadPendingAbort)
    }
    const current = this.getMatchingState(sessionId, messageId, expected)
    if (!current) return false
    current.abortController.abort(reason)
    this.deleteState(sessionId, messageId)
    this.notify()
    return true
  }

  /**
   * Abort an active runtime for a removed message, or leave a one-shot tombstone
   * when registration has not happened yet.
   */
  discard(sessionId: string, messageId: string, reason?: unknown): boolean {
    let pendingAbortReasons = this.pendingAbortReasons.get(sessionId)
    const hadPendingAbort = pendingAbortReasons?.has(messageId) ?? false
    const current = this.states.get(sessionId)?.get(messageId)
    if (current) {
      current.abortController.abort(reason)
      this.deleteState(sessionId, messageId)
      pendingAbortReasons?.delete(messageId)
      if (pendingAbortReasons?.size === 0) this.pendingAbortReasons.delete(sessionId)
      this.notify()
    } else {
      if (!pendingAbortReasons) {
        pendingAbortReasons = new Map()
        this.pendingAbortReasons.set(sessionId, pendingAbortReasons)
      }
      pendingAbortReasons.set(messageId, reason)
    }
    return Boolean(current || hadPendingAbort)
  }

  /**
   * Abort a runtime while retaining it as a generation lock until the caller
   * settles the terminal Message write and explicitly clears it.
   */
  beginStop(
    sessionId: string,
    messageId: string,
    reason?: unknown,
    expected?: GenerationRuntimeState
  ): GenerationRuntimeState | undefined {
    const current = this.getMatchingState(sessionId, messageId, expected)
    if (!current || current.phase === 'paused') return undefined
    if (current.phase === 'stopping') return current

    const stopping = { ...current, phase: 'stopping' as const }
    this.states.get(sessionId)?.set(messageId, stopping)
    current.abortController.abort(reason)
    this.notify()
    return stopping
  }

  /**
   * Move a live runtime to a new message id while keeping its AbortController.
   *
   * A steering boundary finalizes the interrupted assistant segment and
   * continues the same provider run in a fresh continuation message; Stop and
   * phase changes must follow that continuation id from then on.
   */
  retarget(
    sessionId: string,
    fromMessageId: string,
    toMessageId: string,
    expected?: GenerationRuntimeState
  ): GenerationRuntimeState | undefined {
    const current = this.getMatchingState(sessionId, fromMessageId, expected)
    if (!current || current.phase === 'stopping') return undefined
    const sessionStates = this.states.get(sessionId)
    if (!sessionStates || sessionStates.has(toMessageId)) return undefined
    sessionStates.delete(fromMessageId)
    const next = { ...current, messageId: toMessageId }
    sessionStates.set(toMessageId, next)
    this.notify()
    return next
  }

  /**
   * Releases a finished active runtime while preserving a paused runtime for
   * the later continue/stop action.
   */
  finishActive(sessionId: string, messageId: string, expected?: GenerationRuntimeState): boolean {
    const current = this.getMatchingState(sessionId, messageId, expected)
    if (!current || current.phase === 'paused' || current.phase === 'stopping') return false
    this.deleteState(sessionId, messageId)
    this.notify()
    return true
  }

  clear(sessionId: string, messageId?: string, expected?: GenerationRuntimeState): boolean {
    if (messageId === undefined) {
      const deleted = this.states.delete(sessionId)
      if (deleted) this.notify()
      return deleted
    }
    const current = this.getMatchingState(sessionId, messageId, expected)
    if (!current) return false
    this.deleteState(sessionId, messageId)
    this.notify()
    return true
  }

  /**
   * Retain a provider stream that is still unwinding after Stop. Generation
   * entry points use this barrier even when they intentionally bypass the
   * normal per-session generation lock.
   */
  registerUnsettledStreamDrain(sessionId: string, drain: Promise<void>): void {
    let drains = this.unsettledStreamDrains.get(sessionId)
    if (!drains) {
      drains = new Set()
      this.unsettledStreamDrains.set(sessionId, drains)
    }
    drains.add(drain)
    const cleanup = () => {
      drains.delete(drain)
      if (drains.size === 0 && this.unsettledStreamDrains.get(sessionId) === drains) {
        this.unsettledStreamDrains.delete(sessionId)
      }
    }
    drain.then(cleanup, cleanup)
  }

  /** Resolves once every currently registered unsettled stream for a Session has drained. */
  waitForUnsettledStreamDrains(sessionId: string): Promise<void> | undefined {
    const drains = this.unsettledStreamDrains.get(sessionId)
    if (!drains || drains.size === 0) return undefined
    return Promise.all([...drains]).then(() => {})
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion(): number {
    return this.version
  }

  dispose(): void {
    const hadStates = this.states.size > 0 || this.pendingAbortReasons.size > 0
    for (const sessionStates of this.states.values()) {
      for (const state of sessionStates.values()) state.abortController.abort()
    }
    this.states.clear()
    this.pendingAbortReasons.clear()
    this.unsettledStreamDrains.clear()
    if (hadStates) this.notify()
    this.listeners.clear()
  }

  private getOrCreateSessionStates(sessionId: string): Map<string, GenerationRuntimeState> {
    let sessionStates = this.states.get(sessionId)
    if (!sessionStates) {
      sessionStates = new Map()
      this.states.set(sessionId, sessionStates)
    }
    return sessionStates
  }

  private getMatchingState(
    sessionId: string,
    messageId: string,
    expected?: GenerationRuntimeState
  ): GenerationRuntimeState | undefined {
    const current = this.states.get(sessionId)?.get(messageId)
    return current && (!expected || current.abortController === expected.abortController) ? current : undefined
  }

  private deleteState(sessionId: string, messageId: string): void {
    const sessionStates = this.states.get(sessionId)
    if (!sessionStates) return
    sessionStates.delete(messageId)
    if (sessionStates.size === 0) this.states.delete(sessionId)
  }

  private notify(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}
