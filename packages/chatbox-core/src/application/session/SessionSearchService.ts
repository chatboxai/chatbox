import { escapeSearchInput } from '@shared/services/native-session-search'
import { getMessageText } from '@shared/utils/message'
import type { SessionSearchThreadsPage, SessionSearchThreadsPageRequest } from '../../ports/session-read-model'
import {
  type SessionMessageWindow,
  type SessionMessageWindowRequest,
  SessionRowConflictError,
} from '../../ports/session-row-store'
import { isActionAvailableInMode, resolveSessionMode } from '../../session/mode-policy'
import type { Message, SessionMetaPage } from '../../types'

export interface SessionSearchPort {
  listSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage>
  readSessionSearchThreadsPage(request: SessionSearchThreadsPageRequest): Promise<SessionSearchThreadsPage | null>
  readSessionMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null>
}

export interface SessionSearchHit {
  sessionId: string
  sessionName: string
  messageId?: string
  preview: string
}

export interface SessionSearchResult {
  hits: SessionSearchHit[]
  limitReached: boolean
  failedSessionIds: string[]
}

export interface SessionSearchOptions {
  sessionId?: string
  hideSystemPromptMessage?: boolean
  limit?: number
  signal?: AbortSignal
  onProgress?(result: SessionSearchResult): void
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Search canceled')
}

