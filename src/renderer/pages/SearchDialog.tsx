import { isActionAvailableInMode, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import { Dialog, DialogContent, useTheme } from '@mui/material'
import { TestId } from '@shared/automation/testids'
import type { Session } from '@shared/types'
import { useAtomValue } from 'jotai'
import { Loader2, ScanSearch } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Message from '@/components/chat/Message'
import Mark from '@/components/common/Mark'
import { BlockCodeCollapsedStateProvider } from '@/components/Markdown'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { currentSessionIdAtom } from '@/stores/atoms'
import { getSessionAgentModeEntry } from '@/stores/session/agent-mode'
import { searchSessions } from '@/stores/sessionHelpers'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import * as scrollActions from '../stores/scrollActions'
import { switchCurrentSession } from '../stores/session/crud'

type Props = {}

function resolveSearchResultSessionMode(session: Session) {
  return resolveSessionMode(getSessionAgentModeEntry(session.id, session).value)
}

// Hidden system prompts render as an invisible 1px placeholder in the chat, so a search hit
// pointing at one would jump to nothing; keep those hits out of the result list instead.
// Work Mode hides the prompt on its own, so its sessions are filtered whatever the setting says.
export function filterHiddenSystemPromptHits(results: Session[], hideSystemPromptMessage?: boolean): Session[] {
  const visible: Session[] = []
  let changed = false
  for (const session of results) {
    const hidesSystemPrompt =
      hideSystemPromptMessage ||
      !isActionAvailableInMode('session-system-prompt', resolveSearchResultSessionMode(session))
    const messages = hidesSystemPrompt
      ? session.messages.filter((message) => message.role !== 'system')
      : session.messages
    if (messages.length === session.messages.length) {
      visible.push(session)
      continue
    }
    changed = true
    if (messages.length > 0) {
      visible.push({ ...session, messages })
    }
  }
  return changed ? visible : results
}

export default function SearchDialog(props: Props) {
  const isSmallScreen = useIsSmallScreen()
  const open = useUIStore((s) => s.openSearchDialog)
  const setOpen = useUIStore((s) => s.setOpenSearchDialog)
  const globalOnly = useUIStore((s) => s.searchDialogGlobalOnly)
  const [mode, setMode] = useState<'command' | 'search-result'>('command')
  const [loading, setLoading] = useState<boolean>(false)
  const [searchInput, _setSearchInput] = useState('')
  const [searchResult, setSearchResult] = useState<Session[]>([])
  const [searchResultMarks, setSearchResultMarks] = useState<string[]>([])
  const theme = useTheme()
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)

  const currentSessionId = useAtomValue(currentSessionIdAtom)
  const hideSystemPromptMessage = useSettingsStore((s) => s.hideSystemPromptMessage)
  const visibleSearchResult = filterHiddenSystemPromptHits(searchResult, hideSystemPromptMessage)

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        ref.current?.focus()
        ref.current?.select() // 全选
      }, 200) // 延迟200毫秒，等待组件元素挂载完成
    }
  }, [open])
  const onSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget.value
    setMode('command')
    _setSearchInput(input)
  }
  const onSearchClick = (flag: 'current-session' | 'global') => {
    if (!searchInput.trim()) return
    setMode('search-result')
    setSearchResult([])
    setLoading(true)
    if (flag === 'current-session' && !currentSessionId) {
      setLoading(false)
      return
    }
    searchSessions(searchInput, flag === 'current-session' ? (currentSessionId ?? undefined) : undefined, (batches) => {
      setSearchResult((prev) => [...prev, ...batches])
    })
    setSearchResultMarks([searchInput])
    setLoading(false)
    ref.current?.select() // 搜索后全选输入框，方便删除回退
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (globalOnly && e.key === 'Enter' && searchInput.trim()) {
      e.preventDefault()
      onSearchClick('global')
    }
  }
  return (
    <Dialog
      keepMounted
      open={open}
      onClose={() => setOpen(false)}
      fullWidth
      maxWidth={mode === 'search-result' ? 'md' : 'sm'}
    >
      <DialogContent sx={{ padding: '0.5rem' }}>
        <Command shouldFilter={false} filter={(value, search) => 1}>
          <CommandInput
            ref={ref}
            autoFocus={!isSmallScreen}
            value={searchInput}
            onInput={onSearchInput}
            onKeyDown={onKeyDown}
            data-testid={TestId.session.searchInput}
            className={cn('border-none', 'shadow-none', theme.palette.mode === 'dark' ? 'text-white' : 'text-black')}
            placeholder={globalOnly ? t('Search conversations') + '...' : t('Type a command or search') + '...'}
          />
          {mode === 'command' && !globalOnly && (
            <CommandList>
              <CommandEmpty>{t('No results found')}</CommandEmpty>
              <CommandGroup heading={t('Search')}>
                <CommandItem
                  value="search-current-session"
                  data-testid={TestId.session.searchCurrent}
                  className={cn(
                    theme.palette.mode === 'dark' ? 'aria-selected:bg-slate-500' : 'aria-selected:bg-slate-100'
                  )}
                  onSelect={() => onSearchClick('current-session')}
                >
                  <ScanSearch className="mr-2 h-4 w-4" />
                  <span>
                    {t('Search in Current Conversation')}
                    {searchInput.length > 0 ? ` "${searchInput}"` : ''}
                  </span>
                </CommandItem>
                <CommandItem
                  value="search-global"
                  data-testid={TestId.session.searchAll}
                  className={cn(
                    theme.palette.mode === 'dark' ? 'aria-selected:bg-slate-500' : 'aria-selected:bg-slate-100'
                  )}
                  onSelect={() => onSearchClick('global')}
                >
                  <ScanSearch className="mr-2 h-4 w-4" />
                  <span>
                    {t('Search All Conversations')}
                    {searchInput.length > 0 ? ` "${searchInput}"` : ''}
                  </span>
                </CommandItem>
              </CommandGroup>
              {/* <CommandGroup heading="对话">
                            <CommandItem>
                                <ScanSearch className="mr-2 h-4 w-4" />
                                <span>创建新对话</span>
                            </CommandItem>
                            <CommandItem>
                                <ScanSearch className="mr-2 h-4 w-4" />
                                <span>清空当前对话</span>
                            </CommandItem>
                        </CommandGroup>
                        <CommandSeparator />
                        <CommandGroup heading="Settings">
                            <CommandItem>
                                <User className="mr-2 h-4 w-4" />
                                <span>Profile</span>
                                <CommandShortcut>⌘P</CommandShortcut>
                            </CommandItem>
                            <CommandItem>
                                <CreditCard className="mr-2 h-4 w-4" />
                                <span>Billing</span>
                                <CommandShortcut>⌘B</CommandShortcut>
                            </CommandItem>
                            <CommandItem>
                                <Settings className="mr-2 h-4 w-4" />
                                <span>Settings</span>
                                <CommandShortcut>⌘S</CommandShortcut>
                            </CommandItem>
                        </CommandGroup> */}
            </CommandList>
          )}
          {mode === 'search-result' && loading && (
            <div className="flex justify-center items-center">
              <Loader2 className="animate-spin" />
            </div>
          )}
          {mode === 'search-result' && !loading && (
            <BlockCodeCollapsedStateProvider defaultCollapsed={true}>
              <Mark marks={[searchInput]}>
                <CommandList>
                  <CommandEmpty>{t('No results found')}</CommandEmpty>
                  {visibleSearchResult.map((result, i) => (
                    <CommandGroup
                      key={i}
                      heading={`${t('Chat')} "${result.name}":`}
                      className={cn('[&_[cmdk-group-heading]]:font-bold', '[&_[cmdk-group-heading]]:opacity-50')}
                    >
                      {result.messages.map((message, j) => (
                        <CommandItem
                          key={`${i}-${j}`}
                          value={`result-${i}-${j}`}
                          className={cn(
                            theme.palette.mode === 'dark' ? 'bg-slate-600' : 'bg-slate-50',
                            theme.palette.mode === 'dark' ? 'aria-selected:bg-slate-500' : 'aria-selected:bg-slate-200',
                            'my-1',
                            'cursor-pointer',
                            'bg-opacity-50'
                          )}
                          onSelect={() => {
                            const targetSessionId = result.id
                            const targetMessageId = message.id
                            const needsSwitch = currentSessionId !== targetSessionId

                            if (needsSwitch) {
                              switchCurrentSession(targetSessionId)
                            }

                            setOpen(false)

                            // Scroll with retry mechanism to ensure message is visible
                            const tryScroll = async (attempt = 0, maxAttempts = 10) => {
                              const delay = needsSwitch ? (attempt === 0 ? 300 : 200) : 100
                              await new Promise((resolve) => setTimeout(resolve, delay))

                              const success = await scrollActions.scrollToMessage(targetSessionId, targetMessageId)

                              if (!success && attempt < maxAttempts) {
                                tryScroll(attempt + 1, maxAttempts)
                              }
                            }

                            tryScroll()
                          }}
                        >
                          {/* 下面这个隐藏元素，是为了避免这个问题：
                                                        当搜索结果列表中出现重复的元素（相同的消息），此时键盘上下键选中第二条重复消息，继续按向下键会错误切换到第一条重复消息；并且当选中其中一条消息时，重复的消息同样会有选中的显示样式。
                                                        这些异常都会影响使用。我猜测可能和默认行为是根据元素内容进行判断的，因此加上这个唯一的隐藏元素可以规避问题。 */}
                          <span className="hidden">
                            {result.id}-{message.id}-{i}-{j}
                          </span>
                          <Message
                            id={message.id}
                            key={'msg-' + message.id}
                            sessionId={result.id}
                            sessionType={result.type || 'chat'}
                            msg={message}
                            className="w-full"
                            buttonGroup="none"
                            sessionMode={resolveSearchResultSessionMode(result)}
                            small
                            assistantAvatarKey={result.assistantAvatarKey}
                            sessionPicUrl={result.picUrl}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Mark>
            </BlockCodeCollapsedStateProvider>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
