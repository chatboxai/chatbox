import NiceModal from '@ebay/nice-modal-react'
import { Button, Divider, Flex, Group, Loader, Stack, Switch, Text } from '@mantine/core'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackMemoryClick } from '@/analytics/agent-mode'
import { useCopilotMemory, useMyCopilots } from '@/hooks/useCopilots'
import { navigateToSettings } from '@/modals/settings-navigation'
import { listCopilotMemories, listMemories } from '@/stores/agentPersonaStore'
import { useSettingsStore } from '@/stores/settingsStore'

export function useAgentMemorySettings({
  sessionId,
  providerId,
  modelId,
  agentModeActive,
  copilotId: sessionCopilotId,
  copilotName,
  onClose,
}: {
  sessionId: string
  providerId?: string
  modelId?: string
  agentModeActive: boolean
  copilotId?: string
  copilotName?: string
  onClose: () => void
}) {
  const setSettings = useSettingsStore((s) => s.setSettings)
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
  const savedCopilot = useMemo(
    () => (sessionCopilotId ? myCopilots.find((copilot) => copilot.id === sessionCopilotId) : undefined),
    [myCopilots, sessionCopilotId]
  )
  /** Label for the copilot behind this chat, whether or not it was ever saved. */
  const sessionCopilotName = useMemo(() => {
    if (!sessionCopilotId) return undefined
    const owned = copilotMemoryOwners.find((owner) => owner.id === sessionCopilotId)
    return savedCopilot?.name ?? owned?.name ?? copilotName
  }, [copilotMemoryOwners, copilotName, savedCopilot, sessionCopilotId])
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

  const trackMemoryEnabledChange = useCallback(
    (enabled: boolean) => {
      trackMemoryClick(
        {
          sessionId,
          mode: agentModeActive ? 'work_mode' : 'chat_mode',
          provider: providerId,
          model: modelId,
        },
        enabled
      )
    },
    [agentModeActive, modelId, providerId, sessionId]
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

  const settingsPath = savedCopilot && effectiveMemorySource === 'copilot' ? undefined : '/agent'
  const manageMemories = () => {
    if (savedCopilot && effectiveMemorySource === 'copilot') {
      openCopilotSettings()
      return
    }
    onClose()
    navigateToSettings('/agent')
  }
  return {
    sessionCopilotId,
    sessionCopilotName,
    copilotMemoryEnabled,
    globalMemoryEnabled,
    effectiveMemorySource,
    memoryCount,
    settingsPath,
    manageMemories,
    handleCopilotMemoryEnabledChange,
    handleGlobalMemoryEnabledChange,
  }
}

type AgentMemorySettings = ReturnType<typeof useAgentMemorySettings>

export function AgentMemorySettingsContent({ memory }: { memory: AgentMemorySettings }) {
  const { t } = useTranslation()
  const {
    sessionCopilotId,
    sessionCopilotName,
    copilotMemoryEnabled,
    globalMemoryEnabled,
    memoryCount,
    manageMemories,
    handleCopilotMemoryEnabledChange,
    handleGlobalMemoryEnabledChange,
  } = memory
  return (
    <>
      {sessionCopilotName && (
        <Text size="xs" fw={500} c="chatbox-primary" px="sm" pt={6} className="leading-snug">
          {sessionCopilotName}
        </Text>
      )}
      <MemorySettingRow
        label={t('Copilot Memory')}
        description={
          sessionCopilotId
            ? t('All chats with this Copilot use its shared memory when on, or follow Global Memory when off.')
            : t('You must create a copilot and use it in a conversation to use Copilot Memory.')
        }
        checked={copilotMemoryEnabled}
        disabled={!sessionCopilotId}
        onChange={handleCopilotMemoryEnabledChange}
      />
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
              manageMemories()
            }}
          >
            {t('Manage memories')}
          </Button>
        </Group>
      )}
    </>
  )
}

const MemorySettingRow: FC<{
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (enabled: boolean) => void
}> = ({ label, description, checked, disabled = false, onChange }) => (
  <Flex justify="space-between" align="center" gap="sm" px="sm" py="xs">
    <Stack gap={2} className="min-w-0">
      <Text size="sm" fw={500} c={disabled ? 'dimmed' : undefined}>
        {label}
      </Text>
      <Text size="xs" c="dimmed" className="leading-snug">
        {description}
      </Text>
    </Stack>
    <Switch
      aria-label={label}
      checked={checked}
      disabled={disabled}
      size="xs"
      className="shrink-0"
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  </Flex>
)
