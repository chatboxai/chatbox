import {
  type BackupExportPlan,
  createBackupProgressReporter,
  getBackupFilename,
  prepareBackupExport,
  throwIfAborted,
} from '@chatbox/core/backup'
import { useBackupSessionSelection } from '@chatbox/react'
import { Alert, Box, Button, FileButton, Flex, Stack, Text } from '@mantine/core'
import { formatFileSize } from '@shared/utils'
import { IconCircleCheck, IconInfoCircle } from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { runRendererBackupOperation } from '@/app/backup-operations'
import { compactStoreAfterRestore, refreshBackupState } from '@/app/backup-restore-state'
import { exportRendererBackupArchive, importRendererLegacyJsonBackup } from '@/app/persona-backup'
import { rendererApplication, sessionRepository } from '@/app/renderer-application'
import { PopoverConfirm } from '@/components/common/PopoverConfirm'
import { BackupExportDialog } from '@/components/settings/BackupExportDialog'
import { BackupProgressView } from '@/components/settings/BackupProgressView'
import { BackupWarnings } from '@/components/settings/BackupWarnings'
import { SettingRow, SettingsSection } from '@/components/settings/SettingsLayout'
import { confirmBackupInterruption } from '@/hooks/useBackupNavigationGuard'
import {
  type BackupExportItem,
  type BackupProgress,
  type BackupWarning,
  importBackupArchive,
  isAbortError,
  isZipBackupFile,
  rehydrateImportedSession,
} from '@/packages/backup'
import platform from '@/platform'
import { canShareFile, shareFile } from '@/platform/web_file_share'
import storage from '@/storage'
import { withAgentPersonaLocks } from '@/stores/agentPersonaStore'
import { reloadCopilotState } from '@/stores/copilotStore'
import { migrateOnData } from '@/stores/migration'

/** Whether a backup export or restore is running; other data settings stay disabled meanwhile. */
export function useBackupOperationActive() {
  const backupOperation = useSyncExternalStore(
    rendererApplication.backupOperations.subscribe,
    rendererApplication.backupOperations.getSnapshot
  )
  return backupOperation !== null
}

function serializeErrorForLog(error: unknown) {
  if (error instanceof Error || error instanceof DOMException) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return {
    name: typeof error,
    message: String(error),
    stack: undefined,
  }
}

