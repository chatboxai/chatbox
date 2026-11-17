import { Button, Loader, Stack, Text } from '@mantine/core'
import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererBackupService } from '@/app/renderer-backup'
import { useBackupNavigationGuard } from '@/hooks/useBackupNavigationGuard'
import platform from '@/platform'
import { BackupDialog } from './BackupDialog'

export function BackupTaskOverlay() {
  const { t } = useTranslation()
  const state = useSyncExternalStore(
    rendererBackupService.subscribe,
    rendererBackupService.getSnapshot,
    rendererBackupService.getSnapshot
  )
  const confirmLeave = useBackupNavigationGuard(rendererBackupService)
  useEffect(
    () =>
      platform.onTaskCloseRequest?.(() => {
        void confirmLeave().then((confirmed) => platform.finishTaskClose?.(confirmed))
      }),
    [confirmLeave]
  )
  if (!state) return null
  const phases = {
    preparing: t('Preparing backup operation...'),
    records: t('Processing conversations...'),
    resources: t('Processing resources...'),
    validating: t('Validating backup...'),
    publishing: t('Restoring data...'),
    cleaning: t('Cleaning up...'),
    complete: t('Finishing...'),
  }
  return (
    <BackupDialog
      opened
      onClose={() => rendererBackupService.cancel()}
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      status
      title={state.operation === 'export' ? t('Export Data') : t('Import Backup')}
      footer={
        <Button variant="default" disabled={state.cancelling} onClick={() => rendererBackupService.cancel()}>
          {t('Cancel')}
        </Button>
      }
    >
      <Stack gap="md" align="center" aria-live="polite">
        <Loader size="lg" />
        <Text size="sm">{state.cancelling ? t('Cancelling...') : phases[state.progress.phase]}</Text>
        <Text size="sm" c="dimmed">
          {t('{{messages}} messages · {{resources}} resources · {{bytes}} MB processed', {
            messages: state.progress.messages,
            resources: state.progress.resources,
            bytes: (state.progress.bytes / 1024 / 1024).toFixed(1),
          })}
        </Text>
      </Stack>
    </BackupDialog>
  )
}
