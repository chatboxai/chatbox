import { ActionIcon, Popover, Text, UnstyledButton } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { AgentModeValue, KnowledgeBase } from '@shared/types'
import { IconRobot, IconX } from '@tabler/icons-react'
import { useLocation } from '@tanstack/react-router'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { blurMessageInput } from '@/hooks/dom'
import { getWebSearchConfigurationIssue } from '@/packages/web-search/configuration-issue'
import platform from '@/platform'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { useSettingsStore } from '@/stores/settingsStore'
import AgentModePanel, { type AgentModePanelHandle } from './AgentModePanel'
import AgentModeStatusIcon from './AgentModeStatusIcon'
import { getAgentModeUIState } from './agentModeState'
import { useComposerMenuStore } from './composerMenuStore'
import { type ComposerMenuLayout, resolveComposerMenuLayout, useComposerTouchLayout } from './composerTouchLayout'

interface AgentModeButtonProps {
  sessionId: string
  providerId?: string
  modelId?: string
  iconSize?: number
  /** Small screens render the mode as an icon status badge instead of a text label. */
  compact?: boolean
  modelSupportsAgentMode?: boolean
  webBrowsingMode: boolean
  onWebBrowsingChange: (enabled: boolean) => void
  currentKnowledgeBaseId?: number
  onKnowledgeBaseSelect: (kb: KnowledgeBase | null) => void
  onSkillSelect: (skillName: string) => void
  /** Copilot picked on the new-chat page, where the draft session is not persisted yet. */
  draftCopilotId?: string
  draftCopilotName?: string
  /** Override the auto-detected desktop flyout vs touch sheet. */
  layout?: ComposerMenuLayout
}

const MODE_COLORS: Record<AgentModeValue, string> = {
  on: 'var(--chatbox-tint-brand)',
  off: 'var(--chatbox-tint-secondary)',
  auto: 'var(--chatbox-tint-secondary)',
}

const OPEN_DELAY = 100
const CLOSE_DELAY = 250
const WEB_SEARCH_MOVED_TIP_DISMISSED_KEY = 'chatbox.web-search-moved-tip-dismissed.v1'

