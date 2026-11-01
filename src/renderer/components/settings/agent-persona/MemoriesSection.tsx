import { Badge, Button, Flex, Loader, Text } from '@mantine/core'
import type { LocalMemoryCandidate } from '@shared/agent-persona/memory-import'
import type { MemoryEntry } from '@shared/types/agent-persona'
import { MEMORY_MAX_ENTRIES } from '@shared/types/agent-persona'
import { IconRefresh } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsListItem, SettingsSection } from '@/components/settings/SettingsLayout'
import platform from '@/platform'
import {
  deleteMemory,
  hasCompletedLocalMemoryAutoScan,
  importMemories,
  listMemories,
  markLocalMemoryAutoScanCompleted,
} from '@/stores/agentPersonaStore'
import { add as addToast } from '@/stores/toastActions'
import { MemoryEntryItem } from './MemoryEntryItem'
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
    <>
      <SettingsSection
        title={t('Memories')}
        description={
          platform.scanLocalAgentMemories
            ? `${t(
                'Facts saved from your conversations. They are loaded into new conversations; deleting one only affects future ones.'
              )} ${t(
                'Local Claude and Codex memories are scanned automatically only once; use the scan button to check for new ones. Nothing is imported until you review and confirm it.'
              )}`
            : t(
                'Facts saved from your conversations. They are loaded into new conversations; deleting one only affects future ones.'
              )
        }
        action={
          <Flex align="center" gap="xs">
            <Badge size="sm" variant="light" color="chatbox-secondary">
              {memories.length}/{MEMORY_MAX_ENTRIES}
            </Badge>
            {platform.scanLocalAgentMemories && (
              <Button
                size="compact-sm"
                variant="subtle"
                color="chatbox-gray"
                leftSection={<IconRefresh size={14} />}
                loading={scanning}
                onClick={() => void handleRescan()}
              >
                {t('Scan again')}
              </Button>
            )}
          </Flex>
        }
      >
        {(loading || scanning) && (
          <SettingsListItem>
            <Loader size="xs" />
            {scanning && (
              <Text fz={14} c="chatbox-tertiary">
                {t('Scanning local memories…')}
              </Text>
            )}
          </SettingsListItem>
        )}
        {!scanning && candidates.length > 0 && (
          <SettingsListItem tint="brand">
            <Text fz={14} flex={1}>
              {t('Found {{count}} new local memories.', { count: candidates.length })}
            </Text>
            <Button size="compact-sm" variant="light" onClick={() => setReviewOpened(true)}>
              {t('Review')}
            </Button>
          </SettingsListItem>
        )}
        {!scanning && scanComplete && candidates.length === 0 && (
          <SettingsListItem>
            <Text fz={14} c="chatbox-tertiary">
              {t('No new local memories were found.')}
            </Text>
          </SettingsListItem>
        )}
        {!loading && memories.length === 0 && (
          <SettingsListItem>
            <Text fz={14} c="chatbox-tertiary">
              {t('No memories yet. The agent saves durable facts here as you work together.')}
            </Text>
          </SettingsListItem>
        )}
        {memories.map((entry) => (
          <MemoryEntryItem key={entry.id} entry={entry} onDelete={() => void handleDelete(entry.id)} />
        ))}
      </SettingsSection>
      <MemoryImportReviewModal
        opened={reviewOpened}
        candidates={candidates}
        selectedIds={selectedCandidateIds}
        importing={importing}
        onClose={() => setReviewOpened(false)}
        onSelectedIdsChange={setSelectedCandidateIds}
        onImport={() => void handleImport()}
      />
    </>
  )
}
