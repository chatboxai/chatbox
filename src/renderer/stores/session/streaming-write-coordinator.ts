type QueuedCheckpoint = {
  run: () => Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

type WriteState = {
  cacheUpdates: Set<Promise<void>>
  inFlight?: Promise<void>
  pending?: QueuedCheckpoint
  terminalRequested: boolean
  terminal?: Promise<void>
}

/**
 * Bounds fire-and-forget streaming persistence without weakening terminal writes.
 * A key has at most one checkpoint writing and one latest checkpoint waiting.
 */
export class StreamingWriteCoordinator {
  private readonly states = new Map<string, WriteState>()

  scheduleCheckpoint(key: string, run: () => Promise<void>): Promise<void> {
    const state = this.getOrCreateState(key)
    if (state.terminalRequested) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      const checkpoint = { run, resolve, reject }
      if (state.inFlight) {
        // The latest snapshot contains all earlier streamed content. A replaced
        // checkpoint was intentionally coalesced, so its caller can settle.
        state.pending?.resolve()
        state.pending = checkpoint
        return
      }
      this.startCheckpoint(key, state, checkpoint)
    })
  }

  runCacheUpdate(key: string, run: () => Promise<void>): Promise<void> {
    const state = this.getOrCreateState(key)
    if (state.terminalRequested) return Promise.resolve()

    let task: Promise<void>
    try {
      task = run()
    } catch (error) {
      task = Promise.reject(error)
    }
    state.cacheUpdates.add(task)
    void task.then(
      () => this.finishCacheUpdate(key, state, task),
      () => this.finishCacheUpdate(key, state, task)
    )
    return task
  }

  isTerminalRequested(key: string): boolean {
    return this.states.get(key)?.terminalRequested === true
  }

  persistTerminal(key: string, run: () => Promise<void>): Promise<void> {
    const state = this.getOrCreateState(key)
    if (state.terminal) return state.terminal

    state.terminalRequested = true
    state.pending?.resolve()
    state.pending = undefined

    const inFlight = state.inFlight
    const terminal = (async () => {
      // A failed checkpoint must not prevent the authoritative terminal write.
      await inFlight?.catch(() => undefined)
      await run()
    })()
    state.terminal = terminal
    void terminal.then(
      () => this.finishTerminal(key, state, terminal),
      () => this.finishTerminal(key, state, terminal)
    )
    return terminal
  }

  private getOrCreateState(key: string): WriteState {
    const current = this.states.get(key)
    if (current) return current
    const created: WriteState = { cacheUpdates: new Set(), terminalRequested: false }
    this.states.set(key, created)
    return created
  }

  private startCheckpoint(key: string, state: WriteState, checkpoint: QueuedCheckpoint): void {
    let task: Promise<void>
    try {
      task = checkpoint.run()
    } catch (error) {
      task = Promise.reject(error)
    }
    state.inFlight = task
    void task.then(checkpoint.resolve, checkpoint.reject)
    void task.then(
      () => this.finishCheckpoint(key, state, task),
      () => this.finishCheckpoint(key, state, task)
    )
  }

  private finishCheckpoint(key: string, state: WriteState, task: Promise<void>): void {
    if (state.inFlight !== task) return
    state.inFlight = undefined
    if (state.terminalRequested) return

    const pending = state.pending
    state.pending = undefined
    if (pending) {
      this.startCheckpoint(key, state, pending)
    } else {
      this.deleteStateIfIdle(key, state)
    }
  }

  private finishCacheUpdate(key: string, state: WriteState, task: Promise<void>): void {
    state.cacheUpdates.delete(task)
    this.deleteStateIfIdle(key, state)
  }

  private finishTerminal(key: string, state: WriteState, terminal: Promise<void>): void {
    if (state.terminal !== terminal) return
    state.terminal = undefined
    this.deleteStateIfIdle(key, state)
  }

  private deleteStateIfIdle(key: string, state: WriteState): void {
    if (
      this.states.get(key) === state &&
      !state.inFlight &&
      !state.pending &&
      !state.terminal &&
      state.cacheUpdates.size === 0
    ) {
      this.states.delete(key)
    }
  }
}
