import { Avatar, Badge, Flex, Loader, Text } from '@mantine/core'
import { createSpotlight, Spotlight, type SpotlightActionData, type SpotlightActionGroupData } from '@mantine/spotlight'
import type { MarketplaceSkill } from '@shared/types/skills'
import { IconDownload, IconSearch, IconWorld } from '@tabler/icons-react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useOverlayManager } from '@/components/layout/Overlay'
import { skillsController } from '@/packages/skills/controller'
import { toastError } from '@/packages/toast'
import { translateTexts } from '@/packages/translation'
import { settingsStore, useLanguage, useSettingsStore } from '@/stores/settingsStore'
import { SKILLS_POPULAR, type SkillRegistryEntry } from './registries'

// Dedicated spotlight store so Skills and MCP spotlights don't interfere
export const [skillsSpotlightStore, skillsSpotlight] = createSpotlight()

const SEARCH_PAGE_SIZE = 20
const SEARCH_MAX_LIMIT = 200
const SEARCH_SCROLL_THRESHOLD = 48
const SEARCH_DEBOUNCE_MS = 500
const SEARCH_MIN_QUERY_LENGTH = 2

function getSearchResultKey(skill: MarketplaceSkill): string {
  if (skill.id) {
    return skill.id
  }
  return `${skill.source}/${skill.skillId || skill.name}`
}

