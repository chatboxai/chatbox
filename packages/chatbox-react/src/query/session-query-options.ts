import type { Message, SessionFolder, SessionMetaPage } from '@chatbox/core'
import type {
  SessionForkOptionsPage,
  SessionForkOptionsRequest,
  SessionHeaderRead,
  SessionMessagesSource,
  SessionRowRepositoryPort,
  SessionThreadPageCursor,
  SessionThreadSummariesPage,
} from '@chatbox/core/ports'
import { QueryKeys } from './query-keys'

export interface SessionQuerySource
  extends Pick<
    SessionRowRepositoryPort,
    | 'getSessionHeader'
    | 'readSessionMessages'
    | 'readSessionThread'
    | 'readSessionTranscriptWindow'
    | 'readSessionThreadSummariesPage'
    | 'readSessionForkOptionsPage'
  > {
  prefetchSessionThreadLinks?: SessionRowRepositoryPort['prefetchSessionThreadLinks']
  readSessionBranchMessagesPage?: SessionRowRepositoryPort['readSessionBranchMessagesPage']
  listSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage>
  listArchivedSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage>
  listSessionFolders?(): Promise<SessionFolder[]>
}

export interface SessionMessageQueryRead {
  header: SessionMessagesSource['header']
  revision: number
  message: Message | null
}

const policy = { networkMode: 'always' as const, staleTime: Infinity, retry: false as const }

export function createSessionQueryDefinitions(source: SessionQuerySource) {
  return {
    header: (sessionId: string) => ({
      ...policy,
      queryKey: QueryKeys.ChatSessionHeader(sessionId),
      queryFn: (): Promise<SessionHeaderRead | null> => source.getSessionHeader(sessionId),
    }),
    message: (sessionId: string, messageId: string) => ({
      ...policy,
      gcTime: 0,
      queryKey: QueryKeys.ChatSessionMessage(sessionId, messageId),
      queryFn: async (): Promise<SessionMessageQueryRead | null> => {
        const read = await source.readSessionMessages({ sessionId, messageIds: [messageId] })
        if (!read) return null
        if (read.revision === null) throw new Error('Message reads require a committed row revision')
        return {
          header: read.header,
          revision: read.revision,
          message: read.messages.find((message) => message.id === messageId) ?? null,
        }
      },
    }),
    thread: (sessionId: string, threadId?: string) => ({
      ...policy,
      queryKey: QueryKeys.ChatSessionThread(sessionId, threadId),
      queryFn: () => source.readSessionThread({ sessionId, threadId }),
    }),
    threads: (sessionId: string) => ({
      ...policy,
      queryKey: QueryKeys.ChatSessionThreads(sessionId),
      initialPageParam: null as SessionThreadPageCursor | null,
      queryFn: ({ pageParam }: { pageParam: SessionThreadPageCursor | null }) =>
        source.readSessionThreadSummariesPage({ sessionId, limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }),
      getNextPageParam: (page: SessionThreadSummariesPage | null) => page?.nextCursor ?? null,
    }),
    forks: (sessionId: string, pivotId: string) => ({
      ...policy,
      gcTime: 0,
      queryKey: QueryKeys.ChatSessionForks(sessionId, pivotId),
      initialPageParam: null as SessionForkOptionsRequest['cursor'] | null,
      queryFn: ({ pageParam }: { pageParam: SessionForkOptionsRequest['cursor'] | null }) =>
        source.readSessionForkOptionsPage({
          sessionId,
          pivotId,
          limit: 20,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      getNextPageParam: (page: SessionForkOptionsPage | null) => page?.nextCursor ?? null,
    }),
    sessions: {
      ...policy,
      queryKey: QueryKeys.ChatSessionsList,
      queryFn: ({ pageParam }: { pageParam: number }) => source.listSessionsMetaPage(pageParam),
      getNextPageParam: (lastPage: SessionMetaPage) => lastPage.nextCursor,
      initialPageParam: 0,
    },
    folders: {
      ...policy,
      queryKey: QueryKeys.SessionFolders,
      queryFn: (): Promise<SessionFolder[]> => source.listSessionFolders?.() ?? Promise.resolve([]),
    },
    archivedSessions: {
      ...policy,
      queryKey: QueryKeys.ArchivedChatSessionsList,
      queryFn: ({ pageParam }: { pageParam: number }) => source.listArchivedSessionsMetaPage(pageParam),
      getNextPageParam: (lastPage: SessionMetaPage) => lastPage.nextCursor,
      initialPageParam: 0,
    },
  }
}

export type SessionQueryDefinitions = ReturnType<typeof createSessionQueryDefinitions>
