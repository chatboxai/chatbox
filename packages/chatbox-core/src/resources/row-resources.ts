import type { SessionRowStorePort } from '../ports/session-row-store'
import { SessionRowConflictError } from '../ports/session-row-store'
import { throwIfAborted } from '../utils/abort'
import { collectHeaderResourceReferences, collectMessageReferences, type ResourceReference } from './index'

/** Scan complete message rows at one revision without collecting a session body. */
export async function* iterateRowResourceReferences(
  source: SessionRowStorePort,
  sessionId: string,
  signal?: AbortSignal
): AsyncGenerator<ResourceReference> {
  throwIfAborted(signal)
  const commit = await source.readCommit(sessionId)
  if (!commit) throw new Error('Resource scan session is unavailable')
  const threads = new Set<string>()
  yield* collectHeaderResourceReferences(commit.record)
  for await (const row of source.iterateRows({ sessionId, expectedRevision: commit.revision, signal })) {
    throwIfAborted(signal)
    if (row.kind === 'thread') {
      if (row.thread.sessionId !== sessionId) throw new Error('Resource scan thread identity mismatch')
      threads.add(row.thread.threadId)
      continue
    }
    if (row.message.sessionId !== sessionId || row.message.message.id !== row.message.messageId)
      throw new Error('Resource scan identity mismatch')
    const references: ResourceReference[] = []
    collectMessageReferences(row.message.message, sessionId, references)
    yield* references
  }
  if (!threads.has(commit.record.activeThreadId)) throw new Error('Resource scan active thread is unavailable')
  const revision = await source.getRevision(sessionId)
  if (revision !== commit.revision) throw new SessionRowConflictError(sessionId, commit.revision, revision)
}
