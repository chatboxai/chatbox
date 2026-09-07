import type { Session, SessionMetaPage } from '@chatbox/core'
import { QueryKeys } from './query-keys'

export interface SessionQuerySource {
  getSession(sessionId: string): Promise<Session | null>
  listSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage>
  listArchivedSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage>
}

export function createSessionQueryDefinitions(source: SessionQuerySource) {
  return {
    session: (sessionId: string) => ({
      queryKey: QueryKeys.ChatSession(sessionId),
      queryFn: () => source.getSession(sessionId),
      staleTime: Infinity,
    }),
    sessions: {
      queryKey: QueryKeys.ChatSessionsList,
      queryFn: ({ pageParam }: { pageParam: number }) => source.listSessionsMetaPage(pageParam),
      getNextPageParam: (lastPage: SessionMetaPage) => lastPage.nextCursor,
      initialPageParam: 0,
      staleTime: Infinity,
    },
    archivedSessions: {
      queryKey: QueryKeys.ArchivedChatSessionsList,
      queryFn: ({ pageParam }: { pageParam: number }) => source.listArchivedSessionsMetaPage(pageParam),
      getNextPageParam: (lastPage: SessionMetaPage) => lastPage.nextCursor,
      initialPageParam: 0,
      staleTime: Infinity,
    },
  }
}

export type SessionQueryDefinitions = ReturnType<typeof createSessionQueryDefinitions>
