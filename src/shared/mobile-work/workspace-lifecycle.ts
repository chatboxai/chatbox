/** Keeps deletion behind native operations and rejects stale callers after deletion. */
export class WorkspaceLifecycle {
  private closed = new Set<string>()
  private pending = new Map<string, Set<Promise<unknown>>>()

  assertOpen(sessionId: string): void {
    if (this.closed.has(sessionId)) throw new Error('Conversation workspace was deleted')
  }

  reopen(sessionId: string): void {
    this.closed.delete(sessionId)
  }

  async run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    this.assertOpen(sessionId)
    const pending = this.pending.get(sessionId) ?? new Set<Promise<unknown>>()
    this.pending.set(sessionId, pending)
    const result = Promise.resolve().then(() => {
      this.assertOpen(sessionId)
      return operation()
    })
    pending.add(result)
    try {
      return await result
    } finally {
      pending.delete(result)
      if (pending.size === 0) this.pending.delete(sessionId)
    }
  }

  async remove(sessionId: string, removeDirectory: () => Promise<void>): Promise<void> {
    this.closed.add(sessionId)
    await Promise.allSettled([...(this.pending.get(sessionId) ?? [])])
    await removeDirectory()
  }
}
