import type { LoggerPort } from '../../ports/logger'
import type { Session, SessionMeta, SessionMetaPage, SessionMetaRecord } from '../../types'

export type SessionDeleteOperation = 'session deletion' | 'bulk session deletion' | 'stale session meta cleanup'

export type SessionApplicationEvent =
  | {
      type: 'session-created'
      session: Session
      record: SessionMetaRecord
    }
  | {
      type: 'session-updated'
      session: Session
      meta: SessionMeta | null
      preserveCachedGeneratingMessages: boolean
    }
  | {
      type: 'session-will-delete'
      ids: string[]
      operation: SessionDeleteOperation
    }
  | {
      type: 'session-deleted'
      ids: string[]
    }
  | {
      type: 'session-list-reset'
      visible?: SessionMetaPage
      archived?: SessionMetaPage
    }

export type SessionEventListener = (event: SessionApplicationEvent) => void | Promise<void>

function describeListenerError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  }
}

/**
 * Minimal application event bus with best-effort notification semantics.
 *
 * Listeners start concurrently and have no ordering guarantee. Publishing waits
 * until every listener settles so callers retain the current "effects completed"
 * boundary, but a listener failure never rejects the session operation. This
 * applies to `session-will-delete` as well: it is an awaited cleanup notification,
 * not a veto hook. A future operation that can block deletion must use an explicit
 * guard contract instead of throwing from an event listener.
 */
export class SessionEventBus {
  private readonly listeners = new Set<SessionEventListener>()

  constructor(private readonly logger?: LoggerPort) {}

  subscribe(listener: SessionEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async publish(event: SessionApplicationEvent): Promise<void> {
    const results = await Promise.allSettled([...this.listeners].map(async (listener) => listener(event)))

    await Promise.allSettled(
      results.map(async (result, listenerIndex) => {
        if (result.status !== 'rejected' || !this.logger) return
        await this.logger.log('error', 'Session event listener failed', {
          eventType: event.type,
          listenerIndex,
          error: describeListenerError(result.reason),
        })
      })
    )
  }
}
