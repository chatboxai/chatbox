import { Button } from '@mantine/core'
import { IconChevronRight } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { BackupRestoreSections, DataRecoveryRow, useBackupOperationActive } from '@/components/settings/DataSections'
import { SettingRow, SettingsPage, SettingsSection } from '@/components/settings/SettingsLayout'

export const Route = createFileRoute('/settings/data')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const backupActive = useBackupOperationActive()

  return (
    <SettingsPage title={t('Data & Backup')} description={t('Back up, restore and recover your conversations.')}>
      <SettingsSection title={t('Conversations')}>
        <SettingRow
          id="archived-chats"
          label={t('Archived Chats')}
          control={
            <Button
              component={Link}
              to="/settings/archive"
              variant="subtle"
              color="chatbox-gray"
              size="compact-sm"
              disabled={backupActive}
              rightSection={<ScalableIcon icon={IconChevronRight} size={16} />}
            >
              {t('View')}
            </Button>
          }
        />
        <DataRecoveryRow disabled={backupActive} />
      </SettingsSection>
      <BackupRestoreSections />
    </SettingsPage>
  )
}
