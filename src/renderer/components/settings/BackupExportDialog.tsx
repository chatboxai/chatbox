import { type BackupExportItem, type BackupExportPlan, updateBackupExportItemSelection } from '@chatbox/core/backup'
import type { BackupSessionSelection } from '@chatbox/react'
import { Button, Checkbox, Group, Loader, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/layout/Overlay'
import platform from '@/platform'
import { BackupConversationSelector } from './BackupConversationSelector'
import classes from './BackupExportDialog.module.css'

export function BackupExportDialog({
  plan,
  onConfirm,
  opened,
  onClose,
  selection,
  items,
  onItemsChange,
  exporting,
  onExport,
  onCancel,
  progress,
  result,
  resultActions,
}: {
  plan?: BackupExportPlan
  onConfirm?(): void
  opened: boolean
  onClose(): void
  selection: BackupSessionSelection
  items: BackupExportItem[]
  onItemsChange(items: BackupExportItem[]): void
  exporting: boolean
  onExport(): void
  onCancel(): void
  progress?: ReactNode
  result?: ReactNode
  resultActions?: ReactNode
}) {
  const { t } = useTranslation()
  const narrow = useMediaQuery('(max-width: 600px)')
  const history = items.includes('conversations')
  const blocked = history && (selection.isLoading || !!selection.error)
  const hasData = items.some((item) => item !== 'conversations') || (history && selection.selectedSessionIds.length > 0)
  const update = (item: BackupExportItem, checked: boolean) =>
    onItemsChange(updateBackupExportItemSelection(items, item, checked))
  return (
    <Modal
      closeButtonProps={{ 'aria-label': String(t('Close')) }}
      opened={opened}
      onClose={onClose}
      size={640}
      fullScreen={narrow}
      centered
      title={
        <Text fw={600} size="xl">
          {t('Export Data')}
        </Text>
      }
      classNames={{ content: classes.content, header: classes.header, body: classes.body }}
    >
      {plan ? (
        <Stack p="lg" gap="md" flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
          <Text fw={600}>{t('Ready to export')}</Text>
          <Text size="sm">
            {t('{{count}} selected · {{size}} MiB before compression', {
              count: plan.sessions.length,
              size: (plan.estimatedBytes / 1024 / 1024).toFixed(1),
            })}
          </Text>
          <Text size="sm" c="dimmed">
            {plan.formatVersion === 3
              ? t(
                  'This backup includes large conversations and requires a version of Chatbox that supports large backups. Older versions cannot import it.'
                )
              : t('This backup is compatible with Chatbox 1.22 or later.')}
          </Text>
          {plan.warnings.length > 0 && (
            <Text size="sm" c="orange">
              {t('{{count}} item(s) could not be included. See manifest.json in the backup for details.', {
                count: plan.warnings.length,
              })}
            </Text>
          )}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {plan.sessions.slice(0, 100).map((session) => (
              <Group key={session.id} justify="space-between" py={4}>
                <Text size="sm" truncate style={{ flex: 1 }}>
                  {session.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {(session.size / 1024 / 1024).toFixed(1)} MiB
                  {session.layout === 'sharded' ? ` · ${t('Large conversation')}` : ''}
                </Text>
              </Group>
            ))}
          </div>
        </Stack>
      ) : exporting ? (
        <div className={classes.status} aria-live="polite">
          <Loader size="lg" />
          <Text fw={600}>{t('Exporting...')}</Text>
          {progress}
        </div>
      ) : result ? (
        <div className={classes.status} aria-live="polite">
          {result}
        </div>
      ) : (
        <div className={classes.configuration}>
          <Text size="sm" c="dimmed">
            {t('Choose what to include in your backup.')}
          </Text>
          <div className={classes.conversations}>
            <Group justify="space-between">
              <Checkbox
                label={t('Chat History')}
                checked={history}
                onChange={(event) => update('conversations', event.currentTarget.checked)}
                styles={{ label: { fontWeight: 600 } }}
              />
              {history && !selection.isLoading && (
                <Text size="xs" c="dimmed">
                  {t('{{selected}} / {{total}} conversations selected', {
                    selected: selection.selectedSessionIds.length,
                    total: selection.options.length,
                  })}
                </Text>
              )}
            </Group>
            {history ? (
              <BackupConversationSelector selection={selection} disabled={false} />
            ) : (
              <Stack flex={1} justify="center" align="center">
                <Text size="sm" c="dimmed">
                  {t('Chat history will not be included.')}
                </Text>
              </Stack>
            )}
          </div>
          <div className={classes.additional}>
            <Text size="xs" c="dimmed" fw={600}>
              {t('Also include')}
            </Text>
            <div className={classes.options}>
              {(
                [
                  { id: 'setting', label: t('Settings') },
                  { id: 'copilot', label: t('My Copilots') },
                  { id: 'key', label: t('API KEY & License') },
                ] as const
              ).map(({ id, label }) => (
                <Checkbox
                  key={id}
                  label={label}
                  checked={items.includes(id)}
                  disabled={id === 'setting' && items.includes('key')}
                  onChange={(event) => update(id, event.currentTarget.checked)}
                />
              ))}
            </div>
            <Text size="xs" c="dimmed" mt={12}>
              {t('Backup files exported here can only be imported in Chatbox 1.22 or later.')}
            </Text>
            {platform.type === 'mobile' && (
              <Text size="xs" c="dimmed" mt={8}>
                {t(
                  'Keep Chatbox in the foreground and ensure your device has sufficient battery during import or export.'
                )}
              </Text>
            )}
          </div>
        </div>
      )}
      <div className={classes.footer}>
        {plan ? (
          <>
            <Button variant="default" onClick={onCancel}>
              {t('Cancel')}
            </Button>
            <Button onClick={onConfirm}>{t('Export')}</Button>
          </>
        ) : exporting ? (
          <Button variant="default" onClick={onCancel}>
            {t('Cancel')}
          </Button>
        ) : result ? (
          <>
            <Button variant={resultActions ? 'default' : 'filled'} onClick={onClose}>
              {t('Done')}
            </Button>
            {resultActions}
          </>
        ) : (
          <>
            <Button variant="default" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button disabled={blocked || !hasData} onClick={onExport}>
              {t('Export Selected Data')}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
