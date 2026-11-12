import type { CopilotPreferences, CopilotService, FeaturedCopilotClient } from '@chatbox/core/application/copilots'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createCopilotQueryDefinitions, flattenFeaturedCopilots } from './copilot-query-options'

export function useCopilots(service: CopilotService) {
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
  useEffect(() => {
    void service.hydrate().catch(() => undefined)
  }, [service])
  return snapshot
}

export function useCopilotPreferences(service: CopilotPreferences) {
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
  useEffect(() => {
    void service.hydrate().catch(() => undefined)
  }, [service])
  return snapshot
}

export function useCopilotTags(client: FeaturedCopilotClient, lang: string, enabled = true) {
  const query = useQuery({ ...createCopilotQueryDefinitions(client).tags(lang), enabled })
  return { ...query, tags: query.data ?? [] }
}

export function useFeaturedCopilots(
  client: FeaturedCopilotClient,
  lang: string,
  tag?: string,
  search?: string,
  enabled = true
) {
  const query = useInfiniteQuery({ ...createCopilotQueryDefinitions(client).list(lang, tag, search), enabled })
  const copilots = useMemo(() => flattenFeaturedCopilots(query.data?.pages ?? []), [query.data])
  return { ...query, copilots }
}
