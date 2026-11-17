import { Button, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

export interface BackupWarningItem {
  id: string
  label: string
  reason?: string
}

export interface BackupWarningPage {
  summaries: readonly { id: string; label: string }[]
  items: readonly BackupWarningItem[]
  expanded: boolean
  hasMore: boolean
  isLoading?: boolean
  onExpandedChange(expanded: boolean): void
  onLoadMore(): void
}

/** Summaries and the current detail page are prepared by the caller. */
export function BackupWarnings({
  summaries,
  items,
  expanded,
  hasMore,
  isLoading = false,
  onExpandedChange,
  onLoadMore,
}: BackupWarningPage) {
  const { t } = useTranslation()
  if (!summaries.length && !items.length && !hasMore) return null
  return (
    <Stack gap="xs" w="100%" style={{ textAlign: 'left' }}>
      {summaries.map((summary) => (
        <Text key={summary.id} size="sm" c="orange">
          {summary.label}
        </Text>
      ))}
      <Button
        variant="subtle"
        size="compact-sm"
        className="self-start"
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? t('Hide details') : t('View details')}
      </Button>
      {expanded && (
        <Stack gap="md" mah={240} style={{ overflowY: 'auto' }} aria-busy={isLoading}>
          {items.map((item) => (
            <Stack key={item.id} gap={2}>
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                {item.label}
              </Text>
              {item.reason && (
                <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                  {t('Reason: {{reason}}', { reason: item.reason })}
                </Text>
              )}
            </Stack>
          ))}
          {hasMore && (
            <Button variant="subtle" size="compact-sm" loading={isLoading} onClick={onLoadMore}>
              {t('Show more')}
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  )
}
