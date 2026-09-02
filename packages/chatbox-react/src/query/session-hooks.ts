import { uniqueSessionRecords } from '@chatbox/core/utils/session-sort'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { SessionQueryDefinitions } from './session-query-options'

export function createSessionHooks(definitions: SessionQueryDefinitions) {
  function useSession(sessionId: string | null) {
    const { data: session, ...rest } = useQuery({
      ...definitions.session(sessionId ?? ''),
      enabled: !!sessionId,
    })
    return { session, ...rest }
  }

  function useSessionList() {
    const result = useInfiniteQuery(definitions.sessions)
    const sessionMetaList = useMemo(
      () => (result.data ? uniqueSessionRecords(result.data.pages.flatMap((page) => page.items)) : undefined),
      [result.data]
    )
    return {
      sessionMetaList,
      refetch: result.refetch,
      fetchNextPage: result.fetchNextPage,
      hasNextPage: result.hasNextPage,
      isFetchingNextPage: result.isFetchingNextPage,
    }
  }

  function useArchivedSessionList() {
    const result = useInfiniteQuery(definitions.archivedSessions)
    const archivedSessionMetaList = useMemo(
      () => (result.data ? uniqueSessionRecords(result.data.pages.flatMap((page) => page.items)) : undefined),
      [result.data]
    )
    return {
      archivedSessionMetaList,
      refetch: result.refetch,
      fetchNextPage: result.fetchNextPage,
      hasNextPage: result.hasNextPage,
      isFetchingNextPage: result.isFetchingNextPage,
      isLoading: result.isLoading,
    }
  }

  return {
    useSession,
    useSessionList,
    useArchivedSessionList,
  }
}
