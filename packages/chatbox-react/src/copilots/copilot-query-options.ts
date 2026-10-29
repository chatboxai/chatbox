import type { CopilotDetail, FeaturedCopilotClient, FeaturedCopilotPage } from '@chatbox/core/application/copilots'

export const FEATURED_COPILOTS_PAGE_SIZE = 18

export function flattenFeaturedCopilots(pages: readonly FeaturedCopilotPage[]): CopilotDetail[] {
  const seen = new Set<string>()
  return pages
    .flatMap((page) => page.data)
    .filter((copilot) => {
      if (seen.has(copilot.id)) return false
      seen.add(copilot.id)
      return true
    })
}

export function createCopilotQueryDefinitions(client: FeaturedCopilotClient) {
  return {
    tags: (lang: string) => ({
      queryKey: ['copilots', 'tags', lang] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => client.tags(lang, signal),
      staleTime: 60 * 60 * 1000,
      retry: 3,
    }),
    list: (lang: string, tag?: string, search?: string) => ({
      queryKey: [
        'copilots',
        'featured',
        lang,
        FEATURED_COPILOTS_PAGE_SIZE,
        tag ?? null,
        search?.trim() ?? null,
      ] as const,
      queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
        client.list(
          {
            lang,
            limit: FEATURED_COPILOTS_PAGE_SIZE,
            cursor: pageParam,
            tag,
            search: search?.trim(),
          },
          signal
        ),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage: FeaturedCopilotPage) => lastPage.next_cursor ?? undefined,
      staleTime: 60 * 1000,
      retry: 3,
    }),
  }
}
