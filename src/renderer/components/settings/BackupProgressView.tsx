import type { TaskProgress } from '@chatbox/core/utils/progress'
import { Progress, Stack, Text } from '@mantine/core'
import { formatFileSize } from '@shared/utils'
import { useTranslation } from 'react-i18next'

export function BackupProgressView({
  progress,
  title,
  unit = 'count',
}: {
  progress: TaskProgress | null
  title: string
  unit?: 'count' | 'bytes'
}) {
  const { t } = useTranslation()
  const total = progress?.total
  return (
    <Stack gap="xs" w="100%" aria-live="polite">
      <Text size="sm">{title}</Text>
      {progress && total !== undefined && total > 0 && (
        <>
          <Progress value={Math.min(100, Math.max(0, (progress.current / total) * 100))} aria-label={title} />
          <Text size="xs" c="dimmed">
            {unit === 'bytes'
              ? `${formatFileSize(progress.current)} / ${formatFileSize(total)}`
              : t('{{current}} / {{total}} completed in this step', { current: progress.current, total })}
          </Text>
        </>
      )}
      {progress?.label && (
        <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
          {progress.label}
        </Text>
      )}
      {progress?.processedBytes !== undefined && (
        <Text size="xs" c="dimmed">
          {t('{{size}} processed (uncompressed)', { size: formatFileSize(progress.processedBytes) })}
        </Text>
      )}
    </Stack>
  )
}
