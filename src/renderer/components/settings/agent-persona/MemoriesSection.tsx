import { ActionIcon, Badge, Box, Button, Flex, Loader, Paper, Stack, Text, Title } from '@mantine/core'
import type { LocalMemoryCandidate } from '@shared/agent-persona/memory-import'
import type { MemoryEntry } from '@shared/types/agent-persona'
import { MEMORY_MAX_ENTRIES } from '@shared/types/agent-persona'
import { IconRefresh, IconTrash } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import platform from '@/platform'
import {
  deleteMemory,
  hasCompletedLocalMemoryAutoScan,
  importMemories,
  listMemories,
  markLocalMemoryAutoScanCompleted,
} from '@/stores/agentPersonaStore'
import { add as addToast } from '@/stores/toastActions'
import { MemoryImportReviewModal } from './MemoryImportReviewModal'

export function MemoriesSection() {
  const { t } = useTranslation()
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanComplete, setScanComplete] = useState(false)
  const [candidates, setCandidates] = useState<LocalMemoryCandidate[]>([])
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([])
  const [reviewOpened, setReviewOpened] = useState(false)
  const [importing, setImporting] = useState(false)

  const refresh = useCallback(async () => {
    const entries = await listMemories()
    setMemories(entries)
    setLoading(false)
  }, [])

  const scanLocalMemories = useCallback(
    async (existingMemories: MemoryEntry[], openReview: boolean) => {
      if (!platform.scanLocalAgentMemories) return
      setScanning(true)
      try {
        const result = await platform.scanLocalAgentMemories()
        const existing = new Set(existingMemories.map((entry) => entry.content))
        const newCandidates = result.candidates.filter((candidate) => !existing.has(candidate.content))
        setCandidates(newCandidates)
        setSelectedCandidateIds(newCandidates.map((candidate) => candidate.id))
        if (openReview && newCandidates.length > 0) setReviewOpened(true)
      } catch {
        addToast(t('Failed to scan local memories.'))
      } finally {
        setScanning(false)
        setScanComplete(true)
      }
    },
    [t]
  )

  useEffect(() => {
    let mounted = true
    void listMemories().then(async (entries) => {
      if (!mounted) return
      setMemories(entries)
      setLoading(false)
      // The scan auto-runs only on its first opportunity per device; afterwards
      // it is triggered manually via the "Scan again" button.
      if (!platform.scanLocalAgentMemories) return
      if (await hasCompletedLocalMemoryAutoScan()) return
      if (!mounted) return
      await markLocalMemoryAutoScanCompleted()
      await scanLocalMemories(entries, true)
    })
    return () => {
      mounted = false
    }
  }, [scanLocalMemories])

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteMemory(id)
      await refresh()
    },
    [refresh]
  )

  const handleImport = useCallback(async () => {
    const selected = candidates.filter((candidate) => selectedCandidateIds.includes(candidate.id))
    if (selected.length === 0) return
    setImporting(true)
    try {
      const result = await importMemories(selected.map((candidate) => candidate.content))
      const entries = await listMemories()
      setMemories(entries)
      setReviewOpened(false)
      await scanLocalMemories(entries, false)
      const skippedEntries = result.skippedDuplicate + result.skippedEmpty + result.skippedTooLong + result.skippedLimit
      addToast(
        t(
          'Imported {{imported}} memories. {{skipped}} duplicate, invalid, oversized, or over-limit entries were skipped.',
          {
            imported: result.imported,
            skipped: skippedEntries,
          }
        )
      )
    } catch {
      addToast(t('Failed to import memories.'))
    } finally {
      setImporting(false)
    }
  }, [candidates, scanLocalMemories, selectedCandidateIds, t])

  const handleRescan = useCallback(async () => {
    const entries = await listMemories()
    setMemories(entries)
    await scanLocalMemories(entries, true)
  }, [scanLocalMemories])

  return (
    <Stack gap="sm">
      <Flex align="center" gap="xs">
        <Title order={6}>{t('Memories')}</Title>
        <Badge size="sm" variant="light" color="chatbox-secondary">
          {memories.length}/{MEMORY_MAX_ENTRIES}
        </Badge>
        <Box flex={1} />
        {platform.scanLocalAgentMemories && (
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            loading={scanning}
            onClick={() => void handleRescan()}
          >
            {t('Scan again')}
          </Button>
        )}
      </Flex>
      <Text size="sm" c="dimmed">
        {t(
          'Facts the agent saved from your conversations. They are loaded into new agent sessions; deleting one only affects future sessions.'
        )}
      </Text>
      {platform.scanLocalAgentMemories && (
        <Text size="xs" c="dimmed">
          {t(
            'Local Claude and Codex memories are scanned automatically only once; use the scan button to check for new ones. Nothing is imported until you review and confirm it.'
          )}
        </Text>
      )}
      {scanning && (
        <Flex gap="xs" align="center">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            {t('Scanning local memories…')}
          </Text>
        </Flex>
      )}
      {!scanning && candidates.length > 0 && (
        <Paper withBorder radius="md" p="sm">
          <Flex gap="sm" align="center">
            <Text size="sm" flex={1}>
              {t('Found {{count}} new local memories.', { count: candidates.length })}
            </Text>
            <Button size="xs" variant="light" onClick={() => setReviewOpened(true)}>
              {t('Review')}
            </Button>
          </Flex>
        </Paper>
      )}
      {!scanning && scanComplete && candidates.length === 0 && (
        <Text size="xs" c="dimmed">
          {t('No new local memories were found.')}
        </Text>
      )}
      {!loading && memories.length === 0 && (
        <Text size="sm" c="dimmed" fs="italic">
          {t('No memories yet. The agent saves durable facts here as you work together.')}
        </Text>
      )}
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
      <MemoryImportReviewModal
        opened={reviewOpened}
        candidates={candidates}
        selectedIds={selectedCandidateIds}
        importing={importing}
        onClose={() => setReviewOpened(false)}
        onSelectedIdsChange={setSelectedCandidateIds}
        onImport={() => void handleImport()}
      />
    </Stack>
  )
}