const SkillsSpotlight: FC<{
  installedSkillNames: string[]
  onInstallComplete: () => void
}> = (props) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const translationEnabled = useSettingsStore((state) => state.skills?.translationEnabled ?? true)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>()
  const translatedSearchRef = useRef<Map<string, { name: string; description: string }>>(new Map())

  // Register in overlay stack so ESC only closes the topmost layer
  const [opened, setOpened] = useState(false)
  useOverlayManager(opened)

  const [translatedPopular, setTranslatedPopular] = useState<Map<string, { title: string; description: string }>>(
    new Map()
  )
  const [translatedSearch, setTranslatedSearch] = useState<Map<string, { name: string; description: string }>>(
    new Map()
  )

  const trimmedSearchQuery = searchQuery.trim()

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (!trimmedSearchQuery || trimmedSearchQuery.length < SEARCH_MIN_QUERY_LENGTH) {
      setDebouncedSearchQuery('')
      return
    }

    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearchQuery(trimmedSearchQuery)
    }, SEARCH_DEBOUNCE_MS)
  }, [trimmedSearchQuery])

  const {
    data: searchData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isSearchLoading,
  } = useInfiniteQuery({
    queryKey: ['skills-market-search', debouncedSearchQuery],
    queryFn: async ({ pageParam = 0, signal }) => {
      const requestedLimit = Math.min((pageParam + 1) * SEARCH_PAGE_SIZE, SEARCH_MAX_LIMIT)
      const response = await fetch(
        `https://skills.sh/api/search?q=${encodeURIComponent(debouncedSearchQuery)}&limit=${requestedLimit}`,
        { signal }
      )
      const data = (await response.json()) as { skills?: MarketplaceSkill[] }
      const skills = data.skills ?? []
      const hasMore = skills.length >= requestedLimit && requestedLimit < SEARCH_MAX_LIMIT

      return {
        skills,
        nextCursor: hasMore ? pageParam + 1 : null,
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
    enabled: debouncedSearchQuery.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    maxPages: 5,
  })

  const searchResults = useMemo(() => {
    if (!debouncedSearchQuery) {
      return [] as MarketplaceSkill[]
    }

    const latestPage = searchData?.pages[searchData.pages.length - 1]
    if (!latestPage) {
      return [] as MarketplaceSkill[]
    }

    const deduped: MarketplaceSkill[] = []
    const seen = new Set<string>()
    for (const skill of latestPage.skills) {
      const key = getSearchResultKey(skill)
      if (!seen.has(key)) {
        seen.add(key)
        deduped.push(skill)
      }
    }
    return deduped
  }, [debouncedSearchQuery, searchData])

  useEffect(() => {
    if (!translationEnabled || language === 'en') {
      setTranslatedPopular(new Map())
      return
    }

    let cancelled = false
    const doTranslate = async () => {
      const texts = SKILLS_POPULAR.flatMap((s) => [s.title, s.description])
      const translated = await translateTexts(texts, language)
      if (cancelled) return

      const map = new Map<string, { title: string; description: string }>()
      SKILLS_POPULAR.forEach((entry, i) => {
        map.set(entry.name, {
          title: translated[i * 2],
          description: translated[i * 2 + 1],
        })
      })
      setTranslatedPopular(map)
    }

    void doTranslate()
    return () => {
      cancelled = true
    }
  }, [translationEnabled, language])

  useEffect(() => {
    if (!translationEnabled || language === 'en' || searchResults.length === 0) {
      const cleared = new Map<string, { name: string; description: string }>()
      translatedSearchRef.current = cleared
      setTranslatedSearch(cleared)
      return
    }

    let cancelled = false
    const currentSearchResults = [...searchResults]
    const doTranslate = async () => {
      const CHUNK_SIZE = 8
      const pendingSkills = currentSearchResults.filter(
        (skill) => !translatedSearchRef.current.has(getSearchResultKey(skill))
      )

      for (let i = 0; i < pendingSkills.length; i += CHUNK_SIZE) {
        if (cancelled) return

        const chunk = pendingSkills.slice(i, i + CHUNK_SIZE)
        const texts = chunk.flatMap((skill) => [skill.name, skill.description || ''])
        const translated = await translateTexts(texts, language)

        if (cancelled) return

        setTranslatedSearch((prev) => {
          const map = new Map(prev)
          chunk.forEach((skill, index) => {
            map.set(getSearchResultKey(skill), {
              name: translated[index * 2],
              description: translated[index * 2 + 1],
            })
          })
          translatedSearchRef.current = map
          return map
        })
      }
    }

    void doTranslate()
    return () => {
      cancelled = true
    }
  }, [translationEnabled, language, searchResults])

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query)
  }, [])

  const handleLoadMore = useCallback(() => {
    if (!debouncedSearchQuery || !hasNextPage || isFetchingNextPage) {
      return
    }

    void fetchNextPage()
  }, [debouncedSearchQuery, fetchNextPage, hasNextPage, isFetchingNextPage])

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!opened) {
      return
    }

    const listElement = document.querySelector<HTMLElement>('.skills-spotlight-actions-list')
    if (!listElement) {
      return
    }

    const handleActionsScroll = () => {
      if (!debouncedSearchQuery || !hasNextPage || isFetchingNextPage) {
        return
      }

      const nearBottom =
        listElement.scrollTop + listElement.clientHeight >= listElement.scrollHeight - SEARCH_SCROLL_THRESHOLD

      if (nearBottom) {
        void fetchNextPage()
      }
    }

    listElement.addEventListener('scroll', handleActionsScroll, { passive: true })
    handleActionsScroll()

    return () => {
      listElement.removeEventListener('scroll', handleActionsScroll)
    }
  }, [debouncedSearchQuery, fetchNextPage, hasNextPage, isFetchingNextPage, opened])

  const getPrimarySkillKey = useCallback((entry: SkillRegistryEntry | MarketplaceSkill): string => {
    if ('skillId' in entry && entry.skillId) {
      return entry.skillId
    }
    if ('homepage' in entry && entry.homepage) {
      const fromHomepage = entry.homepage.split('/').pop()
      if (fromHomepage) {
        return fromHomepage
      }
    }
    if ('id' in entry && entry.id) {
      const fromId = entry.id.split('/').pop()
      if (fromId) {
        return fromId
      }
    }
    return entry.name
  }, [])

  const isInstalled = useCallback(
    (entry: SkillRegistryEntry | MarketplaceSkill): boolean => {
      return props.installedSkillNames.includes(getPrimarySkillKey(entry))
    },
    [getPrimarySkillKey, props.installedSkillNames]
  )

  const handleInstall = useCallback(
    async (entry: SkillRegistryEntry | MarketplaceSkill) => {
      if (isInstalled(entry)) {
        return
      }

      const entryKey = getPrimarySkillKey(entry)
      setInstalling(entryKey)
      try {
        const payload: MarketplaceSkill =
          'id' in entry
            ? { ...entry, installs: entry.installs ?? 0 }
            : {
                id: `${entry.source}/${entry.name}`,
                skillId: getPrimarySkillKey(entry),
                name: entry.name,
                installs: entry.installs ?? 0,
                source: entry.source,
                description: entry.description,
              }

        const result = await skillsController.installMarketplaceSkill(payload)

        if (result.success) {
          // §7.6: script-bearing skills stay disabled until the user reviews
          // their scripts (the enable toggle opens the review modal).
          if (result.scriptNames?.length) {
            toast.info(
              t('"{{name}}" contains scripts — review them when enabling the skill', { name: result.skillName })
            )
          } else {
            settingsStore.setState((state) => {
              if (state.skills.enabledSkillNames.includes(result.skillName)) {
                return state
              }
              return {
                skills: {
                  ...state.skills,
                  enabledSkillNames: [...state.skills.enabledSkillNames, result.skillName],
                },
              }
            })
          }
          toast.success(t('Installed "{{name}}"', { name: result.skillName }))
          props.onInstallComplete()
        } else {
          toastError(result.error || t('Installation failed'))
        }
      } catch {
        toastError(t('Installation failed'))
      } finally {
        setInstalling(null)
      }
    },
    [getPrimarySkillKey, isInstalled, props.onInstallComplete, t]
  )

  const actions: (SpotlightActionGroupData | SpotlightActionData)[] = useMemo(() => {
    const groups: (SpotlightActionGroupData | SpotlightActionData)[] = []

    groups.push({
      group: String(t('Popular Skills')),
      actions: SKILLS_POPULAR.map((entry) => {
        const entryKey = getPrimarySkillKey(entry)
        const entryInstalled = isInstalled(entry)
        const translated = translatedPopular.get(entry.name)
        const translatedTitle = translated?.title && translated.title !== entry.title ? translated.title : ''
        const translatedDescription =
          translated?.description && translated.description !== entry.description ? translated.description : ''
        const label = translationEnabled && translatedTitle ? `${entry.title} · ${translatedTitle}` : entry.title
        const details =
          translationEnabled && translatedDescription
            ? `${translatedDescription} · ${entry.description} · ${entry.source}`
            : `${entry.description} · ${entry.source}`
        return {
          id: `popular-${entry.name}`,
          label,
          description: details,
          title: `${label}\n${details}`,
          onClick: () => {
            void handleInstall(entry)
          },
          leftSection: <Avatar name={entry.name} color="initials" size={20} src={entry.icon} />,
          rightSection: entryInstalled ? (
            <Badge size="xs" color="green">
              {t('Installed')}
            </Badge>
          ) : installing === entryKey ? (
            <Badge size="xs" color="blue">
              {t('Installing')}
            </Badge>
          ) : (
            <Flex align="center" gap={4}>
              <ScalableIcon icon={IconDownload} size={12} />
              <Text size="xs" c="dimmed">
                {entry.installs ?? 0}
              </Text>
            </Flex>
          ),
        }
      }),
    })

    if (trimmedSearchQuery && trimmedSearchQuery.length < SEARCH_MIN_QUERY_LENGTH) {
      groups.push({
        group: String(t('Search Results')),
        actions: [
          {
            id: 'search-query-hint',
            label: String(t('Type at least 2 characters')),
            description: String(t('Search starts after a short pause to reduce requests')),
            leftSection: <ScalableIcon icon={IconSearch} size={12} />,
          },
        ],
      })
    }

    if (debouncedSearchQuery && searchResults.length > 0) {
      groups.push({
        group: String(t('Search Results')),
        actions: searchResults.map((skill) => {
          const skillKey = getPrimarySkillKey(skill)
          const skillInstalled = isInstalled(skill)
          const translated = translatedSearch.get(getSearchResultKey(skill))
          const translatedName = translated?.name && translated.name !== skill.name ? translated.name : ''
          const originalDescription = skill.description || ''
          const translatedDescription =
            translated?.description && translated.description !== originalDescription ? translated.description : ''
          const label = translationEnabled && translatedName ? `${skill.name} · ${translatedName}` : skill.name
          const details =
            translationEnabled && translatedDescription
              ? [translatedDescription, originalDescription, skill.source].filter(Boolean).join(' · ')
              : [originalDescription, skill.source].filter(Boolean).join(' · ')
          return {
            id: `search-${skill.id || skill.name}`,
            label,
            description: details,
            title: `${label}\n${details}`,
            onClick: () => {
              void handleInstall(skill)
            },
            leftSection: <Avatar name={skill.name} color="initials" size={20} />,
            rightSection: skillInstalled ? (
              <Badge size="xs" color="green">
                {t('Installed')}
              </Badge>
            ) : installing === skillKey ? (
              <Badge size="xs" color="blue">
                {t('Installing')}
              </Badge>
            ) : (
              <Flex align="center" gap={8}>
                <Flex align="center" gap={2}>
                  <ScalableIcon icon={IconWorld} size={12} />
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {skill.source}
                  </Text>
                </Flex>
                <Flex align="center" gap={2}>
                  <ScalableIcon icon={IconDownload} size={12} />
                  <Text size="xs" c="dimmed">
                    {skill.installs ?? 0}
                  </Text>
                </Flex>
              </Flex>
            ),
          }
        }),
      })
    }

    if (debouncedSearchQuery && isSearchLoading && searchResults.length === 0) {
      groups.push({
        group: String(t('Search Results')),
        actions: [
          {
            id: 'search-loading',
            label: String(t('Searching skills...')),
            description: String(t('Fetching marketplace results')),
            leftSection: <Loader size="xs" />,
            onClick: () => {},
          },
        ],
      })
    }

    if (debouncedSearchQuery && searchResults.length > 0 && (hasNextPage || isFetchingNextPage)) {
      groups.push({
        group: String(t('More')),
        actions: [
          {
            id: 'search-load-more',
            label: isFetchingNextPage ? String(t('Loading more skills...')) : String(t('Load more skills')),
            description: String(t('Fetch next batch from marketplace')),
            leftSection: isFetchingNextPage ? <Loader size="xs" /> : <ScalableIcon icon={IconSearch} size={12} />,
            onClick: () => {
              handleLoadMore()
            },
          },
        ],
      })
    }

    if (debouncedSearchQuery && searchResults.length > 0) {
      groups.push({
        group: String(t('Status')),
        actions: [
          {
            id: 'search-status',
            label: isFetchingNextPage
              ? String(t('Loaded {{count}} skills · Loading next batch...', { count: searchResults.length }))
              : hasNextPage
                ? String(t('Loaded {{count}} skills · Scroll to load more', { count: searchResults.length }))
                : String(t('Loaded {{count}} skills · Reached end', { count: searchResults.length })),
            description: hasNextPage
              ? String(t('More results will load automatically when you reach the bottom'))
              : String(t('No more marketplace results for current query')),
            leftSection: isFetchingNextPage ? <Loader size="xs" /> : <ScalableIcon icon={IconSearch} size={12} />,
          },
        ],
      })
    }

    return groups
  }, [
    getPrimarySkillKey,
    handleInstall,
    installing,
    isInstalled,
    handleLoadMore,
    hasNextPage,
    isFetchingNextPage,
    isSearchLoading,
    debouncedSearchQuery,
    trimmedSearchQuery,
    searchResults,
    translationEnabled,
    translatedPopular,
    translatedSearch,
    t,
  ])

  return (
    <Spotlight
      store={skillsSpotlightStore}
      actions={actions}
      nothingFound={String(t('Nothing found...'))}
      scrollable
      maxHeight={600}
      shortcut={null}
      closeOnActionTrigger={false}
      onQueryChange={handleSearch}
      onSpotlightOpen={() => setOpened(true)}
      onSpotlightClose={() => setOpened(false)}
      classNames={{
        actionsList: 'skills-spotlight-actions-list',
      }}
      searchProps={{
        leftSection: <ScalableIcon icon={IconSearch} size={20} stroke={1.5} />,
        placeholder: String(t('Search skills...')),
      }}
    />
  )
}

export default SkillsSpotlight