export function DataRecoveryRow({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const [isRecovering, setIsRecovering] = useState(false)
  const [recoveryResult, setRecoveryResult] = useState<{
    success: boolean
    recovered?: number
    failed?: number
    error?: string
  } | null>(null)

  const handleRecover = async () => {
    setIsRecovering(true)
    setRecoveryResult(null)
    try {
      const result = await rendererApplication.sessions.recoverSessionList()
      setRecoveryResult({ success: true, recovered: result.recovered, failed: result.failed })
    } catch (error) {
      console.error('Failed to recover session list:', error)
      setRecoveryResult({ success: false, error: String(error) })
    } finally {
      setIsRecovering(false)
    }
  }

  const hasPartialFailure = recoveryResult?.success && recoveryResult.failed && recoveryResult.failed > 0

  return (
    <SettingRow
      id="recover-sessions"
      label={t('Recover Conversation List')}
      description={t(
        'If conversations are missing from the list, use this feature to scan and recover them from storage'
      )}
      control={
        <Button
          variant="default"
          size="xs"
          onClick={handleRecover}
          disabled={disabled || isRecovering}
          loading={isRecovering}
        >
          {isRecovering ? t('Recovering...') : t('Scan')}
        </Button>
      }
    >
      {recoveryResult && (
        <Box px={16} pb={14}>
          <Alert
            variant="light"
            color={
              recoveryResult.success ? (hasPartialFailure ? 'chatbox-warning' : 'chatbox-success') : 'chatbox-error'
            }
            title={
              recoveryResult.success
                ? t('Recovered {{count}} conversations', { count: recoveryResult.recovered })
                : t('Recovery failed')
            }
            icon={<IconInfoCircle />}
          >
            {recoveryResult.success ? (
              <Stack gap="xs">
                <Text size="sm">{t('The conversation list has been successfully recovered')}</Text>
                {hasPartialFailure && (
                  <Text size="sm" c="chatbox-warning">
                    {t('{{count}} conversations could not be recovered due to data read errors', {
                      count: recoveryResult.failed,
                    })}
                  </Text>
                )}
              </Stack>
            ) : (
              <Text size="sm">{recoveryResult.error || t('Unknown error')}</Text>
            )}
          </Alert>
        </Box>
      )}
    </SettingRow>
  )
}

export function BackupRestoreSections() {
  const { t } = useTranslation()

  const backupOperation = useSyncExternalStore(
    rendererApplication.backupOperations.subscribe,
    rendererApplication.backupOperations.getSnapshot
  )
  const cancelling = backupOperation?.phase === 'cancelling'
  const [returning, setReturning] = useState(false)
  const [backupReady, setBackupReady] = useState(false)
  const [importTips, setImportTips] = useState('')
  const [importWarnings, setImportWarnings] = useState<BackupWarning[]>([])
  const [importNames, setImportNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [importSucceeded, setImportSucceeded] = useState(false)
  const [importRequiresRestart, setImportRequiresRestart] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportPlan, setExportPlan] = useState<BackupExportPlan>()
  const confirmExport = useRef<((proceed: boolean) => void) | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [exportNotice, setExportNotice] = useState<{
    color: 'green' | 'yellow' | 'red'
    title: string
    body?: string
    preservedSessions?: { id: string; meta: { name: string }; legacyTopology?: string }[]
    warnings?: BackupWarning[]
  }>()
  const [pendingDownload, setPendingDownload] = useState<{ filename: string; blob: Blob }>()
  const [pendingDownloadUrl, setPendingDownloadUrl] = useState<string>()
  const [exportItems, setExportItems] = useState<BackupExportItem[]>([
    ExportDataItem.Setting,
    ExportDataItem.Conversations,
    ExportDataItem.Copilot,
  ])

  const selection = useBackupSessionSelection(
    sessionRepository,
    exportDialogOpen && exportItems.includes(ExportDataItem.Conversations)
  )
  const selectionNames = useMemo(
    () => new Map(selection.options.map((option) => [option.id, option.name])),
    [selection.options]
  )
  const selectionBlocked =
    exportItems.includes(ExportDataItem.Conversations) && (selection.isLoading || !!selection.error)
  const isLoading = isExporting || isImporting || importRequiresRestart
  const pendingDownloadFile = useMemo(
    () =>
      pendingDownload
        ? new File([pendingDownload.blob], pendingDownload.filename, {
            type: pendingDownload.blob.type,
          })
        : undefined,
    [pendingDownload]
  )
  const canSharePendingDownload = useMemo(() => {
    return pendingDownloadFile ? canShareFile(pendingDownloadFile) : false
  }, [pendingDownloadFile])

  useEffect(() => {
    if (!pendingDownload) {
      setPendingDownloadUrl(undefined)
      return
    }

    const url = URL.createObjectURL(pendingDownload.blob)
    setPendingDownloadUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingDownload])

  const onSharePendingDownload = async () => {
    if (!pendingDownloadFile || !canSharePendingDownload) return
    try {
      await shareFile(pendingDownloadFile)
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Failed to share backup:', error)
    }
  }

  const onExport = async () => {
    if (isLoading || selectionBlocked) return

    setIsExporting(true)
    setReturning(false)
    setBackupReady(false)
    setProgress(null)
    setExportNotice(undefined)
    setPendingDownload(undefined)
    const onProgress = createBackupProgressReporter(setProgress)
    try {
      const date = new Date()
      const result = await runRendererBackupOperation('export', (signal) =>
        rendererApplication.sessionWrites.withBackupAccess(() =>
          sessionRepository.withBackupStorageAccess(async (readSession, metaStorage, sessionStore) => {
            setBackupReady(true)
            const options = {
              exportItems,
              selectedSessionIds: selection.exportSessionIds,
              listSessionIds: () => sessionRepository.getAllSessionIds(),
              includeKeys: exportItems.includes(ExportDataItem.Key),
              exportedAt: date,
              storage,
              metaStorage,
              readSession,
              sessionStore,
              application: { version: platform.getVersion(), platform: platform.getPlatform() },
              signal,
              onProgress,
            }
            const prepared = sessionStore ? await prepareBackupExport({ ...options, sessionStore }) : undefined
            if (prepared) {
              throwIfAborted(signal)
              setExportPlan(prepared)
              const proceed = await new Promise<boolean>((resolve, reject) => {
                const abort = () => {
                  confirmExport.current = null
                  reject(signal.reason ?? new DOMException('Export canceled', 'AbortError'))
                }
                signal.addEventListener('abort', abort, { once: true })
                confirmExport.current = (proceed) => {
                  signal.removeEventListener('abort', abort)
                  confirmExport.current = null
                  resolve(proceed)
                }
                if (signal.aborted) abort()
              })
              setExportPlan(undefined)
              if (!proceed) return undefined
            }
            return exportRendererBackupArchive({
              ...options,
              prepared,
              writeArchive: (dataCallback) =>
                platform.exporter.exportStreamingFile(
                  getBackupFilename(date),
                  dataCallback,
                  'application/zip',
                  signal,
                  prepared ? { requiresStreaming: prepared.formatVersion === 3 } : undefined
                ),
            })
          }, signal)
        )
      )
      if (!result) return
      const preservedSessions = result.manifest.sessions.filter((session) => session.legacyTopology)
      const warningCount = result.manifest.warnings.length + preservedSessions.length
      setPendingDownload(result.pendingDownload)
      const warningBody = [
        String(t('{{count}} conversations backed up', { count: result.manifest.sessions.length })),
        result.delivery === 'share-sheet'
          ? String(t('The share sheet has closed. Check that you saved a copy of your backup.'))
          : '',
        result.pendingDownload
          ? String(t('Your backup is ready. Download it to save a copy.'))
          : !result.boundedMemory
            ? String(t('Check that your backup appears in your downloads.'))
            : '',
      ]
        .filter(Boolean)
        .join('\n')
      const notice = result.pendingDownload
        ? {
            color: warningCount ? ('yellow' as const) : ('green' as const),
            title: String(t('Backup ready to download')),
          }
        : result.delivery === 'share-sheet'
          ? { color: 'yellow' as const, title: String(t('Backup sharing finished')) }
          : warningCount > 0 || !result.boundedMemory
            ? { color: 'yellow' as const, title: String(t('Backup exported with warnings')) }
            : { color: 'green' as const, title: String(t('Backup exported successfully')) }
      setExportNotice({ ...notice, body: warningBody, warnings: result.manifest.warnings, preservedSessions })
    } catch (error) {
      if (isAbortError(error)) {
        setExportNotice({ color: 'yellow', title: String(t('Export canceled')) })
      } else {
        console.error('Export failed:', serializeErrorForLog(error))
        setExportNotice({ color: 'red', title: String(t('Export failed')), body: String(error) })
      }
    } finally {
      setIsExporting(false)
      setReturning(false)
      setExportPlan(undefined)
      confirmExport.current = null
      setProgress(null)
    }
  }

  const onImport = async (file: File | null) => {
    if (isLoading || !file) return
    setIsImporting(true)
    setImportTips('')
    setImportWarnings([])
    setImportNames(new Map())
    setBackupReady(false)
    setImportSucceeded(false)
    setImportRequiresRestart(false)
    setProgress(null)
    const onProgress = createBackupProgressReporter(setProgress)
    try {
      const shouldRestart = await runRendererBackupOperation('import', async (signal) => {
        setBackupReady(true)
        // Direct-to-storage imports must discard retained session views so
        // subsequent reads use the newly published rows.
        const forgetImportedSessionState = async () => {
          sessionRepository.forgetAllBaselines()
          const sessionIds = await sessionRepository.getAllSessionIds()
          for (const sessionId of sessionIds) {
            rendererApplication.sessionWrites.forget(sessionId)
            rendererApplication.sessionQueryBridge.discardSessionCache(sessionId)
          }
        }
        if (await isZipBackupFile(file)) {
          // Restoring writes agent-soul/agent-memories directly through storage;
          // holding the persona locks queues concurrent save_memory / Soul edits
          // until the import transaction finishes so neither side is clobbered.
          const result = await rendererApplication.sessionWrites.withBackupAccess(() =>
            sessionRepository.withBackupStorageAccess(async (_readSession, metaStorage, sessionStore) => {
              try {
                return await withAgentPersonaLocks(async () =>
                  importBackupArchive(file, {
                    storage,
                    metaStorage,
                    signal,
                    onProgress,
                    rehydrateSession: rehydrateImportedSession,
                    sharded: sessionStore ? { store: sessionStore } : undefined,
                  })
                )
              } finally {
                await forgetImportedSessionState()
              }
            }, signal)
          )
          await compactStoreAfterRestore()
          const requiresRestart = await refreshBackupState(result.manifest)
          if (result.warnings.length > 0) {
            setImportTips(
              String(
                requiresRestart
                  ? t(
                      'Backup restore is almost complete, with {{count}} warning(s). Select Continue to restart Chatbox and finish restoring.',
                      { count: result.warnings.length }
                    )
                  : t('Backup restored with {{count}} warning(s).', { count: result.warnings.length })
              )
            )
            setImportWarnings(result.warnings)
            setImportNames(new Map(result.manifest.sessions.map((session) => [session.id, session.meta.name])))
            setImportRequiresRestart(requiresRestart)
            return false
          }
          if (!requiresRestart) {
            setImportSucceeded(true)
            setImportTips(String(t('Backup restored successfully')))
          }
          return requiresRestart
        } else {
          await rendererApplication.sessionWrites.withBackupAccess(() =>
            sessionRepository.withBackupStorageAccess(async (_readSession, metaStorage) => {
              try {
                await importRendererLegacyJsonBackup(file, {
                  storage,
                  metaStorage,
                  signal,
                  migrateData: (dataStore) => migrateOnData(dataStore, false),
                  recoverSessionList: async () => {},
                })
              } finally {
                await forgetImportedSessionState()
              }
            }, signal)
          )
          await compactStoreAfterRestore()
          await rendererApplication.settings.reloadFromStorage()
          await reloadCopilotState()
          await storage.flushPendingWrites()
          await rendererApplication.queryClient.resetQueries()
        }
        return true
      })
      if (shouldRestart) await platform.relaunch()
    } catch (error) {
      setImportSucceeded(false)
      if (isAbortError(error)) setImportTips(String(t('Import canceled')))
      else {
        console.error('Import failed:', error)
        setImportTips(
          String(
            t('Import failed: {{error}}', {
              error: error instanceof Error ? error.message : t('Unsupported or damaged backup'),
            })
          )
        )
      }
    } finally {
      setIsImporting(false)
      selection.refresh()
      setProgress(null)
    }
  }

  const cancelOperation = () => {
    void rendererApplication.backupOperations.cancelAndWait().catch(() => {})
  }

  const [showStorageInfo, setShowStorageInfo] = useState(false)
  const [storagePersisted, setStoragePersisted] = useState<boolean>()
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate>()
  const storageInfo = useMemo(
    () =>
      `Storage persisted: ${storagePersisted}; Storage Estimate: { quota: ${formatFileSize(storageEstimate?.quota || 0)}, usage: ${formatFileSize(storageEstimate?.usage || 0)} }`,
    [storagePersisted, storageEstimate]
  )
  useEffect(() => {
    if (window?.navigator?.storage) {
      window.navigator.storage.estimate?.().then((res) => setStorageEstimate(res))
      window.navigator.storage.persisted?.().then((p) => setStoragePersisted(p))
    }
  }, [])

  const importTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileForegroundHint = platform.type === 'mobile' && (
    <Text size="xs" c="chatbox-tertiary">
      {t('Keep Chatbox in the foreground and ensure your device has sufficient battery during import or export.')}
    </Text>
  )

  return (
    <>
      <SettingsSection title={t('Backup')}>
        <SettingRow
          id="export-data"
          label={<span onDoubleClick={() => setShowStorageInfo(true)}>{t('Export Data')}</span>}
          description={t('Save settings, conversations and copilots to a backup file.')}
          control={
            <Button
              size="xs"
              disabled={isLoading}
              onClick={() => {
                setExportNotice(undefined)
                setPendingDownload(undefined)
                selection.setQuery('')
                setExportDialogOpen(true)
              }}
            >
              {t('Export Data')}
            </Button>
          }
        >
          {showStorageInfo && (
            <Text size="xs" c="chatbox-tertiary" px={16} pb={14}>
              {storageInfo}
            </Text>
          )}
        </SettingRow>
        <BackupExportDialog
          opened={exportDialogOpen}
          onClose={() => {
            void (async () => {
              if (!isExporting || (await confirmBackupInterruption())) setExportDialogOpen(false)
            })()
          }}
          selection={selection}
          items={exportItems}
          onItemsChange={setExportItems}
          exporting={isExporting}
          onExport={() => void onExport()}
          plan={exportPlan}
          onConfirm={() => confirmExport.current?.(true)}
          onBack={() => {
            setReturning(true)
            confirmExport.current?.(false)
          }}
          cancelling={cancelling}
          returning={returning}
          onCancel={cancelOperation}
          progress={
            <Stack gap="xs" align="center">
              <BackupProgressView
                progress={progress}
                cancelling={cancelling}
                returning={returning}
                waiting={!backupReady}
              />
              {mobileForegroundHint}
            </Stack>
          }
          result={
            exportNotice && (
              <Stack align="center" gap="md">
                <Box c={exportNotice.color === 'green' ? 'teal' : exportNotice.color === 'red' ? 'red' : 'blue'}>
                  {exportNotice.color === 'green' ? (
                    <IconCircleCheck size={44} stroke={1.5} />
                  ) : (
                    <IconInfoCircle size={44} stroke={1.5} />
                  )}
                </Box>
                <Text fw={600} size="lg">
                  {exportNotice.title}
                </Text>
                <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-line' }}>
                  {exportNotice.body}
                </Text>
                <BackupWarnings
                  warnings={exportNotice.warnings ?? []}
                  names={selectionNames}
                  preservedSessions={exportNotice.preservedSessions}
                />
              </Stack>
            )
          }
          resultActions={
            pendingDownload && pendingDownloadUrl ? (
              <>
                {canSharePendingDownload && <Button onClick={onSharePendingDownload}>{t('Save')}</Button>}
                <Button component="a" href={pendingDownloadUrl} download={pendingDownload.filename}>
                  {t('Download')}
                </Button>
              </>
            ) : undefined
          }
        />
      </SettingsSection>

      <SettingsSection
        title={t('Import Backup')}
        tone="danger"
        description={t(
          'During restore, conversations cannot be changed. Leaving settings will interrupt the operation.'
        )}
      >
        <SettingRow
          id="import-data"
          label={t('Import Backup')}
          description={t(
            'Import takes effect immediately. Conversations, settings, and other data in the backup overwrite matching local records. Data not included in the backup is kept; importing does not clear all local data.'
          )}
          control={
            <Flex gap="xs">
              {isImporting && (
                <Button variant="light" color="chatbox-gray" size="xs" disabled={cancelling} onClick={cancelOperation}>
                  {t('Cancel')}
                </Button>
              )}
              <FileButton accept=".zip,.json,application/zip,application/json" onChange={onImport} disabled={isLoading}>
                {(props) => <button type="button" hidden ref={importTriggerRef} {...props} />}
              </FileButton>
              <PopoverConfirm
                width={360}
                styles={{ dropdown: { maxWidth: 'calc(100vw - 32px)' } }}
                title={String(
                  t(
                    'Importing does not clear all local data. Content in the backup overwrites matching records, while content not included is kept. Continue?'
                  )
                )}
                confirmButtonText={String(t('Choose backup file'))}
                confirmButtonColor="chatbox-error"
                onConfirm={() => importTriggerRef.current?.click()}
              >
                <Button variant="outline" color="chatbox-error" size="xs" disabled={isLoading} loading={isImporting}>
                  {isImporting ? t('Importing...') : t('Import Backup')}
                </Button>
              </PopoverConfirm>
            </Flex>
          }
        >
          {(mobileForegroundHint || isImporting || importTips) && (
            <Stack gap="sm" px={16} pb={14}>
              {mobileForegroundHint}
              {isImporting && <BackupProgressView progress={progress} cancelling={cancelling} waiting={!backupReady} />}
              {importTips && (
                <Alert
                  variant="light"
                  color={importSucceeded ? 'green' : 'yellow'}
                  title={importTips}
                  icon={<IconInfoCircle />}
                >
                  <BackupWarnings warnings={importWarnings} names={importNames} />
                  {importRequiresRestart && (
                    <Button mt="sm" variant="light" onClick={() => platform.relaunch()}>
                      {t('Continue')}
                    </Button>
                  )}
                </Alert>
              )}
            </Stack>
          )}
        </SettingRow>
      </SettingsSection>
    </>
  )
}

enum ExportDataItem {
  Setting = 'setting',
  Key = 'key',
  Conversations = 'conversations',
  Copilot = 'copilot',
}

export function DiagnosticLogsRow() {
  const { t } = useTranslation()
  const [isExporting, setIsExporting] = useState(false)
  const [exportResult, setExportResult] = useState<{
    success: boolean
    error?: string
  } | null>(null)

  const handleExportLogs = async () => {
    setIsExporting(true)
    setExportResult(null)
    try {
      const logs = await platform.exportLogs()
      if (!logs || logs.trim() === '') {
        setExportResult({ success: true })
        return
      }

      const date = new Date()
      const dateStr = dayjs(date).format('YYYY-M-D_H-m')
      await platform.exporter.exportTextFile(`chatbox-logs-${dateStr}.txt`, logs)
      setExportResult({ success: true })
    } catch (error) {
      console.error('Failed to export logs:', error)
      setExportResult({ success: false, error: String(error) })
    } finally {
      setIsExporting(false)
    }
  }

  const _handleClearLogs = async () => {
    try {
      await platform.clearLogs()
      setExportResult({ success: true })
    } catch (error) {
      console.error('Failed to clear logs:', error)
    }
  }

  return (
    <SettingRow
      id="diagnostic-logs"
      label={t('Diagnostic Logs')}
      description={t(
        'Export application logs for troubleshooting. These logs may be requested by support to help diagnose issues.'
      )}
      control={
        <Button variant="default" size="xs" onClick={handleExportLogs} disabled={isExporting} loading={isExporting}>
          {isExporting ? t('Exporting...') : t('Export Logs')}
        </Button>
      }
    >
      {exportResult && !exportResult.success && (
        <Box px={16} pb={14}>
          <Alert variant="light" color="chatbox-error" title={t('Export failed')} icon={<IconInfoCircle />}>
            <Text size="sm">{exportResult.error || t('Unknown error')}</Text>
          </Alert>
        </Box>
      )}
    </SettingRow>
  )
}
