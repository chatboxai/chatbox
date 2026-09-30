import { Capacitor } from '@capacitor/core'
import { hasConversationStarted, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import { ActionIcon, Badge, Button, Divider, Group, Stack, Switch, Text, UnstyledButton } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import {
  LOCAL_WORK_CAPABILITY_IDS,
  type LocalWorkCapabilityId,
  resolveLocalWorkCapabilities,
  setLocalWorkCapability,
} from '@shared/mobile-work/capabilities'
import { IconBook, IconChevronLeft, IconChevronRight, IconDeviceMobile, IconNotes, IconPlug } from '@tabler/icons-react'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { MCPConnectionSummary } from '@/components/mcp/MCPConnectionSummary'
import { useSessionLockState } from '@/hooks/useSessionLockState'
import { useSessionPresentation } from '@/hooks/useSessionPresentation'
import { navigateToSettings } from '@/modals/settings-navigation'
import { getWebSearchConfigurationIssue } from '@/packages/web-search/configuration-issue'
import { WEB_SEARCH_PROVIDERS } from '@/packages/web-search/constants'
import { setSessionAgentMode, useSessionAgentMode } from '@/stores/session/agent-mode'
import { useSettingsStore } from '@/stores/settingsStore'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import { AgentMemorySettingsContent, useAgentMemorySettings } from './AgentMemorySettings'
import type { AgentModePanelHandle, AgentModePanelProps } from './AgentModePanel'
import AgentModeStatusIcon from './AgentModeStatusIcon'

export function isMobileWorkCapabilityAvailable(id: LocalWorkCapabilityId): boolean {
  if (id === 'photos') return true
  return Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('MobileSystemTools')
}

const MobileAgentModePanel = forwardRef<AgentModePanelHandle, AgentModePanelProps>(function MobileAgentModePanel(
  {
    sessionId,
    providerId,
    modelId,
    draftCopilotId,
    draftCopilotName,
    hasDraftAttachments = false,
    modelSupportsAgentMode = true,
    webBrowsingMode,
    onWebBrowsingChange,
    onClose,
  },
  ref
) {
  const { t } = useTranslation()
  const [page, setPage] = useState<'main' | 'services' | 'memory'>('main')
  useImperativeHandle(
    ref,
    () => ({
      goBack: () => {
        if (page === 'main') return false
        setPage('main')
        return true
      },
    }),
    [page]
  )
  const entry = useSessionAgentMode(sessionId)
  const { readModel, header } = useSessionPresentation(sessionId === 'new' ? null : sessionId)
  const fullSession = readModel?.kind === 'full' ? readModel.session : undefined
  const locks = useSessionLockState(fullSession, sessionId)
  rendererApplication.generationHooks.useVersion()
  const busy =
    locks.anyReplyGenerating ||
    locks.compactionRunning ||
    locks.awaitingPauseDecision ||
    rendererApplication.generationRuntime.getActiveMessageIds(sessionId).size > 0
  const conversationStarted =
    readModel?.kind === 'full'
      ? hasConversationStarted(readModel.session)
      : readModel?.kind === 'window' && readModel.summary.userMessageCount > 0
  const loading = sessionId !== 'new' && !readModel
  const draft = useUIStore((s) => s.newSessionState)
  const setDraft = useUIStore((s) => s.setNewSessionState)
  const rememberMode = useUIStore((s) => s.setAgentModeLastSelected)
  const selected = resolveLocalWorkCapabilities(
    sessionId === 'new' ? draft.localWorkCapabilities : header?.settings?.localWorkCapabilities
  )
  const [saving, setSaving] = useState(false)
  const workActive = entry.value === 'on' && modelSupportsAgentMode
  const memory = useAgentMemorySettings({
    sessionId,
    providerId,
    modelId,
    agentModeActive: workActive,
    copilotId: sessionId === 'new' ? draftCopilotId : header?.copilotId,
    copilotName: sessionId === 'new' ? draftCopilotName : header?.name,
    onClose,
  })
  const webSearch = useSettingsStore((s) => s.extension.webSearch)
  const licenseKey = useSettingsStore((s) => s.licenseKey)
  const webIssue = webBrowsingMode && getWebSearchConfigurationIssue(webSearch, licenseKey) !== null
  const webProvider = WEB_SEARCH_PROVIDERS.find((p) => p.value === webSearch.provider)?.label ?? webSearch.provider
  const labels: Record<LocalWorkCapabilityId, string> = {
    photos: t('Photos'),
    calendar: t('Calendar'),
    reminders: t('Reminders'),
    health: t('Health (read only)'),
  }
  const activeCount = selected.filter(isMobileWorkCapabilityAvailable).length
  const descriptions: Record<LocalWorkCapabilityId, string> = {
    photos:
      Capacitor.getPlatform() === 'ios'
        ? t('Choose photos for tasks and save generated images.')
        : t('Choose photos for the local workspace.'),
    calendar: t('Read events and add events to your calendar.'),
    reminders: t('Read, create, and complete reminders.'),
    health: t('Read summaries of steps, sleep, and workouts.'),
  }
  const saveCapability = async (id: LocalWorkCapabilityId, enabled: boolean) => {
    if (busy || saving || loading || !workActive || !isMobileWorkCapabilityAvailable(id)) return
    setSaving(true)
    try {
      if (sessionId === 'new') {
        setDraft((current) => ({
          ...current,
          localWorkCapabilities: setLocalWorkCapability(current.localWorkCapabilities, id, enabled),
        }))
      } else {
        await rendererApplication.sessions.updateSession(sessionId, (current) => {
          if (!current) throw new Error('Session not found')
          return {
            ...current,
            settings: {
              ...current.settings,
              localWorkCapabilities: setLocalWorkCapability(current.settings?.localWorkCapabilities, id, enabled),
            },
          }
        })
      }
    } catch {
      toastActions.add(t('Failed to save settings'))
    } finally {
      setSaving(false)
    }
  }
  const saveMode = async (mode: 'on' | 'off') => {
    if (hasDraftAttachments && resolveSessionMode(entry.value) !== resolveSessionMode(mode)) return
    setSaving(true)
    try {
      const updated = await setSessionAgentMode(sessionId, mode)
      if (updated.value === mode) rememberMode(mode)
    } catch {
      toastActions.add(t('Failed to save settings'))
    } finally {
      setSaving(false)
    }
  }

  if (page === 'memory') {
    return (
      <Stack gap="sm" p="md" style={{ maxHeight: '70dvh', overflowY: 'auto' }}>
        <Group gap="xs">
          <ActionIcon
            data-testid={TestId.agent.modePanelBack}
            variant="subtle"
            size={36}
            aria-label={t('Back')}
            onClick={() => setPage('main')}
          >
            <IconChevronLeft size={18} />
          </ActionIcon>
          <Text size="sm" fw={600}>
            {t('Memory')}
          </Text>
        </Group>
        <AgentMemorySettingsContent memory={memory} />
      </Stack>
    )
  }

  if (page === 'services')
    return (
      <Stack gap="sm" p="md" style={{ maxHeight: '70dvh', overflowY: 'auto' }}>
        <Group gap="xs">
          <ActionIcon
            data-testid={TestId.agent.modePanelBack}
            variant="subtle"
            size={36}
            aria-label={t('Back')}
            onClick={() => setPage('main')}
          >
            <IconChevronLeft size={18} />
          </ActionIcon>
          <Text size="sm" fw={600}>
            {t('Device services')}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {t('Enabled tools load only when needed. System permissions are requested when a tool is used.')}
        </Text>
        {!workActive && (
          <Text size="xs" c="dimmed">
            {t('Switch to Work Mode to use device services.')}
          </Text>
        )}
        {LOCAL_WORK_CAPABILITY_IDS.map((id) => {
          const available = isMobileWorkCapabilityAvailable(id)
          if (Capacitor.getPlatform() === 'android' && !available) return null
          return (
            <Group key={id} justify="space-between" wrap="nowrap">
              <Stack gap={2} style={{ flex: 1 }}>
                <Text size="sm">{labels[id]}</Text>
                <Text size="xs" c="dimmed">
                  {descriptions[id]}
                </Text>
              </Stack>
              {!available && (
                <Badge size="xs" color="gray">
                  {t('Unavailable')}
                </Badge>
              )}
              <Switch
                aria-label={labels[id]}
                checked={available && selected.includes(id)}
                disabled={!available || !workActive || busy || saving || loading}
                onChange={(event) => void saveCapability(id, event.currentTarget.checked)}
              />
            </Group>
          )
        })}
      </Stack>
    )

  return (
    <Stack gap="sm" p="md" style={{ maxHeight: '70dvh', overflowY: 'auto' }}>
      <Text size="sm" fw={600}>
        {t('Mode')}
      </Text>
      <Group grow wrap="nowrap">
        {(['off', 'on'] as const).map((mode) => {
          const isCurrent = resolveSessionMode(entry.value) === resolveSessionMode(mode)
          const unavailable =
            saving ||
            busy ||
            loading ||
            (mode === 'on' && !modelSupportsAgentMode) ||
            (entry.locked && mode !== 'on') ||
            Boolean((conversationStarted || hasDraftAttachments) && !isCurrent)
          return (
            <Button
              key={mode}
              data-testid={mode === 'on' ? TestId.agent.modeWork : TestId.agent.modeChat}
              variant={isCurrent ? 'filled' : 'default'}
              leftSection={<AgentModeStatusIcon mode={mode} size={16} />}
              // A disabled Mantine button drops its filled variant, so the current mode stays
              // enabled (its click guarded instead) to keep the selection visible while locked.
              disabled={unavailable && !isCurrent}
              aria-pressed={isCurrent}
              onClick={() => {
                if (!unavailable) void saveMode(mode)
              }}
              styles={{ root: { height: 'auto', minHeight: 40 }, label: { whiteSpace: 'normal', paddingBlock: 6 } }}
            >
              {mode === 'on' ? t('Work Mode') : t('Chat Mode')}
            </Button>
          )
        })}
      </Group>
      {hasDraftAttachments && !conversationStarted && (
        <Text size="xs" c="dimmed">
          {t('Remove attachments before changing modes.')}
        </Text>
      )}
      {(conversationStarted || entry.locked) && (
        <Text size="xs" c="dimmed">
          {t('Locked after the chat starts to keep tools and context consistent — start a new chat to change')}
        </Text>
      )}
      {!modelSupportsAgentMode && (
        <Text size="xs" c="dimmed">
          {t('This model does not support Agent Mode')}
        </Text>
      )}
      {workActive && (
        <Text size="xs" c="dimmed">
          {t('Keep Chatbox in the foreground while tasks are running.')}
        </Text>
      )}
      <Divider />
      <UnstyledButton aria-label={t('Memory')} onClick={() => setPage('memory')} style={{ minHeight: 44 }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <IconNotes size={18} />
            <Text size="sm">{t('Memory')}</Text>
            {memory.effectiveMemorySource !== 'none' && memory.memoryCount !== null && memory.memoryCount > 0 && (
              <Badge size="xs" variant="light">
                {memory.memoryCount}
              </Badge>
            )}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Badge size="xs" variant="light" color={memory.effectiveMemorySource === 'none' ? 'gray' : 'chatbox-brand'}>
              {memory.effectiveMemorySource === 'copilot'
                ? t('Copilot Memory')
                : memory.effectiveMemorySource === 'global'
                  ? t('Global Memory')
                  : t('Off')}
            </Badge>
            <IconChevronRight size={16} />
          </Group>
        </Group>
      </UnstyledButton>
      <UnstyledButton aria-label={t('Device services')} onClick={() => setPage('services')} style={{ minHeight: 44 }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <IconDeviceMobile size={18} />
            <Text size="sm">{t('Device services')}</Text>
            {activeCount > 0 && (
              <Badge size="xs" variant="light">
                {activeCount}
              </Badge>
            )}
          </Group>
          <IconChevronRight size={16} />
        </Group>
      </UnstyledButton>
      <UnstyledButton
        aria-label={t('MCP Settings')}
        onClick={() => {
          onClose?.()
          navigateToSettings('/mcp')
        }}
        style={{ minHeight: 44 }}
      >
        <Group justify="space-between">
          <Group gap="xs">
            <IconPlug size={18} />
            <Stack gap={0}>
              <Text size="sm">{t('MCP Settings')}</Text>
              <MCPConnectionSummary />
            </Stack>
          </Group>
          <IconChevronRight size={16} />
        </Group>
      </UnstyledButton>
      <UnstyledButton
        aria-label={t('Skills')}
        disabled={entry.value !== 'on'}
        onClick={() => {
          onClose?.()
          navigateToSettings('/skills')
        }}
        style={{ minHeight: 44, opacity: entry.value === 'on' ? 1 : 0.45 }}
      >
        <Group justify="space-between">
          <Group gap="xs">
            <IconBook size={18} />
            <Stack gap={2}>
              <Text size="sm">{t('Skills')}</Text>
              {entry.value !== 'on' && (
                <Text size="xs" c="dimmed">
                  {t('Enabled in Work Mode')}
                </Text>
              )}
            </Stack>
          </Group>
          <IconChevronRight size={16} />
        </Group>
      </UnstyledButton>
      <Divider />
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={2}>
          <Text size="sm">{t('Web Search')}</Text>
          <Text size="xs" c="dimmed">
            {webProvider}
          </Text>
        </Stack>
        <Switch
          aria-label={String(t('Web Search'))}
          checked={webBrowsingMode}
          disabled={busy || saving}
          onChange={(event) => onWebBrowsingChange(event.currentTarget.checked)}
        />
      </Group>
      {webIssue && (
        <Text size="xs" c="orange">
          {t('Configure Web Search to use this capability.')}
        </Text>
      )}
      <Button
        variant="subtle"
        size="xs"
        onClick={() => {
          onClose()
          navigateToSettings('/web-search')
        }}
      >
        {t('Web Search Settings')}
      </Button>
    </Stack>
  )
})

export default MobileAgentModePanel
