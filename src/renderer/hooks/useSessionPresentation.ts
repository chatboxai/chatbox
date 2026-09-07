import {
  type SessionMessageWindow,
  type SessionMessageWindowCursor,
  type SessionReadModel,
  sessionReadModelHeader,
  SessionRowConflictError,
} from '@chatbox/core/ports'
import { QueryKeys } from '@chatbox/react/query'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rendererApplication } from '@/app/renderer-application'

export function useSessionPresentation(sessionId: string | null) {
  const query = rendererApplication.sessionHooks.useSessionReadModel(sessionId)
  const model = query.readModel
  const header = useMemo(() => (model ? sessionReadModelHeader(model) : model), [model])
  return { ...query, header }
}

export function useSessionTranscript(model: SessionReadModel | null | undefined) {
  const queryClient = useQueryClient()
  const initial = model?.kind === 'window' ? model.window : undefined
  const sessionId = initial?.record.id ?? ''
  const owner = useMemo(() => ({ sessionId, revision: initial?.revision }), [sessionId, initial?.revision])
  const activeOwner = useRef<typeof owner | null>(owner)
  activeOwner.current = owner
  const requestId = useRef(0)
  type Jump = { owner: typeof owner; id: number; edge: 'head' | 'tail'; pending: boolean; error: Error | null }
  const [jump, setJump] = useState<Jump | null>(null)
  const currentJump = jump?.owner === owner ? jump : null
  const [position, setPosition] = useState<{ sessionId: string; id: number; edge: 'head' | 'tail' } | null>(null)
  const queryKey = useMemo(
    () => [...QueryKeys.ChatSessionWindows(sessionId), initial?.revision],
    [sessionId, initial?.revision]
  )
  useEffect(() => {
    activeOwner.current = owner
    return () => {
      if (activeOwner.current === owner) activeOwner.current = null
    }
  }, [owner])
  const pages = useInfiniteQuery({
    queryKey,
    enabled: !!initial,
    initialData: initial ? { pages: [initial], pageParams: [null] } : undefined,
    initialPageParam: null as SessionMessageWindowCursor | null,
    queryFn: async ({ pageParam }): Promise<SessionMessageWindow> => {
      const result = await rendererApplication.sessions.readSessionMessageWindow({
        sessionId,
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      })
      if (!result) throw new Error('Session no longer exists')
      return result
    },
    getPreviousPageParam: (page) => page.older,
    getNextPageParam: (page) => page.newer,
    staleTime: Infinity,
    networkMode: 'always',
    retry: false,
  })
  useEffect(() => {
    if (
      (pages.error instanceof SessionRowConflictError || currentJump?.error instanceof SessionRowConflictError) &&
      sessionId
    ) {
      // A cursor is revision-bound. Never splice a newly committed page into
      // an older chain, including when deletion/recreation reuses the id.
      void queryClient.invalidateQueries({ queryKey: QueryKeys.ChatSessionReadModel(sessionId), exact: true })
    }
  }, [pages.error, currentJump?.error, queryClient, sessionId])
  const messages = useMemo(() => {
    const chain = pages.data?.pages ?? []
    if (!initial || chain.some((page) => page.revision !== initial.revision))
      return initial?.messages.map((row) => row.message) ?? []
    return chain.flatMap((page) => page.messages.map((row) => row.message))
  }, [initial, pages.data])
  const loadOlder = useCallback(() => {
    if (!pages.hasPreviousPage || pages.isFetching || currentJump?.pending) return
    void pages.fetchPreviousPage().catch(() => undefined)
  }, [pages.hasPreviousPage, pages.isFetching, pages.fetchPreviousPage, currentJump?.pending])
  const loadNewer = useCallback(() => {
    if (!pages.hasNextPage || pages.isFetching || currentJump?.pending) return
    void pages.fetchNextPage().catch(() => undefined)
  }, [pages.hasNextPage, pages.isFetching, pages.fetchNextPage, currentJump?.pending])
  const jumpToEdge = useCallback(
    async (edge: 'head' | 'tail') => {
      if (!initial) return
      const id = ++requestId.current
      setJump({ owner, id, edge, pending: true, error: null })
      const isCurrent = () => activeOwner.current === owner && requestId.current === id
      try {
        await queryClient.cancelQueries({ queryKey, exact: true })
        if (!isCurrent()) return
        const result = await rendererApplication.sessions.readSessionMessageWindow({
          sessionId,
          threadId: initial.thread.threadId,
          limit: 50,
          edge,
        })
        if (!isCurrent()) return
        if (!result) throw new Error('Session no longer exists')
        if (result.revision !== initial.revision)
          throw new SessionRowConflictError(sessionId, initial.revision, result.revision)
        queryClient.setQueryData(queryKey, { pages: [result], pageParams: [null] })
        setPosition({ sessionId, id, edge })
        setJump({ owner, id, edge, pending: false, error: null })
      } catch (error) {
        if (isCurrent())
          setJump({ owner, id, edge, pending: false, error: error instanceof Error ? error : new Error(String(error)) })
      }
    },
    [initial, owner, queryClient, queryKey, sessionId]
  )
  return {
    messages,
    windowIdentity: initial ? { threadId: initial.thread.threadId, revision: initial.revision } : undefined,
    loadOlder,
    loadNewer,
    jumpToEdge,
    position: position?.sessionId === sessionId ? position : null,
    hasOlder: pages.hasPreviousPage,
    hasNewer: pages.hasNextPage,
    isLoadingOlder: pages.isFetchingPreviousPage,
    isLoadingNewer: pages.isFetchingNextPage,
    isJumping: !!currentJump?.pending,
    error: currentJump?.error ?? pages.error,
    retry: () =>
      currentJump?.error ? void jumpToEdge(currentJump.edge) : pages.isFetchNextPageError ? loadNewer() : loadOlder(),
  }
}
