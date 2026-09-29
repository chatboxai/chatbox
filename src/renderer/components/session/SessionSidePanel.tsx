import { isThreadHistoryAvailable, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import { Loader, Text } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { BuiltInBrowserState } from '@shared/built-in-browser'
import type { Session } from '@shared/types'
import { IconAdjustmentsHorizontal, IconHistory, IconPlus, type IconProps, IconWorld, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { type ElementType, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { BuiltInBrowserView, useBuiltInBrowserState } from '@/components/chat/BuiltInBrowserPanel'
import { ICON_SIZE, ICON_STROKE_WIDTH, IconButton } from '@/components/common/IconButton'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { SettingsDensityProvider } from '@/components/settings/SettingsLayout'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import type { BuiltInBrowser } from '@/platform/interfaces'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { DEFAULT_SESSION_PANEL, type SessionPanelTab, uiStore, useUIStore } from '@/stores/uiStore'
import { SessionSettingsContent } from './SessionSettingsContent'
import { applySessionEdit, type SessionEdit } from './session-edit'
import ThreadHistoryList from './ThreadHistoryList'

export const SESSION_PANEL_MIN_WIDTH = 320
const SESSION_PANEL_MAX_RATIO = 0.7

/**
 * Applies conversation settings edits to the stored session right away. Hosts render one instance
 * per conversation, so every edit lands in the conversation it was typed in.
 */
export function usePersistedSessionEdit(session: Session) {
  const sessionRef = useRef(session)
  sessionRef.current = session
  return useCallback((edit: SessionEdit) => {
    const current = sessionRef.current
    // A reply may be streaming while settings change; keep its cached chunks in the written snapshot.
    void rendererApplication.sessions.updateSessionWithMessages(
      current.id,
      (stored) => applySessionEdit(stored ?? current, edit),
      { preserveCachedGeneratingMessages: true }
    )
  }, [])
}

export function useSessionPanel(sessionId: string) {
  return useUIStore((s) => s.sessionPanels[sessionId] ?? DEFAULT_SESSION_PANEL)
}

/** Shows another panel tab. */
export function showSessionPanelTab(sessionId: string, tab: SessionPanelTab) {
  uiStore.getState().openSessionPanel(sessionId, tab)
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
}: {
  icon: ElementType<IconProps>
  label: string
  active: boolean
  pinned?: boolean
  status?: 'loading' | 'unseen'
  onSelect: () => void
  onClose?: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const tab = (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={label}
      data-testid={testId}
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
        pinned ? 'w-8 justify-center' : 'min-w-[72px] max-w-[200px] ps-2 pe-1',
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
 * the tab strip and content tabs (the built-in browser page) after them. The panel pushes the
 * chat aside rather than covering it. A page the model starts reading opens the panel when it is
 * closed and otherwise waits in its tab with a status mark.
 */
export function SessionSidePanel({ session, builtInBrowser }: { session: Session; builtInBrowser?: BuiltInBrowser }) {
  return builtInBrowser ? (
    <BrowserBackedSessionPanel session={session} builtInBrowser={builtInBrowser} />
  ) : (
    <SessionPanelHost session={session} />
  )
}

function BrowserBackedSessionPanel({ session, builtInBrowser }: { session: Session; builtInBrowser: BuiltInBrowser }) {
  const browserState = useBuiltInBrowserState(builtInBrowser)
  return <SessionPanelHost session={session} builtInBrowser={builtInBrowser} browserState={browserState} />
}

function SessionPanelHost({
  session,
  builtInBrowser,
  browserState,
}: {
  session: Session
  builtInBrowser?: BuiltInBrowser
  browserState?: BuiltInBrowserState
}) {
  const open = useUIStore((s) => s.sessionPanels[session.id]?.open ?? false)

  useEffect(() => {
    if (browserState?.reading) uiStore.getState().revealSessionWebTab(session.id)
  }, [browserState?.reading, session.id])

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
  return <OpenSessionPanel session={session} builtInBrowser={builtInBrowser} browserState={browserState} />
}

function OpenSessionPanel({
  session,
  builtInBrowser,
  browserState,
}: {
  session: Session
  builtInBrowser?: BuiltInBrowser
  browserState?: BuiltInBrowserState
}) {
  const { t } = useTranslation()
  const panel = useSessionPanel(session.id)
  const width = useUIStore((s) => s.sessionPanelWidth)
  const closeWebTab = useUIStore((s) => s.closeSessionWebTab)
  const ref = useRef<HTMLElement>(null)
  const startResize = useResizeHandle(ref)
  const mode = resolveSessionMode(useSessionAgentMode(session.id).value)
  const onEdit = usePersistedSessionEdit(session)
  const showThreads = isThreadHistoryAvailable(session, mode)
  const showWebTab = Boolean(builtInBrowser && panel.webTabOpen)

  const tabs: SessionPanelTab[] = [
    'settings',
    ...(showThreads ? (['threads'] as const) : []),
    ...(showWebTab ? (['web'] as const) : []),
  ]
  const activeTab: SessionPanelTab = tabs.includes(panel.tab) ? panel.tab : 'settings'

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault()
      // Ctrl+Tab elsewhere switches conversations; inside the panel it only switches tabs.
      event.stopPropagation()
      const index = tabs.indexOf(activeTab)
      const next = tabs[(index + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length]
      showSessionPanelTab(session.id, next)
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
        {showWebTab && (
          <>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-chatbox-border-primary" aria-hidden />
            <PanelTab
              icon={IconWorld}
              label={browserState?.title || browserState?.url || t('Built-in Browser')}
              active={activeTab === 'web'}
              status={
                browserState?.reading || (activeTab !== 'web' && browserState?.loading)
                  ? 'loading'
                  : panel.webUnseen
                    ? 'unseen'
                    : undefined
              }
              onSelect={() => showSessionPanelTab(session.id, 'web')}
              onClose={() => closeWebTab(session.id)}
              testId={TestId.sessionPanel.tabWeb}
            />
          </>
        )}
        <div className="min-w-0 flex-1" />
        {builtInBrowser && !showWebTab && (
          <IconButton
            icon={IconPlus}
            iconSize={ICON_SIZE.inline}
            aria-label={t('Open built-in browser')}
            data-testid={TestId.sessionPanel.newWebTab}
            onClick={() => showSessionPanelTab(session.id, 'web')}
          />
        )}
        <IconButton
          icon={IconX}
          iconSize={ICON_SIZE.inline}
          aria-label={t('Close panel')}
          data-testid={TestId.sessionPanel.close}
          onClick={() => closeSessionPanel(session.id)}
        />
      </div>
      {activeTab === 'web' && builtInBrowser && browserState ? (
        <BuiltInBrowserView builtInBrowser={builtInBrowser} state={browserState} />
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
