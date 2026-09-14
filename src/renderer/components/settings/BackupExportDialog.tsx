import { type BackupExportItem, type BackupExportPlan, updateBackupExportItemSelection } from '@chatbox/core/backup'
import type { BackupSessionSelection } from '@chatbox/react'
import { Button, Checkbox, Group, Loader, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/layout/Overlay'
import platform from '@/platform'
import { BackupWarnings } from './BackupWarnings'
import { BackupConversationSelector } from './BackupConversationSelector'
import classes from './BackupExportDialog.module.css'

export function BackupExportDialog({
  plan,
  onConfirm,
  onBack,
  cancelling,
  returning,
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
  onBack(): void
  cancelling: boolean
  returning: boolean
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
  const [visibleSessions, setVisibleSessions] = useState(100)
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
      {plan && !cancelling && !returning ? (
        <Stack p="lg" gap="md" flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
          <Text fw={600}>{t('Ready to export')}</Text>
          <Text size="sm">{t('{{count}} conversations will be backed up', { count: plan.sessions.length })}</Text>
          <Text size="sm" c="dimmed">
            {plan.formatVersion === 3
              ? t(
                  'This backup includes large conversations and requires a version of Chatbox that supports large backups. Older versions cannot import it.'
                )
              : t('This backup is compatible with Chatbox 1.22 or later.')}
          </Text>
          <Text size="sm" c="dimmed">
            {t('Missing items found while exporting will be listed in the result.')}
          </Text>
          <Text size="sm">
            {[
              items.includes('setting') && t('Settings'),
              items.includes('copilot') && t('My Copilots'),
              items.includes('key') && t('API KEY & License'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <BackupWarnings
            warnings={plan.warnings}
            names={new Map(selection.options.map((option) => [option.id, option.name]))}
          />
          <div style={{ flex: 1, minHeight: 100, overflowY: 'auto' }}>
            {plan.sessions.slice(0, visibleSessions).map((session) => (
              <Group key={session.id} justify="space-between" py={4}>
                <Text size="sm" truncate style={{ flex: 1 }}>
                  {session.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {session.layout === 'sharded'
                    ? t('Large conversation')
                    : `${(session.size / 1024 / 1024).toFixed(1)} MiB`}
                </Text>
              </Group>
            ))}
            {plan.sessions.length > visibleSessions && (
              <Button variant="subtle" size="compact-sm" onClick={() => setVisibleSessions(visibleSessions + 100)}>
                {t('Show more')}
              </Button>
            )}
          </div>
        </Stack>
      ) : exporting ? (
        <div className={classes.status} aria-live="polite">
          <Loader size="lg" />
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
              {t('The next step shows backup compatibility and any issues found.')}
            </Text>
            <Text size="xs" c="dimmed" mt={8}>
              {t(
                'After you continue, conversations cannot be changed until the operation ends. Leaving settings will interrupt the operation.'
              )}
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
        {plan && !cancelling && !returning ? (
          <>
            <Button variant="default" onClick={onBack}>
              {t('Back to selection')}
            </Button>
            <Button onClick={onConfirm}>{t('Start export')}</Button>
          </>
        ) : exporting ? (
          <Button variant="default" disabled={cancelling || returning} onClick={onCancel}>
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
              {t('Next')}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
