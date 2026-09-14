import type { BackupProgress } from '@chatbox/core/backup'
import { Progress, Stack, Text } from '@mantine/core'
import { formatFileSize } from '@shared/utils'
import { useTranslation } from 'react-i18next'

export function BackupProgressView({
  progress,
  cancelling = false,
  returning = false,
  waiting = false,
}: {
  progress: BackupProgress | null
  cancelling?: boolean
  returning?: boolean
  waiting?: boolean
}) {
  const { t } = useTranslation()
  const stages = {
    preparing: t('Checking backup contents'),
    sessions: t('Exporting conversations'),
    resources: t('Exporting attachments'),
    packing: t('Finishing backup'),
    reading: t('Reading backup'),
    validating: t('Validating backup'),
    restoring: t('Restoring data'),
    finishing: t('Finishing up'),
  }
  const interrupted = cancelling || returning || waiting
  const title = cancelling
    ? t('Canceling and cleaning up. Keep Chatbox open.')
    : returning
      ? t('Finishing cleanup before returning to your selection...')
      : waiting
        ? t('Waiting for current replies and pending changes to finish...')
        : progress
          ? stages[progress.phase]
          : t('Preparing backup')
  const measurable =
    !interrupted && progress && progress.total > 0 && !['packing', 'finishing'].includes(progress.phase)
  return (
    <Stack gap="xs" w="100%" aria-live="polite">
      <Text size="sm">{title}</Text>
      {measurable && (
        <>
          <Progress value={Math.min(100, Math.max(0, (progress.current / progress.total) * 100))} aria-label={title} />
          <Text size="xs" c="dimmed">
            {progress.phase === 'reading'
              ? `${formatFileSize(progress.current)} / ${formatFileSize(progress.total)}`
              : t('{{current}} / {{total}} completed in this step', {
                  current: progress.current,
                  total: progress.total,
                })}
          </Text>
        </>
      )}
      {!interrupted && progress?.label && (
        <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
          {progress.label}
        </Text>
      )}
      {!interrupted && progress?.processedBytes !== undefined && (
        <Text size="xs" c="dimmed">
          {t('{{size}} processed (uncompressed)', { size: formatFileSize(progress.processedBytes) })}
        </Text>
      )}
    </Stack>
  )
}
