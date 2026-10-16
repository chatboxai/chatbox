import { isThreadHistoryAvailable, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import { Loader, Text } from '@mantine/core'
import { AutomationAdjacentAttr, TestId } from '@shared/automation/testids'
import { BUILT_IN_BROWSER_MAX_TABS, type BuiltInBrowserTabs } from '@shared/built-in-browser'
import type { Session } from '@shared/types'
import { IconAdjustmentsHorizontal, IconHistory, IconPlus, type IconProps, IconWorld, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import {
  type ElementType,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { BuiltInBrowserView, useBuiltInBrowserTabs } from '@/components/chat/BuiltInBrowserPanel'
import { ICON_SIZE, ICON_STROKE_WIDTH, IconButton } from '@/components/common/IconButton'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { SettingsDensityProvider } from '@/components/settings/SettingsLayout'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import type { BuiltInBrowser } from '@/platform/interfaces'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import * as toastActions from '@/stores/toastActions'
import { DEFAULT_SESSION_PANEL, type SessionPanelTab, uiStore, useUIStore } from '@/stores/uiStore'
import { SessionSettingsContent } from './SessionSettingsContent'
import { applySessionEdit, applySessionHeaderEdit, type SessionEdit } from './session-edit'
import ThreadHistoryList from './ThreadHistoryList'

export const SESSION_PANEL_MIN_WIDTH = 320

function reportPanelError(error: unknown): undefined {
  toastActions.add(error instanceof Error ? error.message : String(error))
  return undefined
}
const SESSION_PANEL_MAX_RATIO = 0.7

/**
 * Applies conversation settings edits to the stored session right away. Hosts render one instance
 * per conversation, so every edit lands in the conversation it was typed in.
 */
export function usePersistedSessionEdit(session: Session) {
  const sessionRef = useRef(session)
  sessionRef.current = session
  return useCallback(async (edit: SessionEdit) => {
    const current = sessionRef.current
    const { systemPrompt, ...headerEdit } = edit
    const writes: Promise<unknown>[] = []
    if (systemPrompt !== undefined) {
      // A reply may be streaming while settings change; keep its cached chunks in the written snapshot.
      writes.push(
        rendererApplication.sessions.updateSessionWithMessages(
          current.id,
          (stored) => applySessionEdit(stored ?? current, { systemPrompt }),
          { preserveCachedGeneratingMessages: true }
        )
      )
    }
    if (Object.keys(headerEdit).length > 0) {
      // Header-only edits commit the session record alone, without reading or rewriting its messages.
      writes.push(
        rendererApplication.sessions.updateSessionHeader(current.id, (stored) => {
          if (!stored) throw new Error('Session not found')
          return applySessionHeaderEdit(stored, headerEdit)
        })
      )
    }
    await Promise.all(writes)
  }, [])
}

export function useSessionPanel(sessionId: string) {
  return useUIStore((s) => s.sessionPanels[sessionId] ?? DEFAULT_SESSION_PANEL)
}

/** Shows another panel tab; `webTab` picks the browser tab of the `web` tab. */
export function showSessionPanelTab(sessionId: string, tab: SessionPanelTab, webTab?: string) {
  uiStore.getState().openSessionPanel(sessionId, tab, webTab)
}

/** Closes the panel or sheet; fields being edited apply their text as they unmount. */
export function closeSessionPanel(sessionId: string) {
  uiStore.getState().closeSessionPanel(sessionId)
}

/** Toggles the panel on its last tab; ⌘\ / Ctrl+\ does the same from anywhere in the conversation. */
export function toggleSessionPanel(sessionId: string) {
  if (uiStore.getState().sessionPanels[sessionId]?.open) closeSessionPanel(sessionId)
  else uiStore.getState().openSessionPanel(sessionId)
}

function PanelTab({
  icon,
  label,
  active,
  pinned,
  status,
  onSelect,
  onClose,
  testId,
  browserTabId,
}: {
  icon: ElementType<IconProps>
  label: string
  active: boolean
  pinned?: boolean
  status?: 'loading' | 'unseen'
  onSelect: () => void
  onClose?: () => void
  testId?: string
  browserTabId?: string
}) {
  const { t } = useTranslation()
  const tab = (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={label}
      data-testid={testId}
      {...(browserTabId ? { [AutomationAdjacentAttr.browserTabId]: browserTabId } : {})}
      data-active={active || undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={clsx(
        'group/tab relative flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md border border-solid outline-none focus-visible:ring-2 focus-visible:ring-chatbox-border-brand',
        pinned ? 'w-8 justify-center' : 'min-w-[72px] max-w-[min(200px,100%)] ps-2 pe-1',
        active
          ? 'border-chatbox-border-primary bg-chatbox-background-primary text-chatbox-tint-primary'
          : 'border-transparent text-chatbox-tint-secondary hover:bg-chatbox-background-gray-secondary'
      )}
    >
      <span className="relative flex shrink-0">
        <ScalableIcon icon={icon} size={ICON_SIZE.inline} strokeWidth={ICON_STROKE_WIDTH} />
      </span>
      {!pinned && (
        <Text span fz={12} fw={active ? 500 : 400} truncate className="min-w-0 flex-1 !text-inherit">
          {label}
        </Text>
      )}
      {status === 'loading' && <Loader size={10} color="chatbox-brand" className="shrink-0" />}
      {status === 'unseen' && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-chatbox-tint-brand"
          aria-label={t('New activity') ?? undefined}
        />
      )}
      {onClose && (
        <IconButton
          icon={IconX}
          iconSize={12}
          className={clsx('!size-5 !min-h-5 !min-w-5', active ? '' : 'invisible group-hover/tab:visible')}
          aria-label={t('Close tab')}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        />
      )}
    </div>
  )
  return pinned ? (
    <Tooltip label={label} withArrow>
      {tab}
    </Tooltip>
  ) : (
    tab
  )
}

function useResizeHandle(container: React.RefObject<HTMLElement>) {
  const setWidth = useUIStore((s) => s.setSessionPanelWidth)
  return (event: PointerEvent<HTMLDivElement>) => {
    const panel = container.current
    const parent = panel?.parentElement
    if (!panel || !parent) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const right = panel.getBoundingClientRect().right
    const max = parent.getBoundingClientRect().width * SESSION_PANEL_MAX_RATIO
    const onMove = (move: globalThis.PointerEvent) => {
      setWidth(Math.round(Math.min(max, Math.max(SESSION_PANEL_MIN_WIDTH, right - move.clientX))))
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }
}

/**
 * Conversation side panel: pinned tools (conversation settings, thread history) on the left of
 * the tab strip and content tabs (the built-in browser's pages) after them. The panel pushes the
 * chat aside rather than covering it. A page the model starts reading opens the panel when it is
 * closed and otherwise waits in its tab with a status mark, without taking the user's tab away.
 */
export function SessionSidePanel({ session, builtInBrowser }: { session: Session; builtInBrowser?: BuiltInBrowser }) {
  return builtInBrowser ? (
    <BrowserBackedSessionPanel session={session} builtInBrowser={builtInBrowser} />
  ) : (
    <SessionPanelHost session={session} />
  )
}

function BrowserBackedSessionPanel({ session, builtInBrowser }: { session: Session; builtInBrowser: BuiltInBrowser }) {
  const browserTabs = useBuiltInBrowserTabs(builtInBrowser)
  return <SessionPanelHost session={session} builtInBrowser={builtInBrowser} browserTabs={browserTabs} />
}

/**
 * Keeps the panel in step with the conversation's browser tabs: a tab that starts reading is
 * brought forward (or marked unseen), and a tab that closes leaves the panel.
 */
export function useBrowserTabPanelSync(sessionId: string, browserTabs: BuiltInBrowserTabs | undefined) {
  const readingKey = browserTabs?.tabs
    .filter((tab) => tab.reading)
    .map((tab) => tab.id)
    .join(' ')
  const tabsKey = browserTabs?.tabs.map((tab) => tab.id).join(' ')
  const previousTabs = useRef<string[]>([])
  const previousReading = useRef<string[]>([])

  // Only a tab that starts reading is revealed; one still reading when another finishes is not.
  useEffect(() => {
    const reading = readingKey ? readingKey.split(' ') : []
    for (const id of reading) {
      if (!previousReading.current.includes(id)) uiStore.getState().revealSessionWebTab(sessionId, id)
    }
    previousReading.current = reading
  }, [readingKey, sessionId])

  // A tab closed by the user, by clearing browser data or by the main process leaves the panel.
  useEffect(() => {
    const current = tabsKey ? tabsKey.split(' ') : []
    for (const [index, id] of previousTabs.current.entries()) {
      if (current.includes(id)) continue
      const neighbour = current[Math.min(index, current.length - 1)]
      uiStore.getState().forgetSessionWebTab(sessionId, id, neighbour)
    }
    previousTabs.current = current
  }, [tabsKey, sessionId])
}

function SessionPanelHost({
  session,
  builtInBrowser,
  browserTabs,
}: {
  session: Session
  builtInBrowser?: BuiltInBrowser
  browserTabs?: BuiltInBrowserTabs
}) {
  const open = useUIStore((s) => s.sessionPanels[session.id]?.open ?? false)
  useBrowserTabPanelSync(session.id, browserTabs)

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === '\\') {
        event.preventDefault()
        toggleSessionPanel(session.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [session.id])

  if (!open) return null
  return <OpenSessionPanel session={session} builtInBrowser={builtInBrowser} browserTabs={browserTabs} />
}

/** Panel tab keys: the pinned tools, then `web:<browser tab id>` for each page. */
type PanelTabKey = 'settings' | 'threads' | `web:${string}`

function OpenSessionPanel({
  session,
  builtInBrowser,
  browserTabs,
}: {
  session: Session
  builtInBrowser?: BuiltInBrowser
  browserTabs?: BuiltInBrowserTabs
}) {
  const { t } = useTranslation()
  const panel = useSessionPanel(session.id)
  const width = useUIStore((s) => s.sessionPanelWidth)
  const ref = useRef<HTMLElement>(null)
  const tabStripRef = useRef<HTMLDivElement>(null)
  const startResize = useResizeHandle(ref)
  const mode = resolveSessionMode(useSessionAgentMode(session.id).value)
  const onEdit = usePersistedSessionEdit(session)
  const showThreads = isThreadHistoryAvailable(session, mode)
  const pages = builtInBrowser ? (browserTabs?.tabs ?? []) : []

  const tabs: PanelTabKey[] = [
    'settings',
    ...(showThreads ? (['threads'] as const) : []),
    ...pages.map((page) => `web:${page.id}` as const),
  ]
  const requested: PanelTabKey = panel.tab === 'web' ? `web:${panel.webTab ?? ''}` : panel.tab
  // Until the first tab list arrives, a web tab the panel was on stays chosen instead of falling back.
  const loadingPages = Boolean(builtInBrowser) && !browserTabs && panel.tab === 'web'
  const activeTab: PanelTabKey = tabs.includes(requested) || loadingPages ? requested : 'settings'
  const activePage = pages.find((page) => activeTab === `web:${page.id}`)

  useLayoutEffect(() => {
    const strip = tabStripRef.current
    if (!strip) return
    const revealActiveTab = () => {
      strip
        .querySelector<HTMLElement>('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    revealActiveTab()
    const observer = new ResizeObserver(revealActiveTab)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [activeTab, activePage?.title, activePage?.url, pages.length])

  useEffect(() => {
    const strip = tabStripRef.current
    if (!strip) return
    const onWheel = (event: WheelEvent) => {
      if (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const previous = strip.scrollLeft
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1)
      strip.scrollLeft += delta
      if (strip.scrollLeft !== previous) event.preventDefault()
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [])

  const show = (key: PanelTabKey) => {
    if (key === 'settings' || key === 'threads') showSessionPanelTab(session.id, key)
    else showSessionPanelTab(session.id, 'web', key.slice('web:'.length))
  }

  const openPage = async () => {
    if (!builtInBrowser) return
    const id = await builtInBrowser.openTab().catch(reportPanelError)
    if (id) showSessionPanelTab(session.id, 'web', id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault()
      // Ctrl+Tab elsewhere switches conversations; inside the panel it only switches tabs.
      event.stopPropagation()
      const index = tabs.indexOf(activeTab)
      show(tabs[(index + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length])
    }
  }

  return (
    <aside
      ref={ref}
      data-testid={TestId.sessionPanel.root}
      aria-label={t('Conversation panel') ?? undefined}
      onKeyDown={onKeyDown}
      className="relative flex h-full shrink-0 flex-col border-0 border-l border-solid border-chatbox-border-primary bg-chatbox-background-primary"
      style={{
        width: width ?? 'min(560px, 45%)',
        minWidth: SESSION_PANEL_MIN_WIDTH,
        maxWidth: `${SESSION_PANEL_MAX_RATIO * 100}%`,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('Resize panel') ?? undefined}
        onPointerDown={startResize}
        onDoubleClick={() => uiStore.getState().setSessionPanelWidth(null)}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-chatbox-background-brand-secondary"
      />
      <div
        role="tablist"
        aria-label={t('Conversation panel') ?? undefined}
        className="flex h-10 shrink-0 items-center gap-1 border-0 border-b border-solid border-chatbox-border-primary bg-chatbox-background-secondary px-1.5"
      >
        <PanelTab
          pinned
          icon={IconAdjustmentsHorizontal}
          label={t('Conversation Settings')}
          active={activeTab === 'settings'}
          onSelect={() => showSessionPanelTab(session.id, 'settings')}
          testId={TestId.sessionPanel.tabSettings}
        />
        {showThreads && (
          <PanelTab
            pinned
            icon={IconHistory}
            label={t('Thread History')}
            active={activeTab === 'threads'}
            onSelect={() => showSessionPanelTab(session.id, 'threads')}
            testId={TestId.sessionPanel.tabThreads}
          />
        )}
        {pages.length > 0 && <span className="mx-0.5 h-4 w-px shrink-0 bg-chatbox-border-primary" aria-hidden />}
        <div
          ref={tabStripRef}
          className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]"
        >
          {pages.map((page) => {
            const key = `web:${page.id}` as const
            const active = activeTab === key
            return (
              <PanelTab
                key={page.id}
                icon={IconWorld}
                label={page.title || page.url || t('New tab')}
                active={active}
                status={
                  page.reading || (!active && page.loading)
                    ? 'loading'
                    : panel.unseenWebTabs.includes(page.id)
                      ? 'unseen'
                      : undefined
                }
                onSelect={() => show(key)}
                onClose={() => void builtInBrowser?.closeTab(page.id).catch(reportPanelError)}
                testId={TestId.sessionPanel.tabWeb}
                browserTabId={page.id}
              />
            )
          })}
        </div>
        {builtInBrowser && pages.length < BUILT_IN_BROWSER_MAX_TABS && (
          <IconButton
            icon={IconPlus}
            iconSize={ICON_SIZE.inline}
            className="shrink-0"
            aria-label={t('New tab')}
            data-testid={TestId.sessionPanel.newWebTab}
            onClick={() => void openPage()}
          />
        )}
        <IconButton
          icon={IconX}
          iconSize={ICON_SIZE.inline}
          className="shrink-0"
          aria-label={t('Close panel')}
          data-testid={TestId.sessionPanel.close}
          onClick={() => closeSessionPanel(session.id)}
        />
      </div>
      {activePage && builtInBrowser ? (
        <BuiltInBrowserView key={activePage.id} builtInBrowser={builtInBrowser} tab={activePage} />
      ) : loadingPages ? (
        <div className="min-h-0 flex-1" role="tabpanel" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" role="tabpanel">
          {activeTab === 'threads' ? (
            <ThreadHistoryList session={session} />
          ) : (
            <SettingsDensityProvider density="compact">
              <SessionSettingsContent session={session} mode={mode} onEdit={onEdit} />
            </SettingsDensityProvider>
          )}
        </div>
      )}
    </aside>
  )
}
