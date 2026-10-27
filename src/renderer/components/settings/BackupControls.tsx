import { inspectBackup } from '@chatbox/core/backup-import'
import type { BackupExportFormat } from '@chatbox/core/backup-export'
import { type BackupResult, type BackupSelection, getBackupImportPartialResult } from '@chatbox/core/backup-v3'
import { isAbortError } from '@chatbox/core/utils/abort'
import { Box, Button, Checkbox, FileButton, Radio, Stack, Text } from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererBackupService } from '@/app/renderer-backup'
import { type BackupConversationOption, BackupConversationSelector } from './BackupConversationSelector'
import { BackupDialog } from './BackupDialog'
import classes from './BackupDialog.module.css'
import { BackupImportReport } from './BackupImportReport'
import { SettingRow, SettingsSection } from './SettingsLayout'

type Conversation = Omit<BackupConversationOption, 'selected'>

export function BackupControls() {
  const { t } = useTranslation()
  const [exportOpened, setExportOpened] = useState(false)
  const [exportFormat, setExportFormat] = useState<BackupExportFormat>('v3')
  const [legacyOptionsExpanded, setLegacyOptionsExpanded] = useState(false)
  const legacyOptionsId = useId()
  const [selection, setSelection] = useState<BackupSelection>({
    sessions: true,
    settings: true,
    copilots: true,
    credentials: false,
  })
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [listError, setListError] = useState<string>()
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [preview, setPreview] = useState<{
    file: File
    manifest: Awaited<ReturnType<typeof inspectBackup>>
  } | null>(null)
  const [result, setResult] = useState<{
    operation: 'export' | 'import'
    title: string
    message: string
    warningCount?: number
    missingResources?: number
    importReport?: BackupResult['importReport']
    error?: boolean
  } | null>(null)
  const [blocked, setBlocked] = useState<{ operation: 'export' | 'import'; names: string[] } | null>(null)
  const requestEpoch = useRef(0)
  const resetInput = useRef<() => void>(null)
  const conversationsOnly = exportFormat === 'v1'
  const exportSelection: BackupSelection = conversationsOnly
    ? { sessions: true, settings: false, copilots: false, credentials: false }
    : selection

  const load = useCallback(
    async (cursor: number | null, epoch: number) => {
      setIsLoading(true)
      setListError(undefined)
      try {
        const page = await rendererBackupService.listSessions(cursor, query)
        if (requestEpoch.current !== epoch) return
        setConversations((current) => (cursor === null ? page.sessions : [...current, ...page.sessions]))
        setNext(page.next)
        setTotal(page.total)
      } catch (error) {
        if (requestEpoch.current === epoch) setListError(error instanceof Error ? error.message : String(error))
      } finally {
        if (requestEpoch.current === epoch) setIsLoading(false)
      }
    },
    [query]
  )

  useEffect(() => {
    if (!exportOpened || !exportSelection.sessions) return
    const epoch = ++requestEpoch.current
    setConversations([])
    setNext(null)
    setIsLoading(true)
    const timer = setTimeout(() => {
      void load(null, epoch)
    }, 150)
    return () => {
      clearTimeout(timer)
      requestEpoch.current += 1
    }
  }, [exportOpened, exportSelection.sessions, load])

  const showGenerating = (operation: 'export' | 'import', ids: readonly string[]) => {
    setBlocked({ operation, names: [...ids] })
    void rendererBackupService.getConversationNames(ids).then(
      (names) => setBlocked((current) => (current ? { operation, names } : null)),
      () => {}
    )
  }

  const exportBackup = async () => {
    const chosen = {
      ...exportSelection,
      sessionIds: selectedIds === null ? undefined : [...selectedIds],
      ...(selectedIds === null && excludedIds.size ? { excludedSessionIds: [...excludedIds] } : {}),
    }
    const generating = rendererBackupService.getGeneratingSessionIds(chosen)
    if (generating.length) {
      showGenerating('export', generating)
      return
    }
    setExportOpened(false)
    setResult(null)
    try {
      const exported = await rendererBackupService.export(chosen, exportFormat)
      setResult({
        operation: 'export',
        title: t('Backup archive created'),
        warningCount: exported.complete.counts.warning,
        missingResources: exported.missingResources,
        message: exported.cleanupPending
          ? t('The backup is complete. Temporary files will be cleaned up on the next start.')
          : t('The backup file is ready.'),
      })
    } catch (error) {
      if (!isAbortError(error))
        setResult({
          operation: 'export',
          title: t('Export failed'),
          message: error instanceof Error ? error.message : String(error),
          error: true,
        })
    }
  }

  const openImport = async (file: File | null) => {
    if (!file) return
    setIsPreviewing(true)
    setResult(null)
    try {
      const manifest = await inspectBackup(file)
      setPreview({ file, manifest })
    } catch (error) {
      setResult({
        operation: 'import',
        title: t('Import failed'),
        message: error instanceof Error ? error.message : String(error),
        error: true,
      })
    } finally {
      setIsPreviewing(false)
      resetInput.current?.()
    }
  }

  const importBackup = async () => {
    if (!preview) return
    const file = preview.file
    setPreview(null)
    setResult(null)
    try {
      const imported = await rendererBackupService.import(file)
      setResult({
        operation: 'import',
        title: t('Import completed'),
        importReport: imported.importReport,
        warningCount: imported.complete.counts.warning,
        message: [
          imported.importReport?.issueCount
            ? t('Import finished with issues. Review the details below.')
            : t('Your backup has been restored.'),
          imported.refreshPending ? t('Restart Chatbox to refresh the imported data.') : '',
          imported.cleanupPending
            ? t('Some temporary files could not be removed. Chatbox will try again on the next start.')
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      })
    } catch (error) {
      const partial = getBackupImportPartialResult(error)
      if (partial) {
        setResult({
          operation: 'import',
          title: t('Import incomplete. Completed changes have been kept.'),
          message: [
            isAbortError(error) ? t('Import cancelled.') : error instanceof Error ? error.message : String(error),
            partial.cleanupPending
              ? t('Some temporary files could not be removed. Chatbox will try again on the next start.')
              : '',
            partial.refreshPending ? t('Restart Chatbox to refresh the imported data.') : '',
          ]
            .filter(Boolean)
            .join(' '),
          importReport: partial.importReport,
          warningCount: partial.complete.counts.warning,
          error: true,
        })
      } else {
        setResult({
          operation: 'import',
          title: isAbortError(error) ? t('Import incomplete. Completed changes have been kept.') : t('Import failed'),
          message: isAbortError(error)
            ? t('Import cancelled.')
            : error instanceof Error
              ? error.message
              : String(error),
          error: true,
        })
      }
    }
  }

  const selectedCount = selectedIds?.size ?? Math.max(0, total - excludedIds.size)
  const canExport =
    exportSelection.settings || exportSelection.copilots || (exportSelection.sessions && selectedCount > 0)
  return (
    <>
      <SettingsSection title={t('Backup')}>
        <SettingRow
          id="export-data"
          label={t('Export Data')}
          description={t('Save settings, conversations and copilots to a backup file.')}
          control={
            <Button size="xs" onClick={() => setExportOpened(true)}>
              {t('Export Data')}
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title={t('Import Backup')} tone="danger">
        <SettingRow
          id="import-data"
          label={t('Import Backup')}
          description={t(
            'Import takes effect immediately. Conversations, settings, and other data in the backup overwrite matching local records. Data not included in the backup is kept; importing does not clear all local data.'
          )}
          control={
            <FileButton
              onChange={(file) => void openImport(file)}
              accept=".json,.zip,application/json,application/zip,application/octet-stream"
              resetRef={resetInput}
            >
              {(props) => (
                <Button
                  {...props}
                  variant="outline"
                  color="chatbox-error"
                  size="xs"
                  loading={isPreviewing}
                  disabled={isPreviewing}
                  onClick={() => {
                    const generating = rendererBackupService.getGeneratingSessionIds()
                    if (generating.length) showGenerating('import', generating)
                    else props.onClick()
                  }}
                >
                  {t('Import Backup')}
                </Button>
              )}
            </FileButton>
          }
        />
      </SettingsSection>
      <BackupDialog
        opened={blocked !== null}
        onClose={() => setBlocked(null)}
        title={t('Conversations are still generating.')}
        footer={<Button onClick={() => setBlocked(null)}>{t('OK')}</Button>}
      >
        <Stack gap="md">
          <Text size="sm">
            {blocked?.operation === 'export'
              ? t('Finish or stop generation in these conversations before exporting: {{names}}', {
                  names: blocked.names.join(', '),
                })
              : t('Finish or stop generation in these conversations before importing: {{names}}', {
                  names: blocked?.names.join(', '),
                })}
          </Text>
        </Stack>
      </BackupDialog>
      <BackupDialog
        opened={exportOpened && blocked === null}
        onClose={() => setExportOpened(false)}
        title={t('Export Data')}
        footer={
          <>
            <Button variant="default" onClick={() => setExportOpened(false)}>
              {t('Cancel')}
            </Button>
            <Button
              onClick={() => void exportBackup()}
              disabled={!canExport || (exportSelection.sessions && (isLoading || !!listError))}
            >
              {t('Export Data')}
            </Button>
          </>
        }
      >
        <div className={classes.configuration}>
          <Text size="sm" c="dimmed">
            {t('Choose what to include in your backup.')}
          </Text>
          <div className={classes.conversations}>
            <Checkbox
              label={t('Conversations')}
              checked={exportSelection.sessions}
              disabled={conversationsOnly}
              styles={{ label: { fontWeight: 600 } }}
              onChange={(event) => {
                const checked = event.currentTarget.checked
                setSelection((current) => ({ ...current, sessions: checked }))
              }}
            />
            {exportSelection.sessions ? (
              <Stack gap="xs" flex={1} style={{ minHeight: 0 }}>
                <Text size="sm">
                  {t('{{selected}} / {{total}} conversations selected', { selected: selectedCount, total })}
                </Text>
                <BackupConversationSelector
                  options={conversations.map((item) => ({
                    ...item,
                    selected: selectedIds === null ? !excludedIds.has(item.id) : selectedIds.has(item.id),
                  }))}
                  query={query}
                  allSelected={selectedCount === total}
                  isLoading={isLoading}
                  error={listError}
                  hasMore={next !== null}
                  onQueryChange={setQuery}
                  onSelectAll={(all) => {
                    setSelectedIds(all ? null : new Set())
                    setExcludedIds(new Set())
                  }}
                  onToggle={(id) => {
                    if (selectedIds === null) {
                      setExcludedIds((current) => {
                        const next = new Set(current)
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })
                    } else
                      setSelectedIds((current) => {
                        const next = new Set(current ?? [])
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })
                  }}
                  onLoadMore={() => {
                    if (next !== null && !isLoading) void load(next, requestEpoch.current)
                  }}
                  onRetry={() => void load(null, requestEpoch.current)}
                />
              </Stack>
            ) : (
              <Stack flex={1} justify="center" align="center">
                <Text size="sm" c="dimmed">
                  {t('Chat history will not be included.')}
                </Text>
              </Stack>
            )}
          </div>
          <div className={classes.additional}>
            {!conversationsOnly ? (
              <>
                <Text size="xs" c="dimmed" fw={600}>
                  {t('Also include')}
                </Text>
                <div className={classes.options}>
                  <Checkbox
                    label={t('Settings')}
                    checked={selection.settings}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setSelection((current) => ({
                        ...current,
                        settings: checked,
                        credentials: checked && current.credentials,
                      }))
                    }}
                  />
                  <Checkbox
                    label={t('Copilots')}
                    checked={selection.copilots}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setSelection((current) => ({ ...current, copilots: checked }))
                    }}
                  />
                  <Checkbox
                    label={t('Include credentials')}
                    checked={selection.credentials}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setSelection((current) => ({
                        ...current,
                        credentials: checked,
                        settings: checked || current.settings,
                      }))
                    }}
                  />
                </div>
                {selection.credentials ? (
                  <Text size="sm" c="dimmed">
                    {t('This backup includes saved API keys and account credentials. Keep the file private.')}
                  </Text>
                ) : null}
              </>
            ) : null}
            <Stack gap="xs" mt="md">
              <Button
                variant="subtle"
                size="compact-xs"
                c="dimmed"
                w="fit-content"
                px={0}
                aria-label={t('Export for older versions')}
                aria-expanded={legacyOptionsExpanded}
                aria-controls={legacyOptionsId}
                aria-describedby={exportFormat !== 'v3' ? `${legacyOptionsId}-format` : undefined}
                leftSection={legacyOptionsExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                onClick={() => setLegacyOptionsExpanded((expanded) => !expanded)}
              >
                {t('Export for older versions')}
                {exportFormat !== 'v3' ? (
                  <span id={`${legacyOptionsId}-format`}>{` · ${exportFormat.toUpperCase()}`}</span>
                ) : null}
              </Button>
              {legacyOptionsExpanded ? (
                <Stack id={legacyOptionsId} gap="xs">
                  <Radio.Group
                    label={t('Backup format')}
                    value={exportFormat}
                    onChange={(value) => setExportFormat(value === 'v1' || value === 'v2' ? value : 'v3')}
                  >
                    <Stack gap="xs" mt="xs">
                      <Radio value="v3" label={t('Current format (V3)')} />
                      <Radio value="v2" label={t('Older versions (V2)')} />
                      <Radio value="v1" label={t('Conversations only (V1 JSON)')} />
                    </Stack>
                  </Radio.Group>
                  {exportFormat === 'v2' ? (
                    <Text size="sm" c="dimmed">
                      {t(
                        'Use V2 to import this backup into an older Chatbox version. Features depend on what that version supports.'
                      )}
                    </Text>
                  ) : null}
                  {conversationsOnly ? (
                    <Text size="sm" c="dimmed">
                      {t(
                        'V1 includes conversation text, history and branches. Attachments and configuration are not included.'
                      )}
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          </div>
        </div>
      </BackupDialog>
      <BackupDialog
        opened={preview !== null}
        onClose={() => setPreview(null)}
        title={t('Import Backup')}
        footer={
          <>
            <Button variant="default" onClick={() => setPreview(null)}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void importBackup()}>{t('Import Backup')}</Button>
          </>
        }
      >
        {preview ? (
          <Stack gap="md">
            <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
              {preview.file.name}
            </Text>
            <Text size="sm">
              {[
                preview.manifest.selection.sessions ? t('Conversations') : null,
                preview.manifest.selection.settings ? t('Settings') : null,
                preview.manifest.selection.copilots ? t('Copilots') : null,
              ]
                .filter(Boolean)
                .join(', ')}
            </Text>
            <Text size="sm">
              {t(
                'Conversations and resources with matching IDs will be replaced. Included settings and copilots will replace local values.'
              )}
            </Text>
            {(
              preview.manifest.formatVersion === 3
                ? preview.manifest.selection.settings
                : preview.manifest.selection.credentials
            ) ? (
              <Text size="sm">
                {t(
                  'Settings import also replaces saved credentials, including clearing credentials that are absent from the backup.'
                )}
              </Text>
            ) : null}
          </Stack>
        ) : null}
      </BackupDialog>
      <BackupDialog
        opened={result !== null}
        onClose={() => setResult(null)}
        title={result?.operation === 'export' ? t('Export Data') : t('Import Backup')}
        status
        footer={<Button onClick={() => setResult(null)}>{t('Done')}</Button>}
      >
        {result ? (
          <Stack gap="md" align="center" w="100%" role={result.error ? 'alert' : 'status'}>
            <Box
              c={
                result.error
                  ? 'chatbox-error'
                  : result.warningCount || result.missingResources || result.importReport?.issueCount
                    ? 'chatbox-warning'
                    : 'chatbox-success'
              }
            >
              {result.error || result.warningCount || result.missingResources || result.importReport?.issueCount ? (
                <IconInfoCircle size={44} stroke={1.5} />
              ) : (
                <IconCircleCheck size={44} stroke={1.5} />
              )}
            </Box>
            <Text fw={600} size="lg">
              {result.title}
            </Text>
            <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
              {result.message}
            </Text>
            {result.missingResources ? (
              <Text size="sm">
                {t(
                  'Attachments not found on this device were skipped: {{count}}. The rest of the backup is complete.',
                  {
                    count: result.missingResources,
                  }
                )}
              </Text>
            ) : null}
            {result.warningCount ? (
              <Text size="sm">
                {t('{{count}} portability warnings. Local file links and retrieval indexes are not included.', {
                  count: result.warningCount,
                })}
              </Text>
            ) : null}
            {result.importReport ? (
              <Box w="100%" ta="left">
                <BackupImportReport report={result.importReport} />
              </Box>
            ) : null}
          </Stack>
        ) : null}
      </BackupDialog>
    </>
  )
}
