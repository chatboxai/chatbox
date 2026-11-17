import type { SessionSearchHit } from '@chatbox/core/application/session'
import { Dialog, DialogContent, useTheme } from '@mui/material'
import { TestId } from '@shared/automation/testids'
import { useAtomValue } from 'jotai'
import { Loader2, ScanSearch } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Mark from '@/components/common/Mark'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { currentSessionIdAtom } from '@/stores/atoms'
import { switchCurrentSession } from '@/stores/session/crud'
import { prepareSessionSearchTarget } from '@/stores/session-search-target'
import { searchSessions } from '@/stores/sessionHelpers'
import { useSettingsStore } from '@/stores/settingsStore'
import { uiStore, useUIStore } from '@/stores/uiStore'

export default function SearchDialog() {
  const isSmallScreen = useIsSmallScreen()
  const open = useUIStore((s) => s.openSearchDialog)
  const setOpen = useUIStore((s) => s.setOpenSearchDialog)
  const globalOnly = useUIStore((s) => s.searchDialogGlobalOnly)
  const [mode, setMode] = useState<'command' | 'search-result'>('command')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchResult, setSearchResult] = useState<SessionSearchHit[]>([])
  const [searchMark, setSearchMark] = useState('')
  const request = useRef<AbortController | null>(null)
  const theme = useTheme()
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)
  const currentSessionId = useAtomValue(currentSessionIdAtom)
  const hideSystemPromptMessage = useSettingsStore((s) => s.hideSystemPromptMessage)
  const groups = new Map<string, SessionSearchHit[]>()
  for (const hit of searchResult) {
    const group = groups.get(hit.sessionId) ?? []
    group.push(hit)
    groups.set(hit.sessionId, group)
  }

  const cancelSearch = () => {
    request.current?.abort()
    request.current = null
  }
  useEffect(() => {
    if (!open) {
      request.current?.abort()
      request.current = null
      setLoading(false)
      return
    }
    const timer = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 200)
    return () => {
      clearTimeout(timer)
      request.current?.abort()
      request.current = null
    }
  }, [open])

  const close = () => {
    cancelSearch()
    setLoading(false)
    setOpen(false)
  }
  const onSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    cancelSearch()
    setLoading(false)
    setFailed(false)
    setMode('command')
    setSearchInput(e.currentTarget.value)
  }
  const onSearchClick = async (flag: 'current-session' | 'global') => {
    const query = searchInput.trim()
    if (!query || (flag === 'current-session' && !currentSessionId)) return
    cancelSearch()
    const controller = new AbortController()
    request.current = controller
    const isCurrent = () => request.current === controller && !controller.signal.aborted
    setMode('search-result')
    setSearchResult([])
    setFailed(false)
    setLoading(true)
    setSearchMark(query)
    ref.current?.select()
    try {
      const result = await searchSessions(query, {
        sessionId: flag === 'current-session' ? (currentSessionId ?? undefined) : undefined,
        hideSystemPromptMessage,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!isCurrent()) return
          setSearchResult(progress.hits)
          setFailed(progress.failedSessionIds.length > 0)
        },
      })
      if (isCurrent()) {
        setSearchResult(result.hits)
        setFailed(result.failedSessionIds.length > 0)
      }
    } catch {
      if (isCurrent()) setFailed(true)
    } finally {
      if (isCurrent()) {
        request.current = null
        setLoading(false)
      }
    }
  }
  const selectHit = (hit: SessionSearchHit) => {
    if (currentSessionId !== hit.sessionId) {
      if (hit.messageId) prepareSessionSearchTarget(hit.sessionId, hit.messageId)
      void switchCurrentSession(hit.sessionId)
    } else if (hit.messageId) {
      const navigation = uiStore.getState().transcriptNavigation
      if (navigation?.sessionId === hit.sessionId) void navigation.openSearch(hit.messageId)
    }
    close()
  }

  return (
    <Dialog keepMounted open={open} onClose={close} fullWidth maxWidth={mode === 'search-result' ? 'md' : 'sm'}>
      <DialogContent sx={{ padding: '0.5rem' }}>
        <Command shouldFilter={false}>
          <CommandInput
            ref={ref}
            autoFocus={!isSmallScreen}
            value={searchInput}
            onInput={onSearchInput}
            onKeyDown={(event) => {
              if (globalOnly && event.key === 'Enter' && searchInput.trim()) {
                event.preventDefault()
                void onSearchClick('global')
              }
            }}
            data-testid={TestId.session.searchInput}
            className={cn('border-none', 'shadow-none', theme.palette.mode === 'dark' ? 'text-white' : 'text-black')}
            placeholder={globalOnly ? `${t('Search conversations')}...` : `${t('Type a command or search')}...`}
          />
          {mode === 'command' && !globalOnly && (
            <CommandList>
              <CommandGroup heading={t('Search')}>
                {(['current-session', 'global'] as const).map((flag) => (
                  <CommandItem
                    key={flag}
                    value={`search-${flag}`}
                    data-testid={flag === 'global' ? TestId.session.searchAll : TestId.session.searchCurrent}
                    className={
                      theme.palette.mode === 'dark' ? 'aria-selected:bg-slate-500' : 'aria-selected:bg-slate-100'
                    }
                    onSelect={() => void onSearchClick(flag)}
                  >
                    <ScanSearch className="mr-2 h-4 w-4" />
                    <span>
                      {t(flag === 'global' ? 'Search All Conversations' : 'Search in Current Conversation')}
                      {searchInput.length > 0 ? ` "${searchInput}"` : ''}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          )}
          {mode === 'search-result' && (
            <>
              {loading && (
                <div role="status" aria-label={String(t('Search'))} className="flex justify-center items-center py-2">
                  <Loader2 className="animate-spin" />
                </div>
              )}
              {failed && (
                <div role="alert" className="px-2 py-1">
                  {t('Error')}
                </div>
              )}
              <Mark marks={[searchMark]}>
                <CommandList>
                  {!loading && !failed && <CommandEmpty>{t('No results found')}</CommandEmpty>}
                  {[...groups].map(([sessionId, hits], groupIndex) => (
                    <CommandGroup
                      key={sessionId}
                      heading={`${t('Chat')} "${hits[0].sessionName}":`}
                      className={cn('[&_[cmdk-group-heading]]:font-bold', '[&_[cmdk-group-heading]]:opacity-50')}
                    >
                      {hits.map((hit, hitIndex) => (
                        <CommandItem
                          key={JSON.stringify([hit.sessionId, hit.messageId])}
                          value={`result-${groupIndex}-${hitIndex}`}
                          className={cn(
                            theme.palette.mode === 'dark'
                              ? 'bg-slate-600 aria-selected:bg-slate-500'
                              : 'bg-slate-50 aria-selected:bg-slate-200',
                            'my-1 cursor-pointer bg-opacity-50'
                          )}
                          onSelect={() => selectHit(hit)}
                        >
                          <span className="w-full whitespace-pre-wrap break-words">{hit.preview}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Mark>
            </>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
