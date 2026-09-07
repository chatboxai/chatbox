import { hasConversationStarted, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import NiceModal from '@ebay/nice-modal-react'
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Flex,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { AgentModeValue, KnowledgeBase } from '@shared/types'
import {
  IconAlertCircle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconFile,
  IconFolderCog,
  IconHammer,
  IconNotes,
  IconSettings2,
  IconVocabulary,
  IconWand,
  IconWorldWww,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import {
  type FC,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  trackAgentModeSelect,
  trackMemoryClick,
  trackSmartSwitchingClick,
  trackWebSearchClick,
} from '@/analytics/agent-mode'
import { rendererApplication } from '@/app/renderer-application'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useKnowledgeBases } from '@/hooks/knowledge-base'
import { useMCPServerStatus, useToggleMCPServer } from '@/hooks/mcp'
import { useCopilotMemory, useMyCopilots } from '@/hooks/useCopilots'
import { navigateToSettings } from '@/modals/settings-navigation'
import { BUILTIN_MCP_SERVERS } from '@/packages/mcp/builtin'
import { skillsController, subscribeSkillsChanged } from '@/packages/skills/controller'
import { getWebSearchConfigurationIssue } from '@/packages/web-search/configuration-issue'
import { WEB_SEARCH_PROVIDERS, type WebSearchProviderValue } from '@/packages/web-search/constants'
import platform from '@/platform'
import { listCopilotMemories, listMemories } from '@/stores/agentPersonaStore'
import { useAutoValidate } from '@/stores/premiumActions'
import { setSessionAgentMode, useSessionAgentMode } from '@/stores/session/agent-mode'
import { useMcpSettings, useSettingsStore } from '@/stores/settingsStore'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import { featureFlags } from '@/utils/feature-flags'
import { ScalableIcon } from '../common/ScalableIcon'
import MCPStatus from '../mcp/MCPStatus'
import { CommandApprovalOptions, WorkingDirectoryContent } from './AgentModeSettingsContent'
import AgentModeStatusIcon from './AgentModeStatusIcon'
import { getAgentModeUIState } from './agentModeState'
import type { ComposerMenuLayout } from './composerTouchLayout'
import {
  supportsWorkingDirectories,
  useCommandApprovalModeState,
  useWorkingDirectoriesState,
} from './useAgentModeSettingsState'

const useSession = (sessionId: string | null) => rendererApplication.sessionHooks.useSession(sessionId)

function isNestedRowControlEvent(event: { target: EventTarget | null }) {
  return event.target instanceof Element && Boolean(event.target.closest('[data-row-control]'))
}

type PanelPage =
  | 'main'
  | 'web-search'
  | 'memory'
  | 'code-execution'
  | 'skills'
  | 'mcp'
  | 'knowledge-base'
  | 'working-directory'

// Sub-panel geometry. The panel lives in a portal with `overflow: visible`, so an
// unconstrained sub-panel would spill past the window and add document scrollbars.
const SUB_PANEL_WIDTH = 240
// Below this the options stop being readable, so a narrow window covers the main
// panel with the sub-panel instead of squeezing it into the leftover strip.
const SUB_PANEL_MIN_WIDTH = 200
const SUB_PANEL_MAX_HEIGHT = 360
const VIEWPORT_MARGIN = 8

type SubPanelPosition = {
  page: PanelPage
  placement: 'left' | 'right' | 'overlay'
  top: number
  /** Offset from the main panel's left edge; overlay placement only. */
  left: number
  width: number
  maxHeight: number
}

export interface AgentModePanelHandle {
  goBack: () => boolean
}

export interface AgentModePanelProps {
  sessionId: string
  providerId?: string
  modelId?: string
  modelSupportsAgentMode?: boolean
  webBrowsingMode: boolean
  onWebBrowsingChange: (enabled: boolean) => void
  currentKnowledgeBaseId?: number
  onKnowledgeBaseSelect: (kb: KnowledgeBase | null) => void
  onSkillSelect: (skillName: string) => void
  onClose: () => void
  /** Copilot picked on the new-chat page, where the draft session is not persisted yet. */
  draftCopilotId?: string
  draftCopilotName?: string
  /** Defaults to the desktop flyout. The composer button passes `touch` on phones, tablets, and mobile web. */
  layout?: ComposerMenuLayout
}

// --- Sub-components ---

const MCPServerItem: FC<{
  id: string
  name: string
  enabled: boolean
  disabled?: boolean
  onEnabledChange: (id: string, enabled: boolean) => void
}> = ({ id, name, enabled, disabled = false, onEnabledChange }) => {
  const status = useMCPServerStatus(id)
  return (
    <Flex
      justify="space-between"
      align="center"
      px="sm"
      py={6}
      className={`rounded ${
        disabled ? 'opacity-50' : 'hover:bg-[var(--mantine-color-gray-0)] dark:hover:bg-[var(--mantine-color-dark-5)]'
      }`}
    >
      <Flex gap="xs" align="center">
        <MCPStatus status={status} />
        <Text size="sm">{name}</Text>
      </Flex>
      <Switch
        checked={enabled}
        size="xs"
        disabled={disabled || status?.state === 'starting' || status?.state === 'stopping'}
        onChange={(e) => onEnabledChange(id, e.currentTarget.checked)}
      />
    </Flex>
  )
}

const MemorySettingRow: FC<{
  label: string
  description: string
  checked: boolean
  onChange: (enabled: boolean) => void
}> = ({ label, description, checked, onChange }) => (
  <Flex justify="space-between" align="center" gap="sm" px="sm" py="xs">
    <Stack gap={2} className="min-w-0">
      <Text size="sm" fw={500}>
        {label}
      </Text>
      <Text size="xs" c="dimmed" className="leading-snug">
        {description}
      </Text>
    </Stack>
    <Switch
      aria-label={label}
      checked={checked}
      size="xs"
      className="shrink-0"
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  </Flex>
)

// --- Main component ---

const AgentModePanel = forwardRef<AgentModePanelHandle, AgentModePanelProps>(function AgentModePanel(
  {
    sessionId,
    providerId,
    modelId,
    modelSupportsAgentMode = true,
    webBrowsingMode,
    onWebBrowsingChange,
    currentKnowledgeBaseId,
    onKnowledgeBaseSelect,
    onSkillSelect,
    onClose,
    draftCopilotId,
    draftCopilotName,
    layout = 'desktop',
  },
  ref
) {
  const isTouchLayout = layout === 'touch'
  const showModeSwitcher = platform.isDesktopLike
  const showDesktopCapabilityHint = !platform.isDesktopLike
  const showCodeExecution = featureFlags.agentMode
  const showSkills = featureFlags.skills
  const showMcp = featureFlags.mcp
  const showKnowledgeBase = featureFlags.knowledgeBase
  const showWorkingDirectory = supportsWorkingDirectories()
  const showExtensions = showSkills || showMcp || showKnowledgeBase || showWorkingDirectory
  const { t } = useTranslation()
  const [page, setPage] = useState<PanelPage>('main')
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const openTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const panelRef = useRef<HTMLDivElement>(null)
  const subPanelRef = useRef<HTMLDivElement>(null)
  const [subPanelAlign, setSubPanelAlign] = useState<'top' | 'bottom'>('bottom')
  const [subPanelTop, setSubPanelTop] = useState<number>(0)
  const [subPanelPosition, setSubPanelPosition] = useState<SubPanelPosition | null>(null)
  const settleFrameRef = useRef<number>()
  const isNewSession = sessionId === 'new'
  const { session: currentSession } = useSession(isNewSession ? null : sessionId)

  // Agent mode state
  const setAgentModeSmartSwitchingDefault = useUIStore((s) => s.setAgentModeSmartSwitchingDefault)
  const setAgentModeLastSelected = useUIStore((s) => s.setAgentModeLastSelected)
  const entry = useSessionAgentMode(sessionId)
  const agentModeUIState = useMemo(
    () => getAgentModeUIState(entry, modelSupportsAgentMode),
    [entry, modelSupportsAgentMode]
  )
  const workModeCapabilitiesDisabled = agentModeUIState.capabilitiesDisabled

  // Web Search state
  const webSearchProvider = useSettingsStore((s) => s.extension.webSearch.provider)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const licenseKey = useSettingsStore((s) => s.licenseKey)
  const tavilyApiKey = useSettingsStore((s) => s.extension.webSearch.tavilyApiKey)
  const bochaApiKey = useSettingsStore((s) => s.extension.webSearch.bochaApiKey)
  const queritApiKey = useSettingsStore((s) => s.extension.webSearch.queritApiKey)
  const searxngBaseUrl = useSettingsStore((s) => s.extension.webSearch.searxngBaseUrl)
  const webSearchProviderLabel =
    WEB_SEARCH_PROVIDERS.find((p) => p.value === webSearchProvider)?.label ?? webSearchProvider
  const webSearchConfigurationIssue = webBrowsingMode
    ? getWebSearchConfigurationIssue(
        {
          provider: webSearchProvider,
          tavilyApiKey,
          bochaApiKey,
          queritApiKey,
          searxngBaseUrl,
        },
        licenseKey
      )
    : null

  // Memory is a global preference (all chats) unless the chat comes from a copilot:
  // then the switch here is that copilot's own — shared by every chat with it — and
  // turning it on replaces global memory for those chats. Ownership is tracked by
  // copilot id, so a copilot used straight from the store qualifies too.
  const globalMemoryEnabled = useSettingsStore((s) => s.memoryEnabled !== false)
  const { copilots: myCopilots, addOrUpdate: updateCopilot } = useMyCopilots()
  const {
    owners: copilotMemoryOwners,
    isEnabled: isCopilotMemoryEnabled,
    setEnabled: setCopilotMemory,
  } = useCopilotMemory()
  const sessionCopilotId = isNewSession ? draftCopilotId : currentSession?.copilotId
  const savedCopilot = useMemo(
    () => (sessionCopilotId ? myCopilots.find((copilot) => copilot.id === sessionCopilotId) : undefined),
    [myCopilots, sessionCopilotId]
  )
  /** Label for the copilot behind this chat, whether or not it was ever saved. */
  const sessionCopilotName = useMemo(() => {
    if (!sessionCopilotId) return undefined
    const owned = copilotMemoryOwners.find((owner) => owner.id === sessionCopilotId)
    return savedCopilot?.name ?? owned?.name ?? currentSession?.name ?? draftCopilotName
  }, [copilotMemoryOwners, currentSession?.name, draftCopilotName, savedCopilot, sessionCopilotId])
  const copilotMemoryEnabled = Boolean(sessionCopilotId && isCopilotMemoryEnabled(sessionCopilotId))
  const effectiveMemorySource = copilotMemoryEnabled ? 'copilot' : globalMemoryEnabled ? 'global' : 'none'
  // Keep retained memories manageable while their switch is off. The main row
  // only shows the count for the effective source, so a disabled store never
  // looks active.
  const managedMemoryCopilotId = effectiveMemorySource === 'copilot' ? sessionCopilotId : undefined
  const [memoryCount, setMemoryCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setMemoryCount(null)
    const load = managedMemoryCopilotId ? listCopilotMemories(managedMemoryCopilotId) : listMemories()
    void load
      .then((entries) => {
        if (!cancelled) setMemoryCount(entries.length)
      })
      .catch(() => {
        if (!cancelled) setMemoryCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [managedMemoryCopilotId])

  const isProviderAvailable = useCallback(
    (provider: WebSearchProviderValue) => {
      return (
        getWebSearchConfigurationIssue(
          { provider, tavilyApiKey, bochaApiKey, queritApiKey, searxngBaseUrl },
          licenseKey
        ) === null
      )
    },
    [bochaApiKey, licenseKey, queritApiKey, searxngBaseUrl, tavilyApiKey]
  )

  // MCP state
  const mcp = useMcpSettings()
  const isPremium = useAutoValidate()
  const onMCPEnabledChange = useToggleMCPServer()
  const enabledMCPCount = mcp.servers.filter((s) => s.enabled).length + mcp.enabledBuiltinServers.length

  // Knowledge Base state
  const { data: knowledgeBases } = useKnowledgeBases(featureFlags.knowledgeBase)

  // Skills state
  const [skills, setSkills] = useState<Array<{ name: string; description: string }>>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsVersion, setSkillsVersion] = useState(0)
  const enabledSkillNames = useSettingsStore((s) => s.skills.enabledSkillNames)

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true)
    try {
      const allSkills = await skillsController.discoverSkills()
      setSkills(allSkills.map((s) => ({ name: s.name, description: s.description })))
    } catch {
      setSkills([])
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (page === 'skills') {
      void loadSkills()
    }
  }, [page, loadSkills, skillsVersion])

  useEffect(() => {
    return subscribeSkillsChanged(() => {
      setSkillsVersion((version) => version + 1)
    })
  }, [])

  const enabledSkills = useMemo(
    () => skills.filter((s) => enabledSkillNames.includes(s.name)),
    [skills, enabledSkillNames]
  )

  const handleModeChange = useCallback(
    (value: AgentModeValue) => {
      if (value === 'on' && !platform.isDesktopLike) {
        toastActions.add(t('Work Mode is currently only available on the desktop app.'))
        return
      }
      if (entry.value === value) return
      trackAgentModeSelect({
        sessionId,
        mode: value === 'on' ? 'work_mode' : 'chat_mode',
        provider: providerId,
        model: modelId,
      })
      // Remember the explicit choice so new chats start in the same mode.
      if (value !== 'auto') {
        setAgentModeLastSelected(value)
      }
      void setSessionAgentMode(sessionId, value)
    },
    [entry.value, modelId, providerId, sessionId, setAgentModeLastSelected, t]
  )
  const handleSmartSwitchingChange = useCallback(
    (enabled: boolean) => {
      trackSmartSwitchingClick(
        {
          sessionId,
          mode: 'chat_mode',
          provider: providerId,
          model: modelId,
        },
        enabled
      )
      setAgentModeSmartSwitchingDefault(enabled)
      void setSessionAgentMode(sessionId, enabled ? 'auto' : 'off')
    },
    [modelId, providerId, sessionId, setAgentModeSmartSwitchingDefault]
  )

  // Command approval + working directories are shared with the composer status row
  // (WorkModeStatusRow): one store, two entry points, so both stay in sync.
  const { commandApprovalMode, updateCommandApprovalMode } = useCommandApprovalModeState(sessionId, {
    providerId,
    modelId,
  })
  const {
    workingDirectories,
    availableRecentDirectories,
    addWorkingDirectory: handleAddWorkingDirectory,
    selectRecentDirectory: handleSelectRecentDirectory,
    removeWorkingDirectory: handleRemoveWorkingDirectory,
  } = useWorkingDirectoriesState(sessionId)

  const selectedKB = useMemo(
    () => knowledgeBases?.find((kb) => kb.id === currentKnowledgeBaseId),
    [knowledgeBases, currentKnowledgeBaseId]
  )

  // Hover handlers for sub-panel with delay to prevent flicker
  const clearSubPanelCloseTimer = useCallback(() => {
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = undefined
  }, [])

  const clearSubPanelOpenTimer = useCallback(() => {
    clearTimeout(openTimerRef.current)
    openTimerRef.current = undefined
  }, [])

  const scheduleSubPanelClose = useCallback(
    (delay: number) => {
      clearSubPanelCloseTimer()
      clearSubPanelOpenTimer()
      closeTimerRef.current = setTimeout(() => {
        setPage('main')
        closeTimerRef.current = undefined
      }, delay)
    },
    [clearSubPanelCloseTimer, clearSubPanelOpenTimer]
  )

  const handleExtensionHover = useCallback(
    (target: PanelPage, e?: React.MouseEvent, align: 'top' | 'bottom' = 'bottom') => {
      clearSubPanelCloseTimer()
      clearSubPanelOpenTimer()

      if (isTouchLayout) {
        setPage(target)
        return
      }

      let nextSubPanelTop = 0
      if (align === 'top' && e && panelRef.current) {
        const row = e.currentTarget as HTMLElement
        // Offsets, not rects: the panel is the row's offset parent, so this stays in
        // the panel's own pixels even while the popover plays its open transition.
        nextSubPanelTop = row.offsetTop
      }

      const openTarget = () => {
        setPage(target)
        setSubPanelAlign(align)
        if (align === 'top') {
          setSubPanelTop(nextSubPanelTop)
        }
      }

      if (page === 'main' || page === target) {
        openTarget()
        return
      }

      openTimerRef.current = setTimeout(openTarget, 180)
    },
    [clearSubPanelCloseTimer, clearSubPanelOpenTimer, isTouchLayout, page]
  )

  const handleSubPanelEnter = useCallback(() => {
    clearSubPanelCloseTimer()
    clearSubPanelOpenTimer()
  }, [clearSubPanelCloseTimer, clearSubPanelOpenTimer])

  const handleSubPanelLeave = useCallback(() => {
    scheduleSubPanelClose(300)
  }, [scheduleSubPanelClose])

  const handleNonExtensionHover = useCallback(() => {
    scheduleSubPanelClose(200)
  }, [scheduleSubPanelClose])

  const resetSubPanel = useCallback(() => {
    clearSubPanelCloseTimer()
    clearSubPanelOpenTimer()
    setPage('main')
  }, [clearSubPanelCloseTimer, clearSubPanelOpenTimer])

  useImperativeHandle(
    ref,
    () => ({
      goBack: () => {
        if (page === 'main') return false
        resetSubPanel()
        return true
      },
    }),
    [page, resetSubPanel]
  )

  useEffect(() => {
    return () => {
      clearTimeout(closeTimerRef.current)
      clearTimeout(openTimerRef.current)
    }
  }, [])

  useEffect(() => {
    subPanelRef.current?.scrollTo({ top: 0 })
  }, [page])

  // Keep the sub-panel inside the window: flip it to whichever side has room and
  // clamp its vertical span, so it never pushes the document past the viewport.
  const updateSubPanelPosition = useCallback(() => {
    const panel = panelRef.current
    const subPanel = subPanelRef.current
    if (!panel || !subPanel) return

    const panelRect = panel.getBoundingClientRect()
    // The popover scales up while it opens, so its rect can be smaller than its layout
    // box. Offsets and the values we write are in the panel's own pixels, so convert
    // every viewport measurement into that space, and re-run once the scale settles.
    const scale = panel.offsetWidth > 0 ? panelRect.width / panel.offsetWidth : 1
    const toPanelPx = (viewportPx: number) => viewportPx / scale
    if (Math.abs(scale - 1) > 0.01) {
      cancelAnimationFrame(settleFrameRef.current ?? 0)
      settleFrameRef.current = requestAnimationFrame(() => {
        settleFrameRef.current = undefined
        updateSubPanelPosition()
      })
    }

    const spaceRight = toPanelPx(window.innerWidth - panelRect.right - VIEWPORT_MARGIN)
    const spaceLeft = toPanelPx(panelRect.left - VIEWPORT_MARGIN)
    const preferredSide = spaceRight >= SUB_PANEL_WIDTH || spaceRight >= spaceLeft ? 'right' : 'left'
    const sideSpace = preferredSide === 'right' ? spaceRight : spaceLeft
    const fitsBeside = sideSpace >= SUB_PANEL_MIN_WIDTH

    const placement = fitsBeside ? preferredSide : 'overlay'
    const width = fitsBeside
      ? Math.min(SUB_PANEL_WIDTH, sideSpace)
      : Math.min(SUB_PANEL_WIDTH, toPanelPx(window.innerWidth - VIEWPORT_MARGIN * 2))
    const left = fitsBeside
      ? 0
      : toPanelPx(
          Math.min(Math.max(panelRect.left, VIEWPORT_MARGIN), window.innerWidth - VIEWPORT_MARGIN - width * scale) -
            panelRect.left
        )
    const maxHeight = Math.min(SUB_PANEL_MAX_HEIGHT, toPanelPx(window.innerHeight - VIEWPORT_MARGIN * 2))

    // Apply the final box before measuring so wrapping at the clamped width is
    // reflected in the height we position against.
    subPanel.style.width = `${width}px`
    subPanel.style.maxHeight = `${maxHeight}px`
    const height = subPanel.offsetHeight
    const desiredTop = subPanelAlign === 'top' ? subPanelTop : panel.offsetHeight - height
    const top = Math.min(
      Math.max(desiredTop, toPanelPx(VIEWPORT_MARGIN - panelRect.top)),
      toPanelPx(window.innerHeight - VIEWPORT_MARGIN - panelRect.top) - height
    )

    setSubPanelPosition((current) =>
      current &&
      current.page === page &&
      current.placement === placement &&
      current.top === top &&
      current.left === left &&
      current.width === width &&
      current.maxHeight === maxHeight
        ? current
        : { page, placement, top, left, width, maxHeight }
    )
  }, [page, subPanelAlign, subPanelTop])

  useLayoutEffect(() => {
    if (page === 'main' || isTouchLayout) {
      setSubPanelPosition(null)
      return
    }
    updateSubPanelPosition()

    // Either box can settle after mount — the sub-panel with async skills or memory
    // counts, the `w-max` main panel with a knowledge-base subtitle — and the window
    // can be resized while the menu is open. Re-place it in all of those cases.
    const panel = panelRef.current
    const subPanel = subPanelRef.current
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateSubPanelPosition())
      if (panel) observer.observe(panel)
      if (subPanel) observer.observe(subPanel)
    }
    window.addEventListener('resize', updateSubPanelPosition)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateSubPanelPosition)
      cancelAnimationFrame(settleFrameRef.current ?? 0)
      settleFrameRef.current = undefined
    }
  }, [isTouchLayout, page, updateSubPanelPosition])

  // Measurements are only valid for the page they were taken on; until the effect
  // runs for a newly opened page we fall back to the anchor-based placement.
  const resolvedSubPanelPosition = subPanelPosition?.page === page ? subPanelPosition : null

  // Manual cross-mode switching (chat ↔ work) is only offered before the
  // conversation starts — mirroring the work-side `entry.locked` in the other
  // direction. Same-mode toggles are unaffected; the store enforces the same
  // rule in setSessionAgentMode.
  const conversationStarted = useMemo(
    () => (currentSession ? hasConversationStarted(currentSession) : false),
    [currentSession]
  )

  // --- Mode button ---
  const ModeButton: FC<{ value: Extract<AgentModeValue, 'on' | 'off'>; label: string }> = ({ value, label }) => {
    const isActive = agentModeUIState.displayValue === value
    const isLockedDisabled = entry.locked && value !== 'on'
    const isSwitchFrozen = conversationStarted && resolveSessionMode(value) !== resolveSessionMode(entry.value)
    const isPlatformUnsupported = !platform.isDesktopLike && value === 'on'
    const isModelDisabled = !isPlatformUnsupported && !modelSupportsAgentMode && value !== 'off'
    const isDisabled = !isPlatformUnsupported && (isLockedDisabled || isSwitchFrozen || isModelDisabled)
    const tooltipLabel = isPlatformUnsupported
      ? t('Work Mode is currently only available on the desktop app.')
      : isModelDisabled
        ? t('This model does not support Agent Mode')
        : t('Locked after the chat starts to keep tools and context consistent — start a new chat to change')
    return (
      <Tooltip label={tooltipLabel} disabled={!isDisabled && !isPlatformUnsupported} withArrow zIndex={3000}>
        <span className="flex min-w-0 flex-1">
          <Button
            data-testid={value === 'off' ? TestId.agent.modeChat : TestId.agent.modeWork}
            size="xs"
            variant={isActive ? 'filled' : 'default'}
            color={isActive ? 'chatbox-brand' : undefined}
            fullWidth
            disabled={isDisabled}
            leftSection={<AgentModeStatusIcon mode={value} size={14} />}
            // Long locales (fr/pt/ru) wrap onto a second line instead of being clipped mid-word
            styles={{ root: { height: 'auto', minHeight: 26 }, label: { whiteSpace: 'normal', paddingBlock: 4 } }}
            onClick={() => handleModeChange(value)}
          >
            {label}
          </Button>
        </span>
      </Tooltip>
    )
  }

  const isChatModeSelected = agentModeUIState.displayValue === 'off'
  const smartSwitchingEnabled = entry.value === 'auto' && isChatModeSelected
  const smartSwitchingExpired =
    !isNewSession && Boolean(currentSession?.messages.some((message) => message.role === 'user'))
  const isSmartSwitchingDisabled = entry.locked || !modelSupportsAgentMode || smartSwitchingExpired
  const modeDescription = agentModeUIState.isActive
    ? t('Best for multi-step tasks with files, code execution, tools, MCP, skills, or knowledge bases.')
    : t('Best for quick Q&A, writing, translation, explanations, and web search.')
  const smartSwitchingDescription = smartSwitchingExpired
    ? t('Only available before the first message.')
    : t('Suggest Work Mode on the first message.')

  // --- Extension row ---
  const ExtensionRow: FC<{
    icon: React.ReactNode
    label: string
    badge?: string | number
    subtitle?: string
    active?: boolean
    page: PanelPage
    rightContent?: React.ReactNode
    subPanelAlign?: 'top' | 'bottom'
    disabled?: boolean
    danger?: boolean
  }> = ({
    icon,
    label,
    badge,
    subtitle,
    active,
    page: targetPage,
    rightContent,
    subPanelAlign = 'bottom',
    disabled = false,
    danger = false,
  }) => (
    <Flex
      justify="space-between"
      align="center"
      px="sm"
      py={6}
      tabIndex={0}
      role="button"
      aria-expanded={active}
      aria-disabled={disabled}
      className={`rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--chatbox-tint-brand)] ${
        active
          ? 'bg-[var(--mantine-color-gray-1)] dark:bg-[var(--mantine-color-dark-5)]'
          : disabled
            ? ''
            : 'hover:bg-[var(--mantine-color-gray-0)] dark:hover:bg-[var(--mantine-color-dark-5)]'
      } ${disabled ? 'cursor-default opacity-50' : 'cursor-pointer'} ${isTouchLayout ? 'min-h-11' : ''}`}
      onMouseEnter={isTouchLayout ? undefined : (e) => handleExtensionHover(targetPage, e, subPanelAlign)}
      onMouseLeave={isTouchLayout ? undefined : clearSubPanelOpenTimer}
      onFocus={
        isTouchLayout
          ? undefined
          : (e) => handleExtensionHover(targetPage, e as unknown as React.MouseEvent, subPanelAlign)
      }
      onBlur={isTouchLayout ? undefined : handleSubPanelLeave}
      onClick={(e) => {
        if (disabled || isNestedRowControlEvent(e)) return
        handleExtensionHover(targetPage, e as unknown as React.MouseEvent, subPanelAlign)
      }}
      onKeyDown={(e) => {
        if (isNestedRowControlEvent(e)) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleExtensionHover(targetPage, e as unknown as React.MouseEvent, subPanelAlign)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          resetSubPanel()
        }
      }}
    >
      <Flex gap="xs" align="center" className="min-w-0">
        {icon}
        <Text size="sm" c={danger ? 'chatbox-error' : undefined}>
          {label}
        </Text>
        {badge !== undefined && (
          <Badge size="xs" variant="light">
            {badge}
          </Badge>
        )}
        {subtitle && (
          <Text size="xs" c={danger ? 'chatbox-error' : 'dimmed'} truncate className="max-w-[100px]">
            {subtitle}
          </Text>
        )}
      </Flex>
      {rightContent ?? <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)] shrink-0" />}
    </Flex>
  )

  // --- Sub-panel header ---
  const SubPanelHeader: FC<{ title: string; settingsPath?: string; disabled?: boolean }> = ({
    title,
    settingsPath,
    disabled = false,
  }) => (
    <Flex justify="space-between" align="center" px="sm" py="xs" gap="xs">
      <Flex align="center" gap="xs" className="min-w-0">
        {isTouchLayout && (
          <ActionIcon
            data-testid={TestId.agent.modePanelBack}
            variant="subtle"
            size={28}
            aria-label={t('Back')}
            onClick={resetSubPanel}
          >
            <IconChevronLeft size={18} />
          </ActionIcon>
        )}
        <Text fw={600} size="sm">
          {title}
        </Text>
      </Flex>
      {settingsPath && (
        <ActionIcon
          variant="subtle"
          size={20}
          disabled={disabled}
          onClick={() => {
            if (disabled) return
            onClose()
            navigateToSettings(settingsPath)
          }}
        >
          <ScalableIcon icon={IconSettings2} size={16} color="var(--chatbox-tint-tertiary)" />
        </ActionIcon>
      )}
    </Flex>
  )

  const handleWebSearchProviderChange = useCallback(
    (provider: WebSearchProviderValue) => {
      setSettings((draft) => {
        draft.extension.webSearch.provider = provider
      })
    },
    [setSettings]
  )

  const trackMemoryEnabledChange = useCallback(
    (enabled: boolean) => {
      trackMemoryClick(
        {
          sessionId,
          mode: agentModeUIState.isActive ? 'work_mode' : 'chat_mode',
          provider: providerId,
          model: modelId,
        },
        enabled
      )
    },
    [agentModeUIState.isActive, modelId, providerId, sessionId]
  )

  const handleCopilotMemoryEnabledChange = useCallback(
    (enabled: boolean) => {
      if (!sessionCopilotId) return
      trackMemoryEnabledChange(enabled)
      setCopilotMemory({ id: sessionCopilotId, name: sessionCopilotName ?? sessionCopilotId }, enabled)
    },
    [sessionCopilotId, sessionCopilotName, setCopilotMemory, trackMemoryEnabledChange]
  )

  const handleGlobalMemoryEnabledChange = useCallback(
    (enabled: boolean) => {
      trackMemoryEnabledChange(enabled)
      setSettings({ memoryEnabled: enabled })
    },
    [setSettings, trackMemoryEnabledChange]
  )

  const openCopilotSettings = useCallback(() => {
    if (!savedCopilot) return
    onClose()
    void NiceModal.show('copilot-settings', {
      copilot: savedCopilot,
      mode: 'edit',
      onSave: updateCopilot,
    })
  }, [onClose, savedCopilot, updateCopilot])

  // --- Sub-panel content ---
  const renderSubPanel = () => {
    if (page === 'web-search') {
      return (
        <>
          <SubPanelHeader title={t('Web Search')} settingsPath="/web-search" />
          <Divider my={4} />
          {WEB_SEARCH_PROVIDERS.map((provider) => {
            const available = isProviderAvailable(provider.value)
            const isSelected = webSearchProvider === provider.value
            return (
              <Tooltip
                key={provider.value}
                label={t('Configure in Settings')}
                disabled={available}
                withArrow
                position="right"
              >
                <Flex
                  justify="space-between"
                  align="center"
                  px="sm"
                  py={6}
                  className={`rounded ${
                    available
                      ? 'cursor-pointer hover:bg-[var(--mantine-color-gray-0)] dark:hover:bg-[var(--mantine-color-dark-5)]'
                      : 'cursor-default opacity-50'
                  }`}
                  onClick={() => {
                    if (available) {
                      handleWebSearchProviderChange(provider.value)
                    } else {
                      onClose()
                      navigateToSettings('/web-search')
                    }
                  }}
                >
                  <Text size="sm" c={isSelected ? 'chatbox-brand' : available ? '' : 'dimmed'}>
                    {provider.label}
                  </Text>
                  {isSelected && <IconCheck size={14} color="var(--chatbox-tint-brand)" />}
                </Flex>
              </Tooltip>
            )
          })}
        </>
      )
    }

    if (page === 'memory') {
      return (
        <>
          <SubPanelHeader
            title={t('Memory')}
            settingsPath={savedCopilot && effectiveMemorySource === 'copilot' ? undefined : '/agent'}
          />
          <Divider my={4} />
          {sessionCopilotName && (
            <Text size="xs" fw={500} c="chatbox-primary" px="sm" pt={6} className="leading-snug">
              {sessionCopilotName}
            </Text>
          )}
          {sessionCopilotId && (
            <MemorySettingRow
              label={t('Copilot Memory')}
              description={t(
                'All chats with this Copilot use its shared memory when on, or follow Global Memory when off.'
              )}
              checked={copilotMemoryEnabled}
              onChange={handleCopilotMemoryEnabledChange}
            />
          )}
          {!copilotMemoryEnabled && (
            <MemorySettingRow
              label={t('Global Memory')}
              description={t("Shared by chats that don't use Copilot Memory.")}
              checked={globalMemoryEnabled}
              onChange={handleGlobalMemoryEnabledChange}
            />
          )}
          <Divider my={4} />
          {memoryCount === null ? (
            <Flex justify="center" py="md">
              <Loader size="sm" />
            </Flex>
          ) : (
            <Group justify="space-between" align="center" px="sm" py="xs">
              <Text size="xs" c="dimmed">
                {memoryCount === 0 ? t('No memories saved yet.') : t('{{count}} saved', { count: memoryCount })}
              </Text>
              <Button
                size="xs"
                variant="light"
                onClick={() => {
                  if (savedCopilot && effectiveMemorySource === 'copilot') {
                    openCopilotSettings()
                    return
                  }
                  onClose()
                  navigateToSettings('/agent')
                }}
              >
                {t('Manage memories')}
              </Button>
            </Group>
          )}
        </>
      )
    }

    if (page === 'code-execution') {
      return (
        <>
          <SubPanelHeader title={t('Code Execution')} disabled={workModeCapabilitiesDisabled} />
          <Divider my={4} />
          <CommandApprovalOptions
            mode={commandApprovalMode}
            disabled={workModeCapabilitiesDisabled}
            onSelect={(mode) => void updateCommandApprovalMode(mode)}
          />
        </>
      )
    }

    if (page === 'skills') {
      return (
        <>
          <SubPanelHeader title="Skills" settingsPath="/skills" disabled={workModeCapabilitiesDisabled} />
          <Divider my={4} />
          {skillsLoading ? (
            <Flex justify="center" py="md">
              <Loader size="sm" />
            </Flex>
          ) : enabledSkills.length > 0 ? (
            enabledSkills.map((skill) => (
              <Flex
                key={skill.name}
                px="sm"
                py={6}
                className={`rounded ${
                  workModeCapabilitiesDisabled
                    ? 'cursor-default opacity-50'
                    : 'cursor-pointer hover:bg-[var(--mantine-color-gray-0)] dark:hover:bg-[var(--mantine-color-dark-5)]'
                }`}
                gap="xs"
                align="center"
                onClick={() => {
                  if (workModeCapabilitiesDisabled) return
                  onSkillSelect(skill.name)
                  onClose()
                }}
              >
                <IconWand size={14} className="text-[var(--chatbox-tint-tertiary)] shrink-0" />
                <Stack gap={0} className="min-w-0">
                  <Text size="sm" truncate>
                    /{skill.name}
                  </Text>
                  {skill.description && (
                    <Text size="xs" c="dimmed" truncate>
                      {skill.description}
                    </Text>
                  )}
                </Stack>
              </Flex>
            ))
          ) : (
            <Group justify="center" py="md">
              <Button
                size="xs"
                variant="light"
                disabled={workModeCapabilitiesDisabled}
                onClick={() => {
                  if (workModeCapabilitiesDisabled) return
                  onClose()
                  navigateToSettings('/skills')
                }}
              >
                <PlusIcon size={14} className="mr-1" />
                {t('Add Skills')}
              </Button>
            </Group>
          )}
        </>
      )
    }

    if (page === 'mcp') {
      return (
        <>
          <SubPanelHeader title="MCP" settingsPath="/mcp" disabled={workModeCapabilitiesDisabled} />
          <Divider my={4} />
          {isPremium && (
            <>
              {BUILTIN_MCP_SERVERS.map((server) => (
                <MCPServerItem
                  key={server.id}
                  id={server.id}
                  name={server.name}
                  enabled={mcp.enabledBuiltinServers.includes(server.id)}
                  disabled={workModeCapabilitiesDisabled}
                  onEnabledChange={onMCPEnabledChange}
                />
              ))}
              {mcp.servers.length > 0 && <Divider my={4} />}
            </>
          )}
          {mcp.servers.map((server) => (
            <MCPServerItem
              key={server.id}
              id={server.id}
              name={server.name}
              enabled={server.enabled}
              disabled={workModeCapabilitiesDisabled}
              onEnabledChange={onMCPEnabledChange}
            />
          ))}
          {!mcp.servers.length && !mcp.enabledBuiltinServers.length && (
            <Group justify="center" py="md">
              <Button
                size="xs"
                variant="light"
                disabled={workModeCapabilitiesDisabled}
                onClick={() => {
                  if (workModeCapabilitiesDisabled) return
                  onClose()
                  navigateToSettings('/mcp')
                }}
              >
                <PlusIcon size={14} className="mr-1" />
                {t('Add your first MCP server')}
              </Button>
            </Group>
          )}
        </>
      )
    }

    if (page === 'knowledge-base') {
      return (
        <>
          <SubPanelHeader title={t('Knowledge Base')} settingsPath="/knowledge-base" />
          <Divider my={4} />
          {knowledgeBases && knowledgeBases.length > 0 ? (
            knowledgeBases.map((kb) => (
              <Flex
                key={kb.id}
                justify="space-between"
                align="center"
                px="sm"
                py={6}
                className="rounded cursor-pointer hover:bg-[var(--mantine-color-gray-0)] dark:hover:bg-[var(--mantine-color-dark-5)]"
                onClick={() => {
                  onKnowledgeBaseSelect(kb.id === currentKnowledgeBaseId ? null : kb)
                  onClose()
                }}
              >
                <Flex gap="xs" align="center">
                  <IconFile size={14} />
                  <Text size="sm" c={kb.id === currentKnowledgeBaseId ? 'chatbox-brand' : ''}>
                    {kb.name}
                  </Text>
                </Flex>
                {kb.id === currentKnowledgeBaseId && <IconCheck size={14} color="var(--chatbox-tint-brand)" />}
              </Flex>
            ))
          ) : (
            <Group justify="center" py="md">
              <Link to="/settings/knowledge-base">
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => {
                    onClose()
                  }}
                >
                  <PlusIcon size={14} className="mr-1" />
                  {t('Create')}
                </Button>
              </Link>
            </Group>
          )}
        </>
      )
    }

    if (page === 'working-directory') {
      return (
        <>
          <SubPanelHeader title={t('Working Directory')} disabled={workModeCapabilitiesDisabled} />
          <Divider my={4} />
          <WorkingDirectoryContent
            workingDirectories={workingDirectories}
            availableRecentDirectories={availableRecentDirectories}
            disabled={workModeCapabilitiesDisabled}
            onRemove={(dir) => void handleRemoveWorkingDirectory(dir)}
            onSelectRecent={(dir) => void handleSelectRecentDirectory(dir)}
            onAdd={() => void handleAddWorkingDirectory()}
          />
        </>
      )
    }

    return null
  }

  const showMainList = !isTouchLayout || page === 'main'
  const showTouchSubPage = isTouchLayout && page !== 'main'
  const panelWidthClass = isTouchLayout
    ? 'w-full'
    : 'w-max min-w-[min(240px,calc(100vw-24px))] max-w-[min(340px,calc(100vw-24px))]'

  // ==================== RENDER ====================
  return (
    <div
      data-testid={TestId.agent.modePanel}
      data-layout={layout}
      className="relative"
      ref={panelRef}
      onMouseLeave={isTouchLayout ? undefined : handleSubPanelLeave}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && page === 'main') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      {showMainList && (
        <Stack gap={0} py="xs" className={panelWidthClass}>
          <Stack gap="xs" px="sm" py="xs" onMouseEnter={isTouchLayout ? undefined : handleNonExtensionHover}>
            <Text fw={600} size="sm" c="chatbox-primary">
              {t('Mode')}
            </Text>
            {showModeSwitcher ? (
              <>
                <Flex gap={6}>
                  <ModeButton value="off" label={t('Chat Mode')} />
                  <ModeButton value="on" label={t('Work Mode')} />
                </Flex>
                <Text size="xs" c="chatbox-secondary" className="leading-snug max-w-[244px]">
                  {modeDescription}
                </Text>
              </>
            ) : (
              <Flex align="flex-start" gap="sm" className="rounded-lg bg-chatbox-background-secondary px-2 py-1.5">
                <AgentModeStatusIcon mode="off" size={14} className="mt-0.5 shrink-0" />
                <Stack gap={2} className="min-w-0">
                  <Text size="sm" fw={500} c="chatbox-primary">
                    {t('Chat Mode')}
                  </Text>
                  <Text size="xs" c="chatbox-secondary" className="leading-snug">
                    {t('This app currently supports Chat Mode only. Use Work Mode on the desktop app.')}
                  </Text>
                </Stack>
              </Flex>
            )}
            {showModeSwitcher && isChatModeSelected && (
              <Flex
                justify="space-between"
                align="center"
                gap="sm"
                className="rounded-lg bg-chatbox-background-secondary px-2 py-1.5"
              >
                <Stack gap={0} className="min-w-0">
                  <Text size="xs" fw={500} c="chatbox-primary">
                    {t('Smart Switching')}
                  </Text>
                  <Text size="xs" c="chatbox-secondary" className="leading-snug max-w-[196px]">
                    {smartSwitchingDescription}
                  </Text>
                </Stack>
                <Switch
                  size="xs"
                  checked={smartSwitchingEnabled}
                  disabled={isSmartSwitchingDisabled}
                  onChange={(e) => handleSmartSwitchingChange(e.currentTarget.checked)}
                />
              </Flex>
            )}
          </Stack>

          <div>
            <Divider my={4} mx="sm" label={t('Built-in')} labelPosition="left" />

            <ExtensionRow
              icon={
                <IconWorldWww
                  size={16}
                  className={
                    webSearchConfigurationIssue
                      ? 'text-[var(--chatbox-tint-error)]'
                      : 'text-[var(--chatbox-tint-secondary)]'
                  }
                />
              }
              label={t('Web Search')}
              subtitle={
                webSearchConfigurationIssue === 'chatbox-ai-sign-in'
                  ? (t('Sign in required') ?? undefined)
                  : webSearchConfigurationIssue
                    ? (t('Setup required') ?? undefined)
                    : webBrowsingMode
                      ? webSearchProviderLabel
                      : undefined
              }
              danger={Boolean(webSearchConfigurationIssue)}
              active={page === 'web-search'}
              page="web-search"
              subPanelAlign="top"
              rightContent={
                <Flex gap="xs" align="center" className="shrink-0">
                  <span
                    data-row-control
                    className="inline-flex"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <Switch
                      data-testid={TestId.chat.webSearchToggle}
                      checked={webBrowsingMode}
                      size="xs"
                      onChange={(e) => {
                        const enabled = e.currentTarget.checked
                        trackWebSearchClick(
                          {
                            sessionId,
                            mode: agentModeUIState.isActive ? 'work_mode' : 'chat_mode',
                            provider: providerId,
                            model: modelId,
                          },
                          enabled,
                          webSearchProvider
                        )
                        onWebBrowsingChange(enabled)
                      }}
                    />
                  </span>
                  <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)]" />
                </Flex>
              }
            />

            {webSearchConfigurationIssue && (
              <Flex
                role="status"
                align="flex-start"
                gap={6}
                mx="sm"
                mb={6}
                px={10}
                py={8}
                className="rounded-lg bg-chatbox-background-error-secondary"
              >
                <IconAlertCircle size={14} color="var(--chatbox-tint-error)" className="mt-0.5 shrink-0" />
                <Stack gap={3} className="min-w-0">
                  <Text size="xs" c="chatbox-secondary" className="leading-snug">
                    {webSearchConfigurationIssue === 'chatbox-ai-sign-in'
                      ? t('Chatbox AI Search needs sign-in. Web Search will be skipped while this setting is on.')
                      : t('The selected Web Search provider needs to be configured before it can run.')}
                  </Text>
                  <UnstyledButton
                    className="w-fit text-xs font-semibold text-[var(--chatbox-tint-brand)]"
                    onClick={() => {
                      onClose()
                      navigateToSettings(
                        webSearchConfigurationIssue === 'chatbox-ai-sign-in' ? undefined : '/web-search'
                      )
                    }}
                  >
                    {webSearchConfigurationIssue === 'chatbox-ai-sign-in'
                      ? t('Sign in to Chatbox AI')
                      : t('Open Web Search settings')}{' '}
                    →
                  </UnstyledButton>
                </Stack>
              </Flex>
            )}

            <ExtensionRow
              icon={<IconNotes size={16} className="text-[var(--chatbox-tint-secondary)]" />}
              label={t('Memory')}
              badge={effectiveMemorySource !== 'none' && memoryCount && memoryCount > 0 ? memoryCount : undefined}
              active={page === 'memory'}
              page="memory"
              subPanelAlign="top"
              rightContent={
                <Flex gap="xs" align="center" className="shrink-0">
                  <Badge size="xs" variant="light" color={effectiveMemorySource === 'none' ? 'gray' : 'chatbox-brand'}>
                    {effectiveMemorySource === 'copilot'
                      ? t('Copilot Memory')
                      : effectiveMemorySource === 'global'
                        ? t('Global Memory')
                        : t('Off')}
                  </Badge>
                  <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)]" />
                </Flex>
              }
            />

            {showCodeExecution && (
              <ExtensionRow
                icon={<IconCode size={16} className="text-[var(--chatbox-tint-secondary)]" />}
                label={t('Code Execution')}
                active={page === 'code-execution'}
                page="code-execution"
                disabled={workModeCapabilitiesDisabled}
                subPanelAlign="top"
                rightContent={
                  <Flex gap="xs" align="center" className="shrink-0">
                    {commandApprovalMode === 'full_access' ? (
                      <Badge size="xs" variant="light" color="red">
                        {t('Full Access')}
                      </Badge>
                    ) : (
                      <Badge size="xs" variant="light">
                        {commandApprovalMode === 'always_ask' ? t('Always Ask') : t('Smart Approval')}
                      </Badge>
                    )}
                    <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)]" />
                  </Flex>
                }
              />
            )}

            {showExtensions && <Divider my={4} mx="sm" label={t('Extensions')} labelPosition="left" />}

            {showSkills && (
              <ExtensionRow
                icon={<IconWand size={16} className="text-[var(--chatbox-tint-secondary)]" />}
                label="Skills"
                badge={enabledSkillNames.length > 0 ? enabledSkillNames.length : undefined}
                active={page === 'skills'}
                page="skills"
                disabled={workModeCapabilitiesDisabled}
              />
            )}

            {showMcp && (
              <ExtensionRow
                icon={<IconHammer size={16} className="text-[var(--chatbox-tint-secondary)]" />}
                label="MCP"
                badge={enabledMCPCount > 0 ? enabledMCPCount : undefined}
                active={page === 'mcp'}
                page="mcp"
                disabled={workModeCapabilitiesDisabled}
              />
            )}

            {showKnowledgeBase && (
              <ExtensionRow
                icon={<IconVocabulary size={16} className="text-[var(--chatbox-tint-secondary)]" />}
                label={t('Knowledge Base')}
                subtitle={selectedKB?.name}
                active={page === 'knowledge-base'}
                page="knowledge-base"
              />
            )}

            {showWorkingDirectory && (
              <ExtensionRow
                icon={<IconFolderCog size={16} className="text-[var(--chatbox-tint-secondary)]" />}
                label={t('Working Directory')}
                badge={workingDirectories.length > 0 ? workingDirectories.length : undefined}
                active={page === 'working-directory'}
                page="working-directory"
                disabled={workModeCapabilitiesDisabled}
              />
            )}
          </div>

          {showDesktopCapabilityHint && (
            <Text size="xs" c="chatbox-secondary" px="sm" pt="sm" pb="xs" className="leading-snug">
              {t('Skills, MCP, code execution, and Working Directory are available in the desktop app.')}
            </Text>
          )}
        </Stack>
      )}

      {showTouchSubPage && (
        <Stack
          key={page}
          ref={subPanelRef}
          gap={0}
          py="xs"
          className="w-full overflow-y-auto overscroll-contain"
          style={{ maxHeight: 'min(70dvh, 560px)' }}
        >
          {renderSubPanel()}
        </Stack>
      )}

      {!isTouchLayout && page !== 'main' && (
        <Stack
          key={page}
          ref={subPanelRef}
          gap={0}
          py="xs"
          className={`absolute overflow-y-auto bg-[var(--mantine-color-body)] shadow-lg border-[var(--mantine-color-default-border)] ${
            resolvedSubPanelPosition?.placement === 'overlay'
              ? 'rounded-lg border'
              : resolvedSubPanelPosition?.placement === 'left'
                ? 'right-full rounded-l-lg border-r'
                : 'left-full rounded-r-lg border-l'
          }`}
          style={{
            width: resolvedSubPanelPosition?.width ?? SUB_PANEL_WIDTH,
            maxHeight: resolvedSubPanelPosition?.maxHeight ?? SUB_PANEL_MAX_HEIGHT,
            ...(resolvedSubPanelPosition?.placement === 'overlay'
              ? { left: resolvedSubPanelPosition.left }
              : undefined),
            ...(resolvedSubPanelPosition
              ? { top: resolvedSubPanelPosition.top }
              : subPanelAlign === 'top'
                ? { top: subPanelTop }
                : { bottom: 0 }),
          }}
          onMouseEnter={handleSubPanelEnter}
        >
          {renderSubPanel()}
        </Stack>
      )}
    </div>
  )
})

export default AgentModePanel
