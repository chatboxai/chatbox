import { escapeSearchInput } from '@shared/services/native-session-search'
import { getMessageText } from '@shared/utils/message'
import type { SessionSearchRepositoryPort, SessionSearchWindowRequest } from '../../ports/session-search-source'
import { SessionRowConflictError } from '../../ports/session-row-store'
import { isActionAvailableInMode, resolveSessionMode } from '../../session/mode-policy'
import type { Message, SessionHeader, SessionMetaPage } from '../../types'

export interface SessionSearchPort extends SessionSearchRepositoryPort {
  listSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage>
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
  hideSystemPromptMessage?: boolean | ((header: SessionHeader) => boolean)
  conversationOnly?: boolean
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
 * Searches current selected paths in bounded batches, newest first. Each batch
 * releases the command queue; candidates are rechecked before publication.
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
          const initial = await this.sessions.readSessionSearchCandidates({
            sessionId,
            messageIds: [],
            signal: options.signal,
          })
          checkAborted(options.signal)
          if (!initial) return
          const visible = (role: Message['role'], hasBackgroundTask: boolean, header: SessionHeader) => {
            const hidesPrompt =
              (typeof options.hideSystemPromptMessage === 'function'
                ? options.hideSystemPromptMessage(header)
                : Boolean(options.hideSystemPromptMessage)) ||
              !isActionAvailableInMode('session-system-prompt', resolveSessionMode(header.settings?.agentMode?.value))
            return (
              !(hidesPrompt && role === 'system') &&
              !(options.conversationOnly && (hasBackgroundTask || (role !== 'user' && role !== 'assistant')))
            )
          }
          const matchMessage = (message: Message, header: SessionHeader): SessionSearchHit | undefined => {
            checkAborted(options.signal)
            if (!visible(message.role, Boolean(message.backgroundTask), header)) return
            const text = getMessageText(message)
            const match = matcher.exec(text)
            if (match)
              return {
                sessionId,
                sessionName: header.name,
                messageId: message.id,
                preview: previewAt(text, match.index),
              }
          }
          const full = () => hits.length + pending.length >= limit
          const titleMatch = matcher.exec(initial.current.header.name)
          if (titleMatch)
            pending.push({
              sessionId,
              sessionName: initial.current.header.name,
              preview: previewAt(initial.current.header.name, titleMatch.index),
            })
          let request: SessionSearchWindowRequest = { sessionId, signal: options.signal }
          let previousCursor: string | undefined
          while (!full()) {
            checkAborted(options.signal)
            const batch = await this.sessions.readSessionSearchWindow(request)
            checkAborted(options.signal)
            if (!batch?.page) throw new Error('Conversation disappeared while searching')
            const window = batch.page
            for (let index = window.messages.length - 1; index >= 0 && !full(); index--) {
              const hit = matchMessage(window.messages[index].message, batch.current.header)
              if (hit && !pending.some((candidate) => candidate.messageId === hit.messageId)) pending.push(hit)
              if (index % 50 === 0) {
                options.onProgress?.(snapshot(pending))
                await this.yieldControl()
                checkAborted(options.signal)
              }
            }
            if (full() || !window.older) break
            const { threadId, threadOrder, messageId, direction } = window.older
            const cursorKey = JSON.stringify([threadId, threadOrder, messageId, direction])
            if (cursorKey === previousCursor) throw new Error('Message search cursor did not advance')
            previousCursor = cursorKey
            request = { sessionId, cursor: window.older, signal: options.signal }
            await this.yieldControl()
          }
          // Recheck bodies one at a time so even a page of oversized matches cannot
          // retain an unbounded body batch or hold the command queue for the scan.
          const checked: Array<{
            hit: SessionSearchHit
            role: Message['role']
            hasBackgroundTask: boolean
          }> = []
          for (const candidate of pending) {
            if (!candidate.messageId) continue
            checkAborted(options.signal)
            const batch = await this.sessions.readSessionSearchWindow({
              sessionId,
              messageId: candidate.messageId,
              signal: options.signal,
            })
            checkAborted(options.signal)
            const message = batch?.page?.messages.find((row) => row.messageId === candidate.messageId)?.message
            if (message && batch) {
              const hit = matchMessage(message, batch.current.header)
              if (hit) checked.push({ hit, role: message.role, hasBackgroundTask: Boolean(message.backgroundTask) })
            }
            await this.yieldControl()
          }
          const final = await this.sessions.readSessionSearchCandidates({
            sessionId,
            messageIds: checked.map(({ hit }) => hit.messageId!),
            signal: options.signal,
          })
          checkAborted(options.signal)
          if (!final) throw new Error('Conversation disappeared while searching')
          const hadTitle = pending.some((hit) => hit.messageId === undefined)
          pending.length = 0
          const finalTitle = hadTitle && matcher.exec(final.current.header.name)
          if (finalTitle)
            pending.push({
              sessionId,
              sessionName: final.current.header.name,
              preview: previewAt(final.current.header.name, finalTitle.index),
            })
          const selected = new Set(final.selectedMessageIds)
          for (const candidate of checked) {
            if (
              selected.has(candidate.hit.messageId!) &&
              visible(candidate.role, candidate.hasBackgroundTask, final.current.header)
            )
              pending.push({ ...candidate.hit, sessionName: final.current.header.name })
          }
          hits.push(...pending)
          options.onProgress?.(snapshot())
          return
        } catch (error) {
          checkAborted(options.signal)
          // A changed selected anchor or an external writer may invalidate a
          // batch. Retry once, discarding this session's provisional results.
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
