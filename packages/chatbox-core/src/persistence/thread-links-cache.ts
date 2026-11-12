import type { ThreadLinks } from '../session/thread-links'

interface SessionEntry {
  revision: number
  threads: Map<string, ThreadLinks>
  loading: Map<string, Promise<ThreadLinks>>
}

/** Only successfully committed local writes can advance a resident graph across revisions. */
export class ThreadLinksCache {
  private readonly uses = new Map<string, { sessionId: string; threadId: string }>()
  constructor(private readonly maximumThreads = 4) {}
  private touch(sessionId: string, threadId: string): void {
    const key = JSON.stringify([sessionId, threadId])
    this.uses.delete(key)
    this.uses.set(key, { sessionId, threadId })
    while (this.uses.size > this.maximumThreads) {
      const oldest = this.uses.keys().next().value!
      const entry = this.uses.get(oldest)!
      this.sessions.get(entry.sessionId)?.threads.delete(entry.threadId)
      this.uses.delete(oldest)
    }
  }
  private readonly sessions = new Map<string, SessionEntry>()

  observe(sessionId: string, revision: number): void {
    if (this.sessions.get(sessionId)?.revision !== revision) {
      this.invalidate(sessionId)
      this.sessions.set(sessionId, { revision, threads: new Map(), loading: new Map() })
    }
  }

  peek(sessionId: string, threadId: string, revision: number): ThreadLinks | null {
    const session = this.sessions.get(sessionId)
    const graph = session?.revision === revision ? (session.threads.get(threadId) ?? null) : null
    if (graph) this.touch(sessionId, threadId)
    return graph
  }

  loaded(sessionId: string, threadId: string, revision: number, graph: ThreadLinks): void {
    const session = this.sessions.get(sessionId)
    if (session?.revision === revision) {
      session.threads.set(threadId, graph)
      this.touch(sessionId, threadId)
    }
  }

  async get(
    sessionId: string,
    threadId: string,
    revision: number,
    load: () => Promise<ThreadLinks>
  ): Promise<ThreadLinks> {
    this.observe(sessionId, revision)
    const session = this.sessions.get(sessionId)!
    const known = session.threads.get(threadId)
    if (known) {
      this.touch(sessionId, threadId)
      return known
    }
    const pending = session.loading.get(threadId)
    // A joined load may belong to a canceled background prefetch; retry with this caller's own loader.
    if (pending) return pending.catch(() => this.get(sessionId, threadId, revision, load))
    const loading = Promise.resolve()
      .then(load)
      .then((links) => {
        if (this.sessions.get(sessionId) === session) {
          session.threads.set(threadId, links)
          this.touch(sessionId, threadId)
        }
        return links
      })
      .finally(() => {
        if (session.loading.get(threadId) === loading) session.loading.delete(threadId)
      })
    session.loading.set(threadId, loading)
    return loading
  }

  /** Call after the database commit resolves, never while preparing a transaction. */
  committed(
    sessionId: string,
    expectedRevision: number,
    revision: number,
    changes: ReadonlyMap<string, ThreadLinks | null>
  ): void {
    const session = this.sessions.get(sessionId)
    if (session?.revision !== expectedRevision) {
      this.invalidate(sessionId)
      this.observe(sessionId, revision)
      return
    }
    // A fresh entry detaches loads started at the old revision so they cannot publish over these graphs.
    const next: SessionEntry = { revision, threads: new Map(session.threads), loading: new Map() }
    this.sessions.set(sessionId, next)
    for (const [threadId, links] of changes) {
      if (links) {
        next.threads.set(threadId, links)
        this.touch(sessionId, threadId)
      } else next.threads.delete(threadId)
    }
  }

  clear(): void {
    this.sessions.clear()
    this.uses.clear()
  }

  invalidate(sessionId: string): void {
    this.sessions.delete(sessionId)
    for (const [key, entry] of this.uses) if (entry.sessionId === sessionId) this.uses.delete(key)
  }
}
