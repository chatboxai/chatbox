import type { MessageRow } from '@chatbox/core/session/session-tree'
import type { SessionTranscriptRequest } from '@chatbox/core/ports'
import { rendererApplication } from '@/app/renderer-application'

/** Selected history only, retaining one payload page until its visitor completes. */
export async function visitSelectedSessionMessages(
  sessionId: string,
  visit: (row: MessageRow) => boolean,
  activeThreadOnly = false
): Promise<void> {
  const source = await rendererApplication.sessions.getSessionHeader(sessionId)
  if (!source) return
  let request: SessionTranscriptRequest = {
    sessionId,
    limit: 50,
    maxBytes: 2 * 1024 * 1024,
    expectedRevision: source.revision,
    origin: activeThreadOnly ? { threadId: source.activeThreadId, edge: 'tail' } : 'tail',
  }
  let previousCursor: string | undefined
  for (;;) {
    const page = await rendererApplication.sessions.readSessionTranscriptWindow(request)
    if (!page) return
    for (let index = page.messages.length - 1; index >= 0; index--) {
      const row = page.messages[index]
      if (activeThreadOnly && row.threadId !== source.activeThreadId) return
      if (visit(row)) return
    }
    if (!page.older) return
    const cursor = JSON.stringify(page.older)
    if (cursor === previousCursor) throw new Error('Session scan cursor did not advance')
    previousCursor = cursor
    request = { sessionId, limit: 50, maxBytes: 2 * 1024 * 1024, expectedRevision: source.revision, cursor: page.older }
  }
}
