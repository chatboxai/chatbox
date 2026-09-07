import type { CopilotDetail } from '@shared/types'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo } from 'react'
import * as remote from '@/packages/remote'
import {
  addOrUpdateMyCopilot,
  type CopilotMemoryOwner,
  copilotMemoryOwnersAtom,
  disableCopilotMemory,
  enableCopilotMemory,
  myCopilotsAtom,
  readCopilotMemoryEnabled,
  removeMyCopilot,
} from '@/stores/copilotStore'
import { useLanguage } from '@/stores/settingsStore'

export function useMyCopilots() {
  const copilots = useAtomValue(myCopilotsAtom)

  // Sort my copilots: starred first
  const sortedCopilots = useMemo(() => {
    return [...copilots.filter((item) => item.starred), ...copilots.filter((item) => !item.starred)]
  }, [copilots])

  const addOrUpdate = (target: CopilotDetail) => {
    addOrUpdateMyCopilot(target).catch((error) => console.error('useMyCopilots: failed to save copilot', error))
  }

  const remove = (id: string) => {
    removeMyCopilot(id).catch((error) => console.error('useMyCopilots: failed to remove copilot', error))
  }

  return {
    copilots: sortedCopilots,
    addOrUpdate,
    remove,
  }
}

/** Which copilots keep their own memory list, and how to change that. */
export function useCopilotMemory() {
  const owners = useAtomValue(copilotMemoryOwnersAtom)

  const isEnabled = useCallback((copilotId: string) => owners.some((owner) => owner.id === copilotId), [owners])

  const setEnabled = (owner: CopilotMemoryOwner, enabled: boolean) => {
    const update = enabled ? enableCopilotMemory(owner) : disableCopilotMemory(owner.id)
    update.catch((error) => console.error('useCopilotMemory: failed to save memory ownership', error))
  }

  return { owners, isEnabled, readEnabled: readCopilotMemoryEnabled, setEnabled }
}

export function useRemoteCopilotTags() {
  const language = useLanguage()
  const { data: tags, ...others } = useQuery({
    queryKey: ['remote-copilot-tags', language],
    queryFn: () => remote.listCopilotTags(language),
    initialData: [],
    initialDataUpdatedAt: 0,
    staleTime: 3600 * 1000,
  })
  return { tags, ...others }
}

type RemoteCopilotsByCursorFilters = {
  limit?: number
  tag?: string
  search?: string
}

export function useRemoteCopilotsByCursor(filters?: RemoteCopilotsByCursorFilters) {
  const language = useLanguage()
  const { limit = 12, tag, search } = filters ?? {}

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, ...others } = useInfiniteQuery({
    queryKey: ['remote-copilots-cursor', language, limit, tag, search],
    queryFn: ({ pageParam }) => remote.listCopilotsByCursor(language, { limit, cursor: pageParam, tag, search }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    initialPageParam: undefined as string | undefined,
    staleTime: 60 * 1000,
    gcTime: 60 * 1000,
  })

  const copilots = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data])

  return {
    copilots,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    ...others,
  }
}
