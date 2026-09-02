import { ActionIcon, Badge, Box, Flex, Loader, Paper, Stack, Text } from '@mantine/core'
import type { MemoryEntry } from '@shared/types/agent-persona'
import { MEMORY_MAX_ENTRIES } from '@shared/types/agent-persona'
import { IconTrash } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteCopilotMemory, listCopilotMemories } from '@/stores/agentPersonaStore'

/** View and delete one copilot's own memories (saved by chats with that copilot). */
export function CopilotMemoriesList({ copilotId }: { copilotId: string }) {
  const { t } = useTranslation()
  const [memories, setMemories] = useState<MemoryEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    listCopilotMemories(copilotId)
      .catch(() => [])
      .then((entries) => {
        if (!cancelled) setMemories(entries)
      })
    return () => {
      cancelled = true
    }
  }, [copilotId])

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteCopilotMemory(copilotId, id)
      setMemories((current) => (current ?? []).filter((entry) => entry.id !== id))
    },
    [copilotId]
  )

  if (memories === null) {
    return (
      <Flex justify="center" py="sm">
        <Loader size="sm" />
      </Flex>
    )
  }

  return (
    <Stack gap="xs">
      <Flex align="center" gap="xs">
        <Text size="sm" fw={500}>
          {t('Memories')}
        </Text>
        <Badge size="sm" variant="light" color="chatbox-secondary">
          {memories.length}/{MEMORY_MAX_ENTRIES}
        </Badge>
      </Flex>
      {memories.length === 0 ? (
        <Text size="sm" c="dimmed" fs="italic">
          {t('No memories yet. Chats with this copilot save durable facts here.')}
        </Text>
      ) : (
        <Stack gap={6}>
          {memories.map((entry) => (
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
                  onClick={() => void handleDelete(entry.id)}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Flex>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
