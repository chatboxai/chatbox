import { Box, Flex, Text, TextInput, UnstyledButton } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { IconChevronLeft, IconChevronRight, IconSearch, IconSparkles, IconX } from '@tabler/icons-react'
import {
  createFileRoute,
  Link,
  Outlet,
  useCanGoBack,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import { ICON_SIZE, ICON_STROKE_WIDTH, IconButton } from '@/components/common/IconButton'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import Page from '@/components/layout/Page'
import { SettingsDensityProvider, settingsHighlightStore } from '@/components/settings/SettingsLayout'
import {
  getSettingsNavGroups,
  SETTINGS_SEARCH_ENTRIES,
  type SettingsNavItem,
  type SettingsSearchEntry,
  settingsNavKeyForSection,
  useSettingsNavMeta,
} from '@/components/settings/settingsNav'
import { useBackupNavigationGuard } from '@/hooks/useBackupNavigationGuard'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
})

const NESTED_PAGE_TITLES: Record<string, string> = {
  'app-icon': 'App icon',
  archive: 'Archived Chats',
}

function useSettingsSection() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return pathname.split('/')[2] as string | undefined
}

export function RouteComponent() {
  const { t } = useTranslation()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const isSmallScreen = useIsSmallScreen()
  const section = useSettingsSection()
  const navItem = useMemo(
    () =>
      getSettingsNavGroups()
        .flatMap((group) => group.items)
        .find((item) => item.key === section),
    [section]
  )
  const pageTitle =
    !isSmallScreen || !section
      ? t('Settings')
      : NESTED_PAGE_TITLES[section]
        ? t(NESTED_PAGE_TITLES[section])
        : navItem
          ? navItem.noTranslate
            ? navItem.label
            : t(navItem.label)
          : t('Settings')

  return (
    <Page
      title={pageTitle}
      left={
        isSmallScreen && canGoBack ? (
          <IconButton
            className="controls"
            size="lg"
            iconSize={ICON_SIZE.touch}
            icon={IconChevronLeft}
            aria-label={t('Back')}
            onClick={() => router.history.back()}
          />
        ) : undefined
      }
    >
      <SettingsRoot />
      <Toaster richColors position="bottom-center" style={{ zIndex: 2147483647 }} />
    </Page>
  )
}

function matchesQuery(text: string, query: string) {
  return text.toLocaleLowerCase().includes(query)
}

interface SettingsSearchResult {
  key: string
  entry: SettingsSearchEntry
  label: string
  pageLabel: string
}

function useSettingsSearch(query: string): SettingsSearchResult[] {
  const { t } = useTranslation()
  return useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return []
    const navItems = getSettingsNavGroups().flatMap((group) => group.items)
    const pageLabel = (item: SettingsNavItem | undefined) =>
      item ? (item.noTranslate ? item.label : String(t(item.label))) : ''
    const pages: SettingsSearchResult[] = navItems.map((item) => ({
      key: `page:${item.key}`,
      entry: { page: item.key, label: item.label },
      label: pageLabel(item),
      pageLabel: '',
    }))
    const rows: SettingsSearchResult[] = SETTINGS_SEARCH_ENTRIES.flatMap((entry) => {
      const item = navItems.find((navItem) => navItem.key === entry.page)
      if (!item) return []
      return [
        {
          key: `${entry.page}:${entry.id}`,
          entry,
          label: String(t(entry.label, entry.labelOptions ?? {})),
          pageLabel: pageLabel(item),
        },
      ]
    })
    return [...pages, ...rows].filter(
      (result) => matchesQuery(result.label, normalized) || matchesQuery(result.entry.label, normalized)
    )
  }, [query, t])
}

function SettingsSearchInput({
  value,
  onChange,
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  inputRef?: React.RefObject<HTMLInputElement>
}) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  return (
    <TextInput
      ref={inputRef}
      data-testid={TestId.settings.search}
      size={isSmallScreen ? 'md' : 'sm'}
      radius="md"
      placeholder={t('Search settings') ?? ''}
      aria-label={t('Search settings') ?? undefined}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onChange('')
      }}
      leftSection={<ScalableIcon icon={IconSearch} size={ICON_SIZE.inline} strokeWidth={ICON_STROKE_WIDTH} />}
      rightSectionWidth={value || isSmallScreen ? undefined : 44}
      rightSection={
        value ? (
          <IconButton icon={IconX} iconSize={14} aria-label={t('Clear')} onClick={() => onChange('')} />
        ) : isSmallScreen ? undefined : (
          <Text span fz={11} c="chatbox-tertiary">
            {navigator.platform.toLowerCase().includes('mac') ? '⌘F' : 'Ctrl F'}
          </Text>
        )
      }
      enterKeyHint="search"
    />
  )
}

