import type {
  Message,
  Session,
  SessionApplicationEvent,
  SessionEventBus,
  SessionMetaPage,
  SessionMetaRecord,
  Updater,
} from '@chatbox/core'
import { applyMessageUpdate } from '@chatbox/core/application/session'
import { sortSessionRecords, uniqueSessionRecords } from '@chatbox/core/utils/session-sort'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { QueryKeys } from './query-keys'
import { mergeCachedGeneratingMessages } from './session-cache-policy'
import {
  createSessionQueryDefinitions,
  type SessionQueryDefinitions,
  type SessionQuerySource,
} from './session-query-options'

export type InfiniteSessionData = InfiniteData<SessionMetaPage, number>

export function applySessionListUpdate(
  old: InfiniteSessionData,
  updater: (items: SessionMetaRecord[]) => SessionMetaRecord[]
): InfiniteSessionData {
  if (old.pages.length === 0) return old
  const allItems = old.pages.flatMap((page) => page.items)
  const previousUnique = uniqueSessionRecords(allItems)
  const updated = uniqueSessionRecords(updater(allItems))
  const lastPage = old.pages[old.pages.length - 1]
  const total = Math.max(updated.length, (lastPage.total || 0) + (updated.length - previousUnique.length))
  return {
    pages: [
      {
        items: updated,
        nextCursor: updated.length < total ? updated.length : null,
        total,
      },
    ],
    pageParams: [0],
  }
}

function updateListData(
  queryClient: QueryClient,
  queryKey: string[],
  updater: (items: SessionMetaRecord[]) => SessionMetaRecord[]
): void {
  queryClient.setQueryData<InfiniteSessionData>(queryKey, (old) => {
    if (!old || old.pages.length === 0) return old
    return applySessionListUpdate(old, updater)
  })
}

export class SessionQueryBridge {
  readonly definitions: SessionQueryDefinitions
  private readonly unsubscribe: () => void
  private visibleListRefreshGeneration = 0
  private visibleListRefreshTail: Promise<void> = Promise.resolve()
  private visibleListRefreshPending = false

  constructor(
    private readonly queryClient: QueryClient,
    private readonly source: SessionQuerySource,
    events: SessionEventBus
  ) {
    this.definitions = createSessionQueryDefinitions(source)
    this.unsubscribe = events.subscribe((event) => this.project(event))
  }

  dispose(): void {
    this.unsubscribe()
  }

  getCachedSessionsMeta(): SessionMetaRecord[] {
    const data = this.queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    return uniqueSessionRecords(data?.pages.flatMap((page) => page.items) ?? [])
  }

  getCachedSession(sessionId: string): Session | null | undefined {
    return this.queryClient.getQueryData<Session | null>(QueryKeys.ChatSession(sessionId))
  }

  async listSessionsMeta(): Promise<SessionMetaRecord[]> {
    const cached = this.getCachedSessionsMeta()
    if (cached.length > 0) return cached
    const data = await this.queryClient.fetchInfiniteQuery(this.definitions.sessions)
    return uniqueSessionRecords(data.pages.flatMap((page) => page.items))
  }

  getSession(sessionId: string): Promise<Session | null> {
    return this.queryClient.fetchQuery(this.definitions.session(sessionId))
  }

  discardSessionCache(sessionId: string): void {
    this.queryClient.removeQueries({ queryKey: QueryKeys.ChatSession(sessionId), exact: true })
  }

  updateSessionListData(updater: (items: SessionMetaRecord[]) => SessionMetaRecord[]): void {
    updateListData(this.queryClient, QueryKeys.ChatSessionsList, updater)
  }

  updateArchivedSessionListData(updater: (items: SessionMetaRecord[]) => SessionMetaRecord[]): void {
    updateListData(this.queryClient, QueryKeys.ArchivedChatSessionsList, updater)
  }