function isWebSearchMovedTipDismissed() {
  try {
    return window.localStorage.getItem(WEB_SEARCH_MOVED_TIP_DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

const AgentModeButton: FC<AgentModeButtonProps> = ({
  sessionId,
  providerId,
  modelId,
  iconSize = 18,
  compact = false,
  modelSupportsAgentMode = true,
  webBrowsingMode,
  onWebBrowsingChange,
  currentKnowledgeBaseId,
  onKnowledgeBaseSelect,
  onSkillSelect,
  draftCopilotId,
  draftCopilotName,
  layout,
}) => {
  const { t } = useTranslation()
  const location = useLocation()
  const detectedTouchLayout = useComposerTouchLayout()
  const resolvedLayout = resolveComposerMenuLayout(layout, detectedTouchLayout)
  const isTouchLayout = resolvedLayout === 'touch'
  const panelRef = useRef<AgentModePanelHandle>(null)
  const [opened, setOpened] = useState(false)
  const [showWebSearchMovedTip, setShowWebSearchMovedTip] = useState(() => !isWebSearchMovedTipDismissed())
  const openTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const entry = useSessionAgentMode(sessionId)
  const webSearchConfiguration = useSettingsStore((state) => state.extension.webSearch)
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const hasWebSearchWarning =
    webBrowsingMode && getWebSearchConfigurationIssue(webSearchConfiguration, licenseKey) !== null
  const settingsOpened =
    Boolean((location.search as Record<string, unknown>)?.settings) || location.pathname.startsWith('/settings')

  const agentModeUIState = useMemo(
    () => getAgentModeUIState(entry, modelSupportsAgentMode),
    [entry, modelSupportsAgentMode]
  )
  const color = useMemo(() => {
    return MODE_COLORS[agentModeUIState.displayValue]
  }, [agentModeUIState.displayValue])

  const modeLabel = useMemo(() => {
    switch (agentModeUIState.displayValue) {
      case 'on':
        return t('Work Mode')
      default:
        return t('Chat Mode')
    }
  }, [agentModeUIState.displayValue, t])

  // The status-row chip menus overlap the same area above the composer; the shared
  // slot keeps the hover panel (and the one-time tip) mutually exclusive with them.
  const suppressedByChipMenu = useComposerMenuStore((s) => s.activeMenu !== null && s.activeMenu !== 'work-mode-panel')
  const setPanelOpened = useCallback(
    (next: boolean) => {
      setOpened(next)
      const { openMenu, closeMenu } = useComposerMenuStore.getState()
      if (next) {
        openMenu('work-mode-panel')
        if (isTouchLayout) {
          blurMessageInput()
        }
      } else {
        closeMenu('work-mode-panel')
      }
    },
    [isTouchLayout]
  )

  // Hover open/close with delays, matching Menu trigger="hover" behavior
  const handleMouseEnter = useCallback(() => {
    if (isTouchLayout) return
    clearTimeout(closeTimerRef.current)
    openTimerRef.current = setTimeout(() => setPanelOpened(true), OPEN_DELAY)
  }, [isTouchLayout, setPanelOpened])

  const handleMouseLeave = useCallback(() => {
    if (isTouchLayout) return
    clearTimeout(openTimerRef.current)
    closeTimerRef.current = setTimeout(() => setPanelOpened(false), CLOSE_DELAY)
  }, [isTouchLayout, setPanelOpened])

  const handleClose = useCallback(() => {
    clearTimeout(openTimerRef.current)
    clearTimeout(closeTimerRef.current)
    setPanelOpened(false)
  }, [setPanelOpened])

  useEffect(() => {
    if (suppressedByChipMenu) {
      handleClose()
    }
  }, [suppressedByChipMenu, handleClose])

  const handleDismissWebSearchMovedTip = useCallback(() => {
    setShowWebSearchMovedTip(false)
    setPanelOpened(false)
    try {
      window.localStorage.setItem(WEB_SEARCH_MOVED_TIP_DISMISSED_KEY, 'true')
    } catch {
      // Keep the tip dismissed for this render even if persistent storage is unavailable.
    }
  }, [setPanelOpened])

  useEffect(() => {
    return () => {
      clearTimeout(openTimerRef.current)
      clearTimeout(closeTimerRef.current)
      // Release the shared slot if the hover panel still owns it when the composer unmounts.
      useComposerMenuStore.getState().closeMenu('work-mode-panel')
    }
  }, [])

  useEffect(() => {
    if (settingsOpened) {
      handleClose()
    }
  }, [settingsOpened, handleClose])

  useEffect(() => {
    if (!opened || !isTouchLayout || platform.type !== 'mobile') return
    let cancelled = false
    let remove: (() => void) | undefined
    void import('@capacitor/app')
      .then(({ App }) => {
        if (cancelled) return
        return App.addListener('backButton', () => {
          if (panelRef.current?.goBack()) return
          handleClose()
        })
      })
      .then((handle) => {
        if (cancelled) {
          void handle?.remove()
          return
        }
        remove = () => {
          void handle?.remove()
        }
      })
    return () => {
      cancelled = true
      remove?.()
    }
  }, [handleClose, isTouchLayout, opened])

  const handleWebBrowsingChange = useCallback(
    (enabled: boolean) => {
      onWebBrowsingChange(enabled)
      if (isTouchLayout) {
        blurMessageInput()
      }
    },
    [isTouchLayout, onWebBrowsingChange]
  )

  const panel = opened ? (
    <AgentModePanel
      ref={panelRef}
      sessionId={sessionId}
      providerId={providerId}
      modelId={modelId}
      modelSupportsAgentMode={modelSupportsAgentMode}
      webBrowsingMode={webBrowsingMode}
      onWebBrowsingChange={handleWebBrowsingChange}
      currentKnowledgeBaseId={currentKnowledgeBaseId}
      onKnowledgeBaseSelect={onKnowledgeBaseSelect}
      onSkillSelect={onSkillSelect}
      onClose={handleClose}
      draftCopilotId={draftCopilotId}
      draftCopilotName={draftCopilotName}
      layout={resolvedLayout}
    />
  ) : null

  const triggerButton = (
    <UnstyledButton
      data-testid={TestId.agent.modeTrigger}
      aria-label={modeLabel}
      onMouseEnter={showWebSearchMovedTip || isTouchLayout ? undefined : handleMouseEnter}
      onMouseLeave={showWebSearchMovedTip || isTouchLayout ? undefined : handleMouseLeave}
      onClick={() => {
        clearTimeout(openTimerRef.current)
        clearTimeout(closeTimerRef.current)
        if (showWebSearchMovedTip) {
          handleDismissWebSearchMovedTip()
          return
        }
        setPanelOpened(isTouchLayout ? !opened : true)
      }}
      className="relative flex items-center gap-1 px-2 py-1 rounded-lg transition-colors hover:bg-[var(--chatbox-background-tertiary)]"
      style={{ color }}
    >
      {compact ? (
        <CompactAgentModeIcon mode={agentModeUIState.displayValue} size={iconSize} />
      ) : (
        <>
          <IconRobot size={iconSize} strokeWidth={1.8} />
          <span className="text-xs font-medium whitespace-nowrap">{modeLabel}</span>
        </>
      )}
      {hasWebSearchWarning && (
        <span
          data-web-search-warning
          aria-hidden="true"
          className="absolute right-1 top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--chatbox-tint-error)]"
        />
      )}
    </UnstyledButton>
  )

  if (isTouchLayout && !showWebSearchMovedTip) {
    return (
      <>
        {triggerButton}
        <Drawer.Root
          open={opened && !settingsOpened && !suppressedByChipMenu}
          onOpenChange={(open) => {
            if (open) setPanelOpened(true)
            else handleClose()
          }}
          noBodyStyles
          repositionInputs={false}
        >
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
            <Drawer.Content className="flex flex-col h-fit max-h-[min(85dvh,720px)] fixed bottom-0 left-0 right-0 outline-none bg-[var(--chatbox-background-primary)] rounded-t-lg">
              <Drawer.Handle />
              <Drawer.Title className="sr-only">{modeLabel}</Drawer.Title>
              <div className="min-h-0 overflow-y-auto overscroll-contain">{panel}</div>
              <div className="h-[var(--mobile-safe-area-inset-bottom,env(safe-area-inset-bottom,0px))] min-h-3 shrink-0" />
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      </>
    )
  }

  return (
    <Popover
      position="top-start"
      shadow="md"
      opened={(showWebSearchMovedTip || opened) && !settingsOpened && !suppressedByChipMenu}
      onChange={setPanelOpened}
      keepMounted
      transitionProps={{ transition: 'pop', duration: 200 }}
    >
      <Popover.Target>
        <span className="inline-flex">{triggerButton}</span>
      </Popover.Target>
      <Popover.Dropdown
        p={showWebSearchMovedTip ? 'sm' : 0}
        w={showWebSearchMovedTip ? 280 : undefined}
        style={{ overflow: 'visible' }}
        onMouseEnter={showWebSearchMovedTip ? undefined : handleMouseEnter}
        onMouseLeave={showWebSearchMovedTip ? undefined : handleMouseLeave}
      >
        {showWebSearchMovedTip ? (
          <div className="flex items-start gap-2" role="status">
            <div className="min-w-0 flex-1">
              <Text size="sm" fw={600}>
                {t('Web Search has moved')}
              </Text>
              <Text size="xs" c="dimmed" mt={2}>
                {t('Web Search is now available in the mode menu.')}
              </Text>
            </div>
            <ActionIcon variant="subtle" size="sm" aria-label={t('Close')} onClick={handleDismissWebSearchMovedTip}>
              <IconX size={14} />
            </ActionIcon>
          </div>
        ) : (
          panel
        )}
      </Popover.Dropdown>
    </Popover>
  )
}

function CompactAgentModeIcon({ mode, size }: { mode: AgentModeValue; size: number }) {
  // Slightly larger than the reasoning badge (0.5x): the briefcase outline needs the extra pixel to stay readable.
  const statusSize = Math.max(10, Math.round(size * 0.55))

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} data-agent-mode={mode}>
      <IconRobot size={size} strokeWidth={1.8} />
      <AgentModeStatusIcon
        mode={mode}
        size={statusSize}
        className="absolute -bottom-0.5 -right-0.5 bg-[var(--chatbox-background-secondary)]"
      />
    </span>
  )
}

export default AgentModeButton