function previewAt(text: string, index: number): string {
  const start = Math.max(0, index - 80)
  const end = Math.min(text.length, start + 320)
  return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`
}

/**
 * Searches selected paths one message window and thread page at a time, with one
 * revision fence per conversation. Stores without thread paging provide a complete
 * compatibility source.
 */
export class SessionSearchService {
  constructor(
    private readonly sessions: SessionSearchPort,
    private readonly yieldControl: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0))
  ) {}

  async search(query: string, options: SessionSearchOptions = {}): Promise<SessionSearchResult> {
    const normalizedQuery = query.trim()
    const limit = options.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid search result limit')
    if (normalizedQuery.length > 2000) throw new RangeError('Search query is too long')
    const hits: SessionSearchHit[] = []
    const failedSessionIds = new Set<string>()
    const snapshot = (pending: readonly SessionSearchHit[] = []): SessionSearchResult => ({
      hits: [...hits, ...pending],
      limitReached: hits.length + pending.length >= limit,
      failedSessionIds: [...failedSessionIds],
    })
    checkAborted(options.signal)
    if (!normalizedQuery) return snapshot()
    const matcher = new RegExp(escapeSearchInput(normalizedQuery), 'i')
    options.onProgress?.(snapshot())

    const searchSession = async (sessionId: string): Promise<void> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const pending: SessionSearchHit[] = []
        try {
          checkAborted(options.signal)
          const model = await this.sessions.readSessionSearchThreadsPage({ sessionId, limit: 20 })
          checkAborted(options.signal)
          if (!model) return
          const header = model.kind === 'full' ? model.session : model.header
          const hidesPrompt =
            Boolean(options.hideSystemPromptMessage) ||
            !isActionAvailableInMode('session-system-prompt', resolveSessionMode(header.settings?.agentMode?.value))
          const seenMessages = new Set<string>()
          const matchMessage = (message: Message) => {
            checkAborted(options.signal)
            if (seenMessages.has(message.id) || (hidesPrompt && message.role === 'system')) return
            seenMessages.add(message.id)
            const text = getMessageText(message)
            const match = matcher.exec(text)
            if (!match) return
            pending.push({
              sessionId,
              sessionName: header.name,
              messageId: message.id,
              preview: previewAt(text, match.index),
            })
          }
          const full = () => hits.length + pending.length >= limit
          const scan = async (messages: readonly Message[]) => {
            for (let index = messages.length - 1; index >= 0 && !full(); index--) {
              matchMessage(messages[index])
              if (index % 50 === 0) {
                options.onProgress?.(snapshot(pending))
                await this.yieldControl()
                checkAborted(options.signal)
              }
            }
          }
          const titleMatch = matcher.exec(header.name)
          if (titleMatch)
            pending.push({ sessionId, sessionName: header.name, preview: previewAt(header.name, titleMatch.index) })
          if (model.kind === 'full') {
            await scan(model.session.messages)
            const threads = model.session.threads ?? []
            for (let index = threads.length - 1; index >= 0 && !full(); index--) await scan(threads[index].messages)
          } else {
            let threadPage = model
            const threadCursors = new Set<string>()
            while (!full()) {
              for (const threadId of threadPage.threadIds) {
                if (full()) break
                checkAborted(options.signal)
                let window: SessionMessageWindow | null = await this.sessions.readSessionMessageWindow({
                  sessionId,
                  threadId,
                  limit: 50,
                  expectedRevision: model.revision,
                })
                const messageCursors = new Set<string>()
                while (!full()) {
                  checkAborted(options.signal)
                  if (!window) throw new Error('Conversation disappeared while searching')
                  if (window.revision !== model.revision) {
                    throw new SessionRowConflictError(sessionId, model.revision, window.revision)
                  }
                  await scan(window.messages.map((row) => row.message))
                  if (full() || !window.older) break
                  const cursorKey = JSON.stringify(window.older)
                  if (messageCursors.has(cursorKey)) throw new Error('Message search cursor did not advance')
                  messageCursors.add(cursorKey)
                  checkAborted(options.signal)
                  window = await this.sessions.readSessionMessageWindow({
                    sessionId,
                    limit: 50,
                    cursor: window.older,
                    expectedRevision: model.revision,
                  })
                }
              }
              if (full() || !threadPage.nextCursor) break
              const cursorKey = JSON.stringify(threadPage.nextCursor)
              if (threadCursors.has(cursorKey)) throw new Error('Thread search cursor did not advance')
              threadCursors.add(cursorKey)
              await this.yieldControl()
              checkAborted(options.signal)
              const nextPage = await this.sessions.readSessionSearchThreadsPage({
                sessionId,
                limit: 20,
                cursor: threadPage.nextCursor,
              })
              checkAborted(options.signal)
              if (!nextPage) throw new Error('Conversation disappeared while searching')
              if (nextPage.kind !== 'rows' || nextPage.revision !== model.revision) {
                throw new SessionRowConflictError(
                  sessionId,
                  model.revision,
                  nextPage.kind === 'rows' ? nextPage.revision : null
                )
              }
              threadPage = nextPage
            }
          }
          hits.push(...pending)
          options.onProgress?.(snapshot())
          return
        } catch (error) {
          checkAborted(options.signal)
          // A live write invalidates the cursor. Discard only this session's
          // provisional hits and restart once; never combine committed revisions.
          options.onProgress?.(snapshot())
          if (error instanceof SessionRowConflictError && attempt === 0) continue
          failedSessionIds.add(sessionId)
          options.onProgress?.(snapshot())
          return
        }
      }
    }

    if (options.sessionId) {
      await searchSession(options.sessionId)
      return snapshot()
    }

    const seenSessions = new Set<string>()
    const seenCursors = new Set<number>()
    let cursor: number | null = 0
    while (cursor !== null && hits.length < limit) {
      checkAborted(options.signal)
      if (seenCursors.has(cursor)) throw new Error('Conversation search cursor did not advance')
      seenCursors.add(cursor)
      const page: SessionMetaPage = await this.sessions.listSessionsMetaPage(cursor, 30)
      checkAborted(options.signal)
      for (const meta of page.items) {
        if (seenSessions.has(meta.id)) continue
        seenSessions.add(meta.id)
        await searchSession(meta.id)
        if (hits.length >= limit) break
      }
      cursor = page.nextCursor
      await this.yieldControl()
    }
    checkAborted(options.signal)
    return snapshot()
  }
}
