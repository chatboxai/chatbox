import type { SessionEventBus } from '@chatbox/core/application/session'

export interface SessionWorkspaceLifecycle {
  remove(sessionId: string): Promise<void>
  reopen(sessionId: string): void
}

export function registerWorkspaceCleanup(
  events: SessionEventBus,
  workspace: SessionWorkspaceLifecycle | (() => Promise<SessionWorkspaceLifecycle>),
  abortGeneration: (sessionId: string) => void
): () => void {
  return events.subscribe(async (event) => {
    if (event.type === 'session-will-delete') {
      for (const id of event.ids) abortGeneration(id)
    } else if (
      event.type === 'session-deleted' ||
      event.type === 'session-created' ||
      event.type === 'session-meta-projected' ||
      (event.type === 'session-command-committed' && event.meta)
    ) {
      const target = typeof workspace === 'function' ? await workspace() : workspace
      if (event.type === 'session-deleted') {
        const results = await Promise.allSettled(event.ids.map((id) => target.remove(id)))
        const failures = results.filter((result) => result.status === 'rejected')
        if (failures.length)
          throw new AggregateError(
            failures.map((failure) => failure.reason),
            'Workspace cleanup failed'
          )
      } else
        target.reopen(
          event.type === 'session-command-committed'
            ? event.delta.sessionId
            : event.type === 'session-meta-projected'
              ? event.sessionId
              : event.session.id
        )
    }
  })
}
