import { uniqueSessionRecords } from '@chatbox/core/utils/session-sort'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { SessionQueryDefinitions } from './session-query-options'

export function createSessionHooks(definitions: SessionQueryDefinitions) {
  function useSessionHeader(sessionId: string | null, options: { enabled?: boolean } = {}) {
    const { data: read, ...rest } = useQuery({
      ...definitions.header(sessionId ?? ''),
      enabled: !!sessionId && options.enabled !== false,
    })
    return { read, session: read ? read.header : read, ...rest }
  }

  function useSessionMessage(sessionId: string | null, messageId: string | null) {
    const { data: read, ...rest } = useQuery({
      ...definitions.message(sessionId ?? '', messageId ?? ''),
      enabled: !!sessionId && !!messageId,
    })
    return { read, message: read?.message ?? (read === undefined ? undefined : null), ...rest }
  }

  function useSessionThread(sessionId: string | null, threadId?: string) {
    const { data: read, ...rest } = useQuery({ ...definitions.thread(sessionId ?? '', threadId), enabled: !!sessionId })
    return { read, ...rest }
  }

  function useSessionThreads(sessionId: string | null, options: { enabled?: boolean } = {}) {
    const result = useInfiniteQuery({
      ...definitions.threads(sessionId ?? ''),
      enabled: !!sessionId && options.enabled !== false,
    })
    const threads = useMemo(() => result.data?.pages.flatMap((page) => page?.threads ?? []) ?? [], [result.data])
    return { ...result, threads }
  }

  function useSessionForks(sessionId: string | null, pivotId: string | null) {
    const result = useInfiniteQuery({
      ...definitions.forks(sessionId ?? '', pivotId ?? ''),
      enabled: !!sessionId && !!pivotId,
    })
    const branches = useMemo(() => result.data?.pages.flatMap((page) => page?.branches ?? []) ?? [], [result.data])
    return { ...result, branches, fork: result.data?.pages[0] }
  }

  function useSessionList() {
    const result = useInfiniteQuery(definitions.sessions)
    const sessionMetaList = useMemo(
      () => (result.data ? uniqueSessionRecords(result.data.pages.flatMap((page) => page.items)) : undefined),
      [result.data]
    )
    return { ...result, sessionMetaList }
  }

  function useSessionFolders() {
    const { data: folders, ...rest } = useQuery(definitions.folders)
    return { folders, ...rest }
  }

  function useArchivedSessionList() {
    const result = useInfiniteQuery(definitions.archivedSessions)
    const archivedSessionMetaList = useMemo(
      () => (result.data ? uniqueSessionRecords(result.data.pages.flatMap((page) => page.items)) : undefined),
      [result.data]
    )
    return { ...result, archivedSessionMetaList }
  }

  return {
    useSessionHeader,
    useSessionMessage,
    useSessionThread,
    useSessionThreads,
    useSessionForks,
    useSessionList,
    useSessionFolders,
    useArchivedSessionList,
  }
}