  resetSessionList(page: SessionMetaPage): void {
    this.queryClient.setQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList, {
      pages: [page],
      pageParams: [0],
    })
  }

  resetArchivedSessionList(page: SessionMetaPage): void {
    this.queryClient.setQueryData<InfiniteSessionData>(QueryKeys.ArchivedChatSessionsList, {
      pages: [page],
      pageParams: [0],
    })
  }

  updateSessionCache(sessionId: string, updater: Updater<Session>): void {
    this.queryClient.setQueryData(QueryKeys.ChatSession(sessionId), (old: Session | null | undefined) => {
      if (!old) return old
      return typeof updater === 'function' ? updater(old) : { ...old, ...updater }
    })
  }

  /**
   * Cache-only message update for streaming-frequency writes. Loads the session
   * through the query cache first so a missing session fails loudly instead of
   * silently dropping the update.
   */
  async updateMessageCache(sessionId: string, messageId: string, updater: Updater<Message>): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    this.updateSessionCache(sessionId, (current) => applyMessageUpdate(current, sessionId, messageId, updater))
  }

  private invalidateVisibleListRefresh(): void {
    this.visibleListRefreshGeneration += 1
  }

  private refreshVisibleSessionList(): Promise<void> {
    // Pin updates are not serialized across sessions, and this read is not a
    // React Query fetch, so cancelQueries cannot abort it. Queue refreshes and
    // drop superseded results so an older page cannot overwrite a newer one.
    const generation = ++this.visibleListRefreshGeneration
    const refresh = this.visibleListRefreshTail
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.visibleListRefreshGeneration) {
          return
        }
        await this.queryClient.cancelQueries({ queryKey: QueryKeys.ChatSessionsList })
        if (generation !== this.visibleListRefreshGeneration) {
          return
        }
        const page = await this.readVisibleSessionListPage(generation)
        if (!page || generation !== this.visibleListRefreshGeneration) {
          return
        }
        this.resetSessionList(page)
      })
    this.visibleListRefreshTail = refresh
    this.visibleListRefreshPending = true
    return refresh.finally(() => {
      if (this.visibleListRefreshTail === refresh) {
        this.visibleListRefreshPending = false
      }
    })
  }

  private async readVisibleSessionListPage(generation: number): Promise<SessionMetaPage | null> {
    try {
      return await this.source.listSessionsMetaPage(0)
    } catch {
      if (generation !== this.visibleListRefreshGeneration) {
        return null
      }
      try {
        return await this.source.listSessionsMetaPage(0)
      } catch {
        if (generation !== this.visibleListRefreshGeneration) {
          return null
        }
        // The optimistic pin patch can leave a pagination-inconsistent prefix.
        // Infinite staleTime would keep that cache authoritative after a read
        // failure, so mark the list stale and let observers refetch.
        await this.queryClient.invalidateQueries({ queryKey: QueryKeys.ChatSessionsList }).catch(() => undefined)
        return null
      }
    }
  }

  private async project(event: SessionApplicationEvent): Promise<void> {
    switch (event.type) {
      case 'session-created': {
        const refreshPending = this.visibleListRefreshPending
        this.invalidateVisibleListRefresh()
        this.queryClient.setQueryData(QueryKeys.ChatSession(event.session.id), event.session)
        this.updateSessionListData((items) => sortSessionRecords([...items, event.record]))
        // A record that sorts to the tail of a still-paginated window may truly
        // belong on a page that is not loaded yet (a copy of a session outside
        // the window), which would shift every later offset. The cache alone
        // cannot tell, so reload the first page from the repository.
        const data = this.queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
        const lastPage = data?.pages[data.pages.length - 1]
        if (
          refreshPending ||
          (lastPage && lastPage.nextCursor !== null && lastPage.items.at(-1)?.id === event.record.id)
        ) {
          await this.refreshVisibleSessionList()
        }
        break
      }
      case 'session-updated':
        if (event.preserveCachedGeneratingMessages) {
          this.queryClient.setQueryData(QueryKeys.ChatSession(event.session.id), (cached: Session | null | undefined) =>
            mergeCachedGeneratingMessages(event.session, cached)
          )
        } else {
          this.queryClient.setQueryData(QueryKeys.ChatSession(event.session.id), event.session)
        }
        if (event.meta) {
          const refreshPending = this.visibleListRefreshPending
          const cached = this.getCachedSessionsMeta().find((item) => item.id === event.session.id)
          // Pin state changes the global starred/unstarred window. Patching the
          // already-loaded pages leaves a stale prefix, so the next page overlaps
          // and the same chat repeats until the app restarts.
          const starredChanged = cached !== undefined && Boolean(cached.starred) !== Boolean(event.session.starred)
          if (starredChanged || refreshPending) {
            this.invalidateVisibleListRefresh()
          }
          this.updateSessionListData((items) =>
            sortSessionRecords(items.map((item) => (item.id === event.session.id ? { ...item, ...event.meta } : item)))
          )
          if (starredChanged || refreshPending) {
            await this.refreshVisibleSessionList()
          }
        }
        break
      case 'session-deleted': {
        const refreshPending = this.visibleListRefreshPending
        const ids = new Set(event.ids)
        this.invalidateVisibleListRefresh()
        for (const sessionId of ids) {
          this.queryClient.setQueryData(QueryKeys.ChatSession(sessionId), null)
        }
        this.updateSessionListData((items) => items.filter((item) => !ids.has(item.id)))
        this.updateArchivedSessionListData((items) => items.filter((item) => !ids.has(item.id)))
        if (refreshPending) {
          await this.refreshVisibleSessionList()
        }
        break
      }
      case 'session-list-reset':
        if (event.visible) {
          this.invalidateVisibleListRefresh()
          this.resetSessionList(event.visible)
        }
        if (event.archived) this.resetArchivedSessionList(event.archived)
        break
      case 'session-will-delete':
        break
    }
  }
}

export { SessionQueryBridge as ApplicationQueryBridge }