function SettingsSearchResults({
  results,
  onSelect,
}: {
  results: SettingsSearchResult[]
  onSelect: (result: SettingsSearchResult) => void
}) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  if (results.length === 0) {
    return (
      <Text fz={13} c="chatbox-tertiary" px="xs" py="sm">
        {t('No matching settings')}
      </Text>
    )
  }
  return (
    <div className="flex flex-col gap-0.5" data-testid={TestId.settings.searchResults}>
      {results.map((result) => (
        <UnstyledButton
          key={result.key}
          onClick={() => onSelect(result)}
          className={clsx(
            'flex flex-col items-start rounded-md px-2 hover:bg-chatbox-background-gray-secondary',
            isSmallScreen ? 'min-h-11 justify-center py-1' : 'py-1.5'
          )}
        >
          <Text fz={14} lh="20px" lineClamp={1}>
            {result.label}
          </Text>
          {result.pageLabel && (
            <Text fz={12} lh="16px" c="chatbox-tertiary" lineClamp={1}>
              {result.pageLabel}
            </Text>
          )}
        </UnstyledButton>
      ))}
    </div>
  )
}

export function SettingsRoot() {
  useBackupNavigationGuard()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = useSettingsSection()
  const activeKey = settingsNavKeyForSection(section)
  const isSmallScreen = useIsSmallScreen()
  const { providers: availableProviders } = useProviders()
  const isChatboxAIActivated = availableProviders.some((p) => p.id === 'chatbox-ai')
  const licensePlanName = useSettingsStore((s) => s.licensePlanName)
  const groups = useMemo(() => getSettingsNavGroups(), [])
  const meta = useSettingsNavMeta()
  const [query, setQuery] = useState('')
  const results = useSettingsSearch(query)
  const searchRef = useRef<HTMLInputElement>(null)
  const isIndex = pathname === '/settings' || pathname === '/settings/'

  useEffect(() => {
    if (isSmallScreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSmallScreen])

  const openResult = (result: SettingsSearchResult) => {
    setQuery('')
    void navigate({ to: `/settings/${result.entry.page}` as '/settings' })
    if (result.entry.id) settingsHighlightStore.getState().highlight(result.entry.id)
  }

  const itemLabel = (item: SettingsNavItem) => (item.noTranslate ? item.label : t(item.label))

  if (isSmallScreen) {
    if (!isIndex) {
      return (
        <SettingsDensityProvider density="touch">
          <Box flex={1} h="100%" className="overflow-auto">
            <Outlet />
          </Box>
        </SettingsDensityProvider>
      )
    }
    return (
      <div className="flex-1 h-full overflow-auto bg-chatbox-background-grouped">
        <div className="flex flex-col gap-5 px-3 pt-3 pb-6">
          <SettingsSearchInput value={query} onChange={setQuery} />
          {query ? (
            <div className="rounded-xl bg-chatbox-background-primary p-1">
              <SettingsSearchResults results={results} onSelect={openResult} />
            </div>
          ) : (
            <>
              <Link to="/settings/chatbox-ai" className="block no-underline">
                <Flex
                  align="center"
                  gap="sm"
                  className="rounded-xl bg-chatbox-background-primary px-3.5 py-3 text-chatbox-tint-primary"
                >
                  <Flex
                    align="center"
                    justify="center"
                    className="size-10 shrink-0 rounded-full bg-chatbox-background-brand-secondary text-chatbox-tint-brand"
                  >
                    <ScalableIcon icon={IconSparkles} size={22} strokeWidth={ICON_STROKE_WIDTH} />
                  </Flex>
                  <Flex direction="column" flex={1} miw={0}>
                    <Text fz={16} fw={600} lh="22px">
                      Chatbox AI
                    </Text>
                    <Text fz={13} lh="18px" c={isChatboxAIActivated ? 'chatbox-success' : 'chatbox-tertiary'} truncate>
                      {isChatboxAIActivated
                        ? [t('Activated'), licensePlanName].filter(Boolean).join(' · ')
                        : t('Not activated')}
                    </Text>
                  </Flex>
                  <ScalableIcon icon={IconChevronRight} size={20} className="text-chatbox-tint-tertiary" />
                </Flex>
              </Link>
              {groups
                .filter((group) => group.items.some((item) => item.key !== 'chatbox-ai'))
                .map((group) => (
                  <section key={group.title} className="flex flex-col gap-1.5">
                    <Text fz={12} fw={600} c="chatbox-tertiary" px={14}>
                      {t(group.title)}
                    </Text>
                    <div className="flex flex-col overflow-hidden rounded-xl bg-chatbox-background-primary">
                      {group.items
                        .filter((item) => item.key !== 'chatbox-ai')
                        .map((item, index) => (
                          <Link
                            key={item.key}
                            to={`/settings/${item.key}` as '/settings'}
                            data-testid={item.testId}
                            className={clsx(
                              'flex min-h-11 items-center gap-3 px-3.5 no-underline text-chatbox-tint-primary active:bg-chatbox-background-gray-secondary',
                              index > 0 && 'border-0 border-t border-solid border-chatbox-border-primary'
                            )}
                          >
                            <ScalableIcon
                              icon={item.icon}
                              size={20}
                              strokeWidth={ICON_STROKE_WIDTH}
                              className="shrink-0 text-chatbox-tint-secondary"
                            />
                            <Text fz={15} flex={1} lineClamp={1}>
                              {itemLabel(item)}
                            </Text>
                            {meta[item.key] && (
                              <Text fz={14} c="chatbox-tertiary" maw="45%" truncate>
                                {meta[item.key]}
                              </Text>
                            )}
                            <ScalableIcon
                              icon={IconChevronRight}
                              size={18}
                              className="shrink-0 text-chatbox-tint-tertiary"
                            />
                          </Link>
                        ))}
                    </div>
                  </section>
                ))}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <SettingsDensityProvider density="comfortable">
      <Flex flex={1} h="100%" miw={800}>
        <nav
          aria-label={t('Settings') ?? undefined}
          className="flex w-[232px] shrink-0 flex-col gap-3 overflow-auto border-0 border-r border-solid border-chatbox-border-primary px-2 py-3"
        >
          <SettingsSearchInput value={query} onChange={setQuery} inputRef={searchRef} />
          {query ? (
            <SettingsSearchResults results={results} onSelect={openResult} />
          ) : (
            groups.map((group) => (
              <div key={group.title} className="flex flex-col gap-0.5">
                <Text fz={12} fw={600} c="chatbox-tertiary" px={8} pb={2}>
                  {t(group.title)}
                </Text>
                {group.items.map((item) => {
                  const active = item.key === activeKey
                  return (
                    <Link
                      key={item.key}
                      disabled={pathname === `/settings/${item.key}`}
                      to={`/settings/${item.key}` as '/settings'}
                      data-testid={item.testId}
                      aria-current={active ? 'page' : undefined}
                      className={clsx(
                        'flex h-8 items-center gap-2 rounded-md px-2 no-underline select-none',
                        active
                          ? 'bg-chatbox-background-gray-secondary text-chatbox-tint-primary font-medium'
                          : 'text-chatbox-tint-secondary hover:bg-chatbox-background-gray-secondary'
                      )}
                    >
                      <ScalableIcon
                        icon={item.icon}
                        size={ICON_SIZE.nav}
                        strokeWidth={ICON_STROKE_WIDTH}
                        className="shrink-0"
                      />
                      <Text span fz={14} lh="20px" flex={1} lineClamp={1} className="!text-inherit !font-[inherit]">
                        {itemLabel(item)}
                      </Text>
                      {item.key === 'chatbox-ai' && isChatboxAIActivated && (
                        <Text span fz={11} c="chatbox-success">
                          {t('Activated')}
                        </Text>
                      )}
                    </Link>
                  )
                })}
              </div>
            ))
          )}
        </nav>
        <Box flex="1 1 80%" className="overflow-auto">
          <Outlet />
        </Box>
      </Flex>
    </SettingsDensityProvider>
  )
}
