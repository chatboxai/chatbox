import { ActionIcon, Badge, Box, Button, Flex, Loader, Paper, Stack, Text, Title } from '@mantine/core'
import type { MemoryEntry } from '@shared/types/agent-persona'
import { IconTrash } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PopoverConfirm from '@/components/common/PopoverConfirm'
import { useCopilotMemory, useMyCopilots } from '@/hooks/useCopilots'
import { clearCopilotMemories, deleteCopilotMemory, listAllCopilotMemories } from '@/stores/agentPersonaStore'

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
    <Stack gap="sm">
      <Title order={6}>{t('Copilot Memories')}</Title>
      <Text size="sm" c="dimmed">
        {t(
          'Memories saved by chats with a specific copilot. Each copilot has its own list, and global memories stay out of those chats.'
        )}
      </Text>
      {groups.map((group) => (
        <Stack key={group.copilotId} gap="xs">
          <Flex align="center" gap="xs">
            <Text size="sm" fw={500}>
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
              <Button size="xs" variant="subtle" color="chatbox-error">
                {t('Clear all')}
              </Button>
            </PopoverConfirm>
          </Flex>
          <Stack gap={6}>
            {group.entries.map((entry) => (
              <Paper key={entry.id} withBorder radius="md" p="xs">
                <Flex align="flex-start" gap="xs">
                  <Box flex={1}>
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {entry.content}
                    </Text>
                    <Text size="xs" c="dimmed" mt={2}>
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </Text>
                  </Box>
                  <ActionIcon
                    variant="subtle"
                    color="chatbox-error"
                    size="sm"
                    aria-label={t('Delete')}
                    onClick={() => void handleDelete(group.copilotId, entry.id)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Flex>
              </Paper>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  )
}
