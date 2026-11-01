import { Badge, Box, Button, Flex, Loader, Text } from '@mantine/core'
import type { MemoryEntry } from '@shared/types/agent-persona'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PopoverConfirm from '@/components/common/PopoverConfirm'
import { SettingsListItem, SettingsSection } from '@/components/settings/SettingsLayout'
import { useCopilotMemory, useMyCopilots } from '@/hooks/useCopilots'
import { clearCopilotMemories, deleteCopilotMemory, listAllCopilotMemories } from '@/stores/agentPersonaStore'
import { MemoryEntryItem } from './MemoryEntryItem'

interface CopilotMemoryGroup {
  copilotId: string
  name: string
  entries: MemoryEntry[]
}

/**
 * Every copilot that has its own memories, grouped by copilot. Grouping by the
 * stored buckets rather than by the copilots that currently own memory keeps the
 * entries reachable after the switch is turned off, and for copilots used straight
 * from the store that were never saved to My Copilots.
 */
export function CopilotMemoriesSection() {
  const { t } = useTranslation()
  const { copilots } = useMyCopilots()
  const { owners } = useCopilotMemory()
  const [record, setRecord] = useState<Record<string, MemoryEntry[]> | null>(null)

  useEffect(() => {
    let cancelled = false
    listAllCopilotMemories()
      .catch(() => ({}))
      .then((entries) => {
        if (!cancelled) setRecord(entries)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const groups = useMemo<CopilotMemoryGroup[]>(() => {
    if (!record) return []
    return Object.entries(record)
      .filter(([, entries]) => entries.length > 0)
      .map(([copilotId, entries]) => ({
        copilotId,
        // A saved copilot may have been renamed since, so its live name wins over
        // the label captured when its memory was switched on.
        name:
          copilots.find((copilot) => copilot.id === copilotId)?.name ??
          owners.find((owner) => owner.id === copilotId)?.name ??
          (t('Unnamed copilot') || copilotId),
        entries,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [copilots, owners, record, t])

  const handleDelete = useCallback(async (copilotId: string, id: string) => {
    await deleteCopilotMemory(copilotId, id)
    setRecord((current) => ({
      ...current,
      [copilotId]: (current?.[copilotId] ?? []).filter((entry) => entry.id !== id),
    }))
  }, [])

  const handleClear = useCallback(async (copilotId: string) => {
    await clearCopilotMemories(copilotId)
    setRecord((current) => ({ ...current, [copilotId]: [] }))
  }, [])

  if (record === null) {
    return (
      <Flex justify="center" py="sm">
        <Loader size="sm" />
      </Flex>
    )
  }

  if (groups.length === 0) return null

  return (
    <SettingsSection
      title={t('Copilot Memories')}
      description={t(
        'Memories saved by chats with a specific copilot. Each copilot has its own list, and global memories stay out of those chats.'
      )}
    >
      {groups.map((group) => (
        <Fragment key={group.copilotId}>
          <SettingsListItem tint="secondary">
            <Text fz={14} fw={600} truncate>
              {group.name}
            </Text>
            <Badge size="sm" variant="light" color="chatbox-secondary">
              {group.entries.length}
            </Badge>
            <Box flex={1} />
            <PopoverConfirm
              title={t('Clear all memories for "{{name}}"? This cannot be undone.', { name: group.name })}
              confirmButtonText={t('Clear all') ?? undefined}
              confirmButtonColor="chatbox-error"
              onConfirm={() => void handleClear(group.copilotId)}
            >
              <Button size="compact-sm" variant="subtle" color="chatbox-error">
                {t('Clear all')}
              </Button>
            </PopoverConfirm>
          </SettingsListItem>
          {group.entries.map((entry) => (
            <MemoryEntryItem
              key={entry.id}
              entry={entry}
              onDelete={() => void handleDelete(group.copilotId, entry.id)}
            />
          ))}
        </Fragment>
      ))}
    </SettingsSection>
  )
}
