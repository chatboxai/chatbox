import type {
  Message,
  SessionApplicationEvent,
  SessionEventBus,
  SessionFolder,
  SessionMetaPage,
  SessionMetaRecord,
  Updater,
} from '@chatbox/core'
import type { SessionCommandDelta, SessionHeaderRead } from '@chatbox/core/ports'
import { getSessionListGroupRank, sortSessionRecords, uniqueSessionRecords } from '@chatbox/core/utils/session-sort'
import { type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { QueryKeys } from './query-keys'
import {
  createSessionQueryDefinitions,
  type SessionQueryDefinitions,
  type SessionQuerySource,
  type SessionMessageQueryRead,
} from './session-query-options'
import type { SessionTranscriptWindowController } from './session-transcript-window'

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
  private readonly commandRevisions = new Map<string, number>()
  private readonly metaRevisions = new Map<string, number>()
  private readonly windows = new Map<string, Set<SessionTranscriptWindowController>>()
  private readonly commitListeners = new Map<string, Set<(delta: SessionCommandDelta) => void>>()
  private readonly generationControlVersions = new Map<string, number>()

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
    for (const controllers of this.windows.values()) for (const controller of controllers) controller.close()
    this.windows.clear()
    this.commitListeners.clear()
    this.generationControlVersions.clear()
    this.commandRevisions.clear()
    this.metaRevisions.clear()
  }

  registerWindow(sessionId: string, controller: SessionTranscriptWindowController): () => void {
    const controllers = this.windows.get(sessionId) ?? new Set<SessionTranscriptWindowController>()
    controllers.add(controller)
    this.windows.set(sessionId, controllers)
    return () => {
      controllers.delete(controller)
      if (!controllers.size) this.windows.delete(sessionId)
    }
  }

  subscribeCommits(sessionId: string, listener: (delta: SessionCommandDelta) => void): () => void {
    const listeners = this.commitListeners.get(sessionId) ?? new Set<(delta: SessionCommandDelta) => void>()
    listeners.add(listener)
    this.commitListeners.set(sessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.commitListeners.delete(sessionId)
    }
  }

  getGenerationControlVersion(sessionId: string): number {
    return this.generationControlVersions.get(sessionId) ?? 0
  }

  getCachedSessionsMeta(): SessionMetaRecord[] {
    const data = this.queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    return uniqueSessionRecords(data?.pages.flatMap((page) => page.items) ?? [])
  }

  private async getFolderIds(): Promise<string[]> {
    return (await this.queryClient.fetchQuery(this.definitions.folders)).map((folder) => folder.id)
  }

  async listSessionsMeta(): Promise<SessionMetaRecord[]> {
    const cached = this.getCachedSessionsMeta()
    if (cached.length > 0) return cached
    const data = await this.queryClient.fetchInfiniteQuery(this.definitions.sessions)
    return uniqueSessionRecords(data.pages.flatMap((page) => page.items))
  }

  getSessionHeader(sessionId: string): Promise<SessionHeaderRead | null> {
    return this.queryClient.fetchQuery(this.definitions.header(sessionId))
  }

  private sessionKeys(sessionId: string): string[][] {
    return [
      QueryKeys.ChatSessionHeader(sessionId),
      QueryKeys.ChatSessionMessage(sessionId),
      QueryKeys.ChatSessionThread(sessionId),
      QueryKeys.ChatSessionThreads(sessionId),
      QueryKeys.ChatSessionForks(sessionId),
    ]
  }

  discardSessionCache(sessionId: string): void {
    this.commandRevisions.delete(sessionId)
    for (const key of this.sessionKeys(sessionId)) this.queryClient.removeQueries({ queryKey: key })
    for (const controller of this.windows.get(sessionId) ?? []) void controller.refresh()
  }

  /** Stream chunks patch mounted bodies; off-screen messages remain owned by their generation runtime. */
  async updateMessageCache(
    sessionId: string,
    messageId: string,
    updater: Updater<Message>,
    options?: { shouldApply?: () => boolean }
  ): Promise<void> {
    if (options?.shouldApply?.() === false) return
    for (const controller of this.windows.get(sessionId) ?? []) controller.updateMessage(messageId, updater)
    const key = QueryKeys.ChatSessionMessage(sessionId, messageId)
    this.queryClient.setQueryData<SessionMessageQueryRead | null>(key, (read) =>
      read?.message
        ? {
            ...read,
            message: typeof updater === 'function' ? updater(read.message) : { ...read.message, ...updater },
          }
        : read
    )
  }

  private async projectCommand(delta: SessionCommandDelta, preserveLive: boolean): Promise<boolean> {
    const { sessionId, revision } = delta
    if ((this.commandRevisions.get(sessionId) ?? 0) >= revision) return false
    this.commandRevisions.set(sessionId, revision)
    const navigation = delta.structureResult?.navigation
    const ranges = delta.diff
    const structural =
      (!!delta.structureResult &&
        (!!ranges.messages.upsert.length ||
          !!ranges.messageMetadataUpsert?.length ||
          !!delta.structureResult.affectedScopes?.length)) ||
      !!ranges.deleteSessionMessages ||
      !!ranges.deleteArchivedThreads ||
      !!ranges.insertParents?.length ||
      !!ranges.expandForks?.length ||
      !!ranges.deleteSubtrees?.length ||
      !!ranges.deleteThreadMessages?.length ||
      !!ranges.replaceMessagePivots?.length ||
      !!ranges.reparentChildren?.length ||
      !!ranges.siblingShifts?.length ||
      !!ranges.messages.delete.length ||
      !!ranges.threads.delete.length
    const removedThreads = [
      ...ranges.threads.delete,
      ...(ranges.deleteThreadMessages ?? []),
      ...(ranges.deleteSubtrees?.map((range) => range.threadId) ?? []),
    ]
    if (structural) this.generationControlVersions.set(sessionId, revision)
    if (ranges.deleteSessionMessages)
      for (const controller of this.windows.get(sessionId) ?? [])
        removedThreads.push(...controller.getSnapshot().threads.map((thread) => thread.threadId))
    for (const controller of this.windows.get(sessionId) ?? []) {
      if ((controller.getSnapshot().revision ?? 0) > revision) continue
      if (
        ranges.messages.delete.length &&
        !navigation &&
        !removedThreads.length &&
        !ranges.deleteSessionMessages &&
        !ranges.deleteArchivedThreads
      ) {
        if (controller.applyRemovals(delta)) {
          const readBranch = this.source.readSessionBranchMessagesPage
          if (readBranch) await controller.completeRemovals((request) => readBranch.call(this.source, request))
        } else controller.rejectRemovalProjection()
        continue
      }
      if (
        navigation?.type === 'branch' &&
        navigation.mode === 'create' &&
        controller.applyCreatedBranch(delta, preserveLive)
      )
        continue
      if (controller.applyThreadCommit(delta)) continue
      controller.updateMetadata(
        delta.diff.messageMetadataUpsert ?? [],
        delta.diff.threads.upsert,
        navigation?.type === 'branch' ? { rows: ranges.messages.upsert, preserveLive } : undefined
      )
      if (navigation?.type === 'thread-switch') void controller.showSwitchedThread(delta)
      else if (navigation?.type === 'branch') {
        const prefix = controller
          .getSnapshot()
          .rows.find((row) => row.messageId === navigation.sharedPrefixEnd.messageId)
        if (prefix && delta.previousRevision !== null && controller.getSnapshot().revision === delta.previousRevision) {
          const cursor = {
            sessionId,
            revision,
            threadId: prefix.threadId,
            threadOrder:
              controller.getSnapshot().threads.find((thread) => thread.threadId === prefix.threadId)?.threadOrder ?? -1,
            messageId: prefix.messageId,
            direction: 'after' as const,
            scope: 'transcript' as const,
            limit: controller.getSnapshot().pageSize,
            maxBytes: controller.getSnapshot().maxBytes,
          }
          void controller.applyBranchCommit({
            ...delta,
            previousRevision: delta.previousRevision,
            sharedPrefixEnd: navigation.sharedPrefixEnd,
            ...(navigation.firstMessageId ? { origin: { messageId: navigation.firstMessageId } } : { cursor }),
          })
        } else
          void controller.navigateBranch(
            navigation.firstMessageId
              ? { messageId: navigation.firstMessageId }
              : { threadId: navigation.sharedPrefixEnd.threadId, edge: 'tail' },
            revision
          )
      } else if (
        structural ||
        !controller.applyRows(
          delta,
          delta.previousRevision,
          delta.diff.messages.upsert,
          delta.appendedMessageIds,
          preserveLive
        )
      ) {
        void controller.refresh(ranges.messages.delete, removedThreads, structural ? undefined : delta)
      }
    }
    for (const listener of this.commitListeners.get(sessionId) ?? []) listener(delta)
    const upserts = new Map(delta.diff.messages.upsert.map((row) => [row.messageId, row.message]))
    const deleted = new Set(delta.diff.messages.delete)
    await this.queryClient.cancelQueries({ queryKey: QueryKeys.ChatSessionMessage(sessionId) })
    this.queryClient.setQueriesData<SessionMessageQueryRead | null>(
      { queryKey: QueryKeys.ChatSessionMessage(sessionId) },
      (read) => {
        if (!read || read.revision > revision) return read
        const message = read.message
        return {
          header: delta.header,
          revision,
          message: message
            ? deleted.has(message.id)
              ? null
              : preserveLive && message.generating && upserts.get(message.id)?.generating
                ? message
                : (upserts.get(message.id) ?? message)
            : null,
        }
      }
    )
    if (structural || ranges.threads.upsert.length) {
      for (const key of [
        QueryKeys.ChatSessionThread(sessionId),
        QueryKeys.ChatSessionThreads(sessionId),
        ...(structural ? [QueryKeys.ChatSessionMessage(sessionId), QueryKeys.ChatSessionForks(sessionId)] : []),
      ]) {
        void this.queryClient.invalidateQueries({ queryKey: key })
      }
    }
    const headerKey = QueryKeys.ChatSessionHeader(sessionId)
    const hasHeaderQuery = this.queryClient.getQueryState(headerKey) !== undefined
    await this.queryClient.cancelQueries({ queryKey: headerKey, exact: true })
    this.queryClient.setQueryData<SessionHeaderRead | null>(headerKey, (read) =>
      read && read.revision <= revision
        ? { ...read, header: delta.header, activeThreadId: delta.record.activeThreadId, revision }
        : read
    )
    if (hasHeaderQuery) {
      const read = await this.source.getSessionHeader(sessionId)
      if (this.commandRevisions.get(sessionId) === revision)
        this.queryClient.setQueryData<SessionHeaderRead | null>(headerKey, (previous) =>
          previous && read && previous.revision > read.revision ? previous : read
        )
    }
    return this.commandRevisions.get(sessionId) === revision
  }

  updateSessionListData(updater: (items: SessionMetaRecord[]) => SessionMetaRecord[]): void {
    updateListData(this.queryClient, QueryKeys.ChatSessionsList, updater)
  }

  updateArchivedSessionListData(updater: (items: SessionMetaRecord[]) => SessionMetaRecord[]): void {
    updateListData(this.queryClient, QueryKeys.ArchivedChatSessionsList, updater)
  }

  resetSessionList(page: SessionMetaPage): void {
    // A page request still in flight was read at an offset of the old order;
    // letting it land would append it to the new first page.
    void this.queryClient.cancelQueries({ queryKey: QueryKeys.ChatSessionsList, exact: true })
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

  private async projectMetadata(sessionId: string, meta: Partial<SessionMetaRecord>, revision: number): Promise<void> {
    if ((this.metaRevisions.get(sessionId) ?? 0) >= revision) return
    this.metaRevisions.set(sessionId, revision)
    const folderIds = await this.getFolderIds()
    if (this.metaRevisions.get(sessionId) !== revision) return
    const previous = this.getCachedSessionsMeta().find((item) => item.id === sessionId)
    const changedGroup =
      previous &&
      getSessionListGroupRank(previous, folderIds) !== getSessionListGroupRank({ ...previous, ...meta }, folderIds)
    this.updateSessionListData((items) =>
      sortSessionRecords(
        items.map((item) => (item.id === sessionId ? { ...item, ...meta } : item)),
        folderIds
      )
    )
    if (changedGroup || this.visibleListRefreshPending) await this.refreshVisibleSessionList()
  }

  private async project(event: SessionApplicationEvent): Promise<void> {
    switch (event.type) {
      case 'session-command-committed': {
        await this.projectCommand(event.delta, event.preserveCachedGeneratingMessages)
        if (event.meta && event.metaRevision !== null)
          await this.projectMetadata(event.delta.sessionId, event.meta, event.metaRevision)
        break
      }
      case 'session-meta-projected':
        await this.projectMetadata(event.sessionId, event.meta, event.revision)
        break
      case 'session-created': {
        if ((this.metaRevisions.get(event.record.id) ?? 0) > event.revision) {
          await this.refreshVisibleSessionList()
          break
        }
        this.metaRevisions.set(event.record.id, event.revision)
        const refreshPending = this.visibleListRefreshPending
        this.invalidateVisibleListRefresh()
        const folderIds = await this.getFolderIds()
        if (this.metaRevisions.get(event.record.id) !== event.revision) break
        this.updateSessionListData((items) => sortSessionRecords([...items, event.record], folderIds))
        const data = this.queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
        const lastPage = data?.pages[data.pages.length - 1]
        if (
          refreshPending ||
          (lastPage && lastPage.nextCursor !== null && lastPage.items.at(-1)?.id === event.record.id)
        )
          await this.refreshVisibleSessionList()
        break
      }
      case 'session-deleted': {
        const refreshPending = this.visibleListRefreshPending
        const ids = new Set(event.ids)
        this.invalidateVisibleListRefresh()
        for (const sessionId of ids) {
          this.commandRevisions.delete(sessionId)
          this.metaRevisions.delete(sessionId)
          this.generationControlVersions.delete(sessionId)
          for (const key of this.sessionKeys(sessionId)) {
            void this.queryClient.cancelQueries({ queryKey: key })
            this.queryClient.removeQueries({ queryKey: key })
          }
          this.queryClient.setQueryData(QueryKeys.ChatSessionHeader(sessionId), null)
          for (const controller of this.windows.get(sessionId) ?? []) controller.close()
        }
        this.updateSessionListData((items) => items.filter((item) => !ids.has(item.id)))
        this.updateArchivedSessionListData((items) => items.filter((item) => !ids.has(item.id)))
        if (refreshPending) await this.refreshVisibleSessionList()
        break
      }
      case 'session-folders-changed':
        this.queryClient.setQueryData<SessionFolder[]>(QueryKeys.SessionFolders, event.folders)
        break
      case 'session-list-reset':
        if (event.visible) {
          this.invalidateVisibleListRefresh()
          this.resetSessionList(event.visible)
        }
        if (event.archived) this.resetArchivedSessionList(event.archived)
        break
      case 'session-derived-data-patched':
      case 'session-text-tokens-cached':
      case 'session-will-delete':
        break
    }
  }
}

export { SessionQueryBridge as ApplicationQueryBridge }
