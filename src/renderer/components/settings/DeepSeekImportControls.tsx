import { type DeepSeekImportResult, inspectDeepSeekArchive } from '@chatbox/core/importers/deepseek'
import { isAbortError } from '@chatbox/core/utils/abort'
import { getDeepSeekImportIssueMessage } from '@chatbox/i18n/backup-import-issues'
import { Alert, Button, FileButton, Loader, Stack, Text, TextInput } from '@mantine/core'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererBackupService } from '@/app/renderer-backup'
import { switchCurrentSession } from '@/stores/session/crud'
import { BackupDialog } from './BackupDialog'
import { SettingRow, SettingsSection } from './SettingsLayout'

export function DeepSeekImportControls() {
  const { t } = useTranslation()
  const [opened, setOpened] = useState(false)
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<{ file: File; count: number }>()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<DeepSeekImportResult>()
  const inspection = useRef<AbortController | null>(null)
  const task = useSyncExternalStore(
    rendererBackupService.subscribe,
    rendererBackupService.getSnapshot,
    rendererBackupService.getSnapshot
  )
  useEffect(() => () => inspection.current?.abort(), [])
  const close = () => {
    inspection.current?.abort()
    setOpened(false)
    setUrl('')
    setPreview(undefined)
    setError(undefined)
    setResult(undefined)
  }
  const select = async (file: File | null) => {
    if (!file) return
    inspection.current?.abort()
    const controller = new AbortController()
    inspection.current = controller
    setReading(true)
    setError(undefined)
    setPreview(undefined)
    try {
      const count = await inspectDeepSeekArchive(file, controller.signal)
      if (!controller.signal.aborted) setPreview({ file, count })
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(t('Import failed')))
    } finally {
      if (inspection.current === controller) setReading(false)
    }
  }
  const start = async (input: File | string) => {
    setOpened(false)
    setError(undefined)
    setResult(undefined)
    setUrl('')
    try {
      setResult(await rendererBackupService.importDeepSeek(input, t('Reply did not complete.')))
    } catch (failure) {
      if (!isAbortError(failure))
        setError(
          String(
            typeof input === 'string'
              ? t('Could not download the archive. Check the link or select a ZIP file.')
              : failure instanceof Error
                ? failure.message
                : t('Import failed')
          )
        )
    } finally {
      setOpened(true)
    }
  }
  return (
    <>
      <SettingsSection title={t('Import conversations')}>
        <SettingRow
          label={t('DeepSeek')}
          description={t('Import a DeepSeek ZIP file or paste its download link.')}
          control={
            <Button variant="default" size="xs" disabled={Boolean(task)} onClick={() => setOpened(true)}>
              {t('Import from DeepSeek')}
            </Button>
          }
        />
      </SettingsSection>
      <BackupDialog
        opened={opened}
        onClose={close}
        title={t('Import from DeepSeek')}
        footer={
          <Button variant="default" onClick={close}>
            {result ? t('Done') : t('Cancel')}
          </Button>
        }
      >
        <Stack gap="md">
          {error || result?.error ? <Alert color="chatbox-error">{error || result?.error}</Alert> : null}
          {result ? (
            <>
              <Text>
                {result.cancelled
                  ? t('Import stopped. Completed conversations have been kept.')
                  : t('Import completed')}
              </Text>
              {result.refreshPending ? (
                <Alert color="chatbox-warning">{t('Restart Chatbox to refresh the imported data.')}</Alert>
              ) : null}
              {result.cleanupPending ? (
                <Text size="sm" c="dimmed">
                  {t('Some temporary files could not be removed. Chatbox will try again on the next start.')}
                </Text>
              ) : null}
              <Text>
                {t('Imported {{sessions}} conversations and {{messages}} messages.', {
                  sessions: result.importedSessions,
                  messages: result.importedMessages,
                })}
              </Text>
              <Text>{t('Skipped {{count}} conversations.', { count: result.skippedSessions })}</Text>
              {result.issueCount > 0 ? (
                <details>
                  <summary>
                    {t('Show import details')} ({result.issueCount})
                  </summary>
                  <Stack gap="xs" mt="xs">
                    {result.issues.map((issue, index) => (
                      <Text size="sm" style={{ overflowWrap: 'anywhere' }} key={`${index}-${issue.code}`}>
                        {issue.session ? `${issue.session}: ` : ''}
                        {getDeepSeekImportIssueMessage(issue, t)}
                        {issue.code === 'missing-attachment' && issue.detail ? ` — ${issue.detail}` : ''}
                      </Text>
                    ))}
                  </Stack>
                </details>
              ) : null}
              {result.firstSessionId ? (
                <Button
                  onClick={() => {
                    const id = result.firstSessionId
                    if (id) {
                      close()
                      switchCurrentSession(id)
                    }
                  }}
                >
                  {t('Open imported conversation')}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Text size="sm">{t('Conversations are added to your list. Importing again creates new copies.')}</Text>
              <FileButton accept=".zip,application/zip,application/octet-stream" onChange={(file) => void select(file)}>
                {(props) => (
                  <Button {...props} variant="default" disabled={reading}>
                    {t('Select ZIP file')}
                  </Button>
                )}
              </FileButton>
              {reading ? <Loader size="sm" /> : null}
              {preview ? (
                <>
                  <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                    {preview.file.name} · {t('Found {{count}} conversations.', { count: preview.count })}
                  </Text>
                  <Button onClick={() => void start(preview.file)}>{t('Start import')}</Button>
                </>
              ) : null}
              <TextInput
                label={t('Download link')}
                type="url"
                autoComplete="off"
                value={url}
                placeholder="https://…"
                onChange={(event) => setUrl(event.currentTarget.value)}
                disabled={reading}
              />
              <Button disabled={!url.trim() || reading} onClick={() => void start(url.trim())}>
                {t('Download and import')}
              </Button>
            </>
          )}
        </Stack>
      </BackupDialog>
    </>
  )
}
