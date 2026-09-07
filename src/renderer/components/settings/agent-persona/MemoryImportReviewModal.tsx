import { Badge, Button, Checkbox, Flex, Paper, ScrollArea, Stack, Text } from '@mantine/core'
import type { LocalMemoryCandidate } from '@shared/agent-persona/memory-import'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'

interface Props {
  candidates: LocalMemoryCandidate[]
  importing: boolean
  opened: boolean
  selectedIds: string[]
  onClose: () => void
  onImport: () => void
  onSelectedIdsChange: (ids: string[]) => void
}

export function MemoryImportReviewModal({
  candidates,
  importing,
  opened,
  selectedIds,
  onClose,
  onImport,
  onSelectedIdsChange,
}: Props) {
  const { t } = useTranslation()
  const allSelected = candidates.length > 0 && selectedIds.length === candidates.length
  const someSelected = selectedIds.length > 0 && !allSelected

  return (
    <AdaptiveModal opened={opened} onClose={onClose} title={t('Review local memories')} centered size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t('Chatbox found these memories in Claude and Codex. Select the ones you want to import.')}
        </Text>
        <Flex align="center" justify="space-between">
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            disabled={importing}
            label={t('Select all')}
            onChange={(event) =>
              onSelectedIdsChange(event.currentTarget.checked ? candidates.map((candidate) => candidate.id) : [])
            }
          />
          <Text size="xs" c="dimmed">
            {t('{{count}} selected', { count: selectedIds.length })}
          </Text>
        </Flex>
        <ScrollArea.Autosize mah={420} type="auto">
          <Stack gap="xs" pr="xs">
            {candidates.map((candidate) => (
              <Paper key={candidate.id} withBorder radius="md" p="sm">
                <Checkbox
                  checked={selectedIds.includes(candidate.id)}
                  disabled={importing}
                  onChange={(event) => {
                    onSelectedIdsChange(
                      event.currentTarget.checked
                        ? [...selectedIds, candidate.id]
                        : selectedIds.filter((id) => id !== candidate.id)
                    )
                  }}
                  label={
                    <Stack gap={4} ml={2}>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {candidate.content}
                      </Text>
                      <Flex gap="xs" align="center" wrap="wrap">
                        <Badge size="xs" variant="light" color="chatbox-secondary">
                          {candidate.source === 'claude' ? 'Claude' : 'Codex'}
                        </Badge>
                        <Text size="xs" c="dimmed" ff="monospace" style={{ wordBreak: 'break-all' }}>
                          {candidate.displayPath}
                        </Text>
                      </Flex>
                    </Stack>
                  }
                />
              </Paper>
            ))}
          </Stack>
        </ScrollArea.Autosize>
        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={onClose} />
          <Button loading={importing} disabled={selectedIds.length === 0} onClick={onImport}>
            {t('Import selected')}
          </Button>
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
}
