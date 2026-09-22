import {
  type BackupExportPlan,
  createBackupProgressReporter,
  getBackupFilename,
  prepareBackupExport,
  throwIfAborted,
} from '@chatbox/core/backup'
import { useBackupSessionSelection } from '@chatbox/react'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  FileButton,
  Flex,
  Radio,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import {
  getDefaultInterfaceColors,
  INTERFACE_COLOR_PRESETS,
  type InterfaceColorPreset,
  type InterfaceColors,
  type InterfaceThemeColors,
  isInterfaceBrandColorAllowed,
  resolveInterfaceBrandColor,
  resolveInterfaceBrandColors,
  withColorOpacity,
} from '@shared/theme-colors'
import { type Language, Theme } from '@shared/types'
import { formatFileSize } from '@shared/utils'
import {
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconDeviceFloppy,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { runRendererBackupOperation } from '@/app/backup-operations'
import { refreshBackupState } from '@/app/backup-restore-state'
import { exportRendererBackupArchive, importRendererLegacyJsonBackup } from '@/app/persona-backup'
import { rendererApplication, sessionRepository } from '@/app/renderer-application'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { InterfaceColorInput } from '@/components/common/InterfaceColorInput'
import LazySlider from '@/components/common/LazySlider'
import { BackupExportDialog } from '@/components/settings/BackupExportDialog'
import { BackupProgressView } from '@/components/settings/BackupProgressView'
import { BackupWarnings } from '@/components/settings/BackupWarnings'
import { confirmBackupInterruption } from '@/hooks/useBackupNavigationGuard'
import { languageNameMap, languages } from '@/i18n/locales'
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
import { canChangeAppIcon } from '@/platform/app-icon'
import { canShareFile, shareFile } from '@/platform/web_file_share'
import storage from '@/storage'
import { withAgentPersonaLocks } from '@/stores/agentPersonaStore'
import { reloadCopilotState } from '@/stores/copilotStore'
import { migrateOnData } from '@/stores/migration'
import { getMetaStorage } from '@/stores/sessionHelpers'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'

export const Route = createFileRoute('/settings/general')({
  component: RouteComponent,
})

const presetBadgeButtonClassName =
  'transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none'

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

export function RouteComponent() {
  const backupOperation = useSyncExternalStore(
    rendererApplication.backupOperations.subscribe,
    rendererApplication.backupOperations.getSnapshot
  )
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)
  const realTheme = useUIStore((state) => state.realTheme)
  const storedInterfaceColors = (settings.interfaceColors ?? getDefaultInterfaceColors())[realTheme]
  const currentInterfaceColors = {
    ...storedInterfaceColors,
    brand: resolveInterfaceBrandColor(storedInterfaceColors.brand, realTheme),
  }
  const [isCreatingInterfaceColorPreset, setIsCreatingInterfaceColorPreset] = useState(false)
  const [isEditingInterfaceColorPresets, setIsEditingInterfaceColorPresets] = useState(false)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [presetLabel, setPresetLabel] = useState('')

  const updateCurrentInterfaceColors = (updater: (colors: InterfaceThemeColors) => InterfaceThemeColors) => {
    setSettings((draft) => {
      draft.interfaceColors ??= getDefaultInterfaceColors()
      draft.interfaceColors[realTheme] = updater(draft.interfaceColors[realTheme])
    })
  }

  const setInterfaceColor = (key: keyof InterfaceThemeColors, value: string) => {
    updateCurrentInterfaceColors((colors) => ({ ...colors, [key]: value }))
  }

  const resetInterfaceColors = () => {
    updateCurrentInterfaceColors(() => getDefaultInterfaceColors()[realTheme])
  }

  const applyInterfaceColorPreset = (colors: InterfaceColors) => {
    setSettings((draft) => {
      draft.interfaceColors = resolveInterfaceBrandColors(colors)
    })
  }

  const saveInterfaceColorPreset = () => {
    const label = presetLabel.trim()
    if (!label) return

    setSettings((draft) => {
      const currentColors = resolveInterfaceBrandColors(draft.interfaceColors ?? getDefaultInterfaceColors())
      draft.interfaceColorPresets ??= []
      draft.interfaceColorPresets.push({
        id: crypto.randomUUID(),
        label,
        colors: {
          light: { ...currentColors.light },
          dark: { ...currentColors.dark },
        },
      })
    })
    setIsCreatingInterfaceColorPreset(false)
    setPresetLabel('')
  }

  const deleteInterfaceColorPreset = (presetId: string) => {
    setSettings((draft) => {
      draft.interfaceColorPresets = (draft.interfaceColorPresets ?? []).filter((preset) => preset.id !== presetId)
    })
    if (editingPresetId === presetId) cancelEditingInterfaceColorPreset()
  }

  const startEditingInterfaceColorPreset = (preset: InterfaceColorPreset) => {
    applyInterfaceColorPreset(preset.colors)
    setIsCreatingInterfaceColorPreset(false)
    setEditingPresetId(preset.id)
    setPresetLabel(preset.label)
  }

  const cancelEditingInterfaceColorPreset = () => {
    setEditingPresetId(null)
    setPresetLabel('')
  }

  const saveEditedInterfaceColorPreset = () => {
    const label = presetLabel.trim()
    if (!editingPresetId || !label) return

    setSettings((draft) => {
      const colors = resolveInterfaceBrandColors(draft.interfaceColors ?? getDefaultInterfaceColors())
      draft.interfaceColorPresets = (draft.interfaceColorPresets ?? []).map((preset) =>
        preset.id === editingPresetId
          ? {
              ...preset,
              label,
              colors: {
                light: { ...colors.light },
                dark: { ...colors.dark },
              },
            }
          : preset
      )
    })
    cancelEditingInterfaceColorPreset()
  }

  const colorPresets = [
    ...INTERFACE_COLOR_PRESETS.map((preset) => ({
      ...preset,
      colors: resolveInterfaceBrandColors(preset.colors),
      isCustom: false,
    })),
    ...(settings.interfaceColorPresets ?? []).map((preset) => ({
      ...preset,
      colors: resolveInterfaceBrandColors(preset.colors),
      isCustom: true,
    })),
  ] satisfies Array<InterfaceColorPreset & { isCustom: boolean }>

  return (
    <Stack p="md" gap="xl">
      <fieldset
        disabled={backupOperation !== null}
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--mantine-spacing-xl)',
        }}
      >
        <Title order={5}>{t('General Settings')}</Title>

        {/* Display Settings */}
        <Stack gap="lg" maw={720}>
          <Title order={5}>{t('Display Settings')}</Title>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <AdaptiveSelect
              comboboxProps={{ withinPortal: true }}
              value={settings.language}
              data={languages.map((language) => ({
                value: language,
                label: languageNameMap[language],
                // style: language === 'ar' ? { fontFamily: 'Cairo, Arial, sans-serif' } : {},
              }))}
              label={t('Language')}
              styles={{
                label: {
                  fontWeight: 400,
                },
              }}
              onChange={(val) => {
                if (val) {
                  setSettings({
                    language: val as Language,
                  })
                }
              }}
            />
            <AdaptiveSelect
              comboboxProps={{ withinPortal: true, withArrow: true }}
              label={t('Theme')}
              styles={{
                label: {
                  fontWeight: 400,
                },
              }}
              data={[
                { value: `${Theme.System}`, label: t('Follow System') },
                { value: `${Theme.Light}`, label: t('Light Mode') },
                { value: `${Theme.Dark}`, label: t('Dark Mode') },
              ]}
              value={`${settings.theme}`}
              onChange={(val) => {
                if (val) {
                  setSettings({
                    theme: parseInt(val),
                  })
                }
              }}
            />
          </SimpleGrid>
          {canChangeAppIcon() && (
            <Button
              component={Link}
              to="/settings/app-icon"
              variant="default"
              justify="space-between"
              rightSection={<IconChevronRight size={18} />}
              h="auto"
              py="sm"
              fw={400}
            >
              {t('App icon')}
            </Button>
          )}

          <Stack gap="md">
            <Stack gap="xxs">
              <Flex align="center" gap={2}>
                <Text size="sm">{t('Color Presets')}</Text>
                <ActionIcon
                  variant={isEditingInterfaceColorPresets ? 'light' : 'subtle'}
                  size="sm"
                  aria-label={isEditingInterfaceColorPresets ? t('Save') : t('Edit')}
                  disabled={
                    isEditingInterfaceColorPresets &&
                    Boolean(editingPresetId || isCreatingInterfaceColorPreset) &&
                    !presetLabel.trim()
                  }
                  onClick={() => {
                    if (isEditingInterfaceColorPresets) {
                      if (editingPresetId) {
                        saveEditedInterfaceColorPreset()
                      } else if (isCreatingInterfaceColorPreset) {
                        saveInterfaceColorPreset()
                      } else {
                        cancelEditingInterfaceColorPreset()
                      }
                    } else {
                      setIsCreatingInterfaceColorPreset(false)
                    }
                    setIsEditingInterfaceColorPresets((value) => !value)
                  }}
                >
                  {isEditingInterfaceColorPresets ? <IconCheck size={14} /> : <IconPencil size={14} />}
                </ActionIcon>
              </Flex>
              <Flex
                columnGap="xs"
                rowGap={isEditingInterfaceColorPresets ? 12 : 'xs'}
                py={isEditingInterfaceColorPresets ? 5 : 0}
                wrap="wrap"
              >
                {colorPresets.map((preset) => (
                  <Box key={preset.id} pos="relative">
                    <Badge
                      component="button"
                      type="button"
                      className={presetBadgeButtonClassName}
                      variant="filled"
                      style={{
                        backgroundColor: withColorOpacity(preset.colors[realTheme].brand, 0.6),
                        cursor: 'pointer',
                        height: 30,
                        maxWidth: 160,
                      }}
                      onClick={() => {
                        if (isEditingInterfaceColorPresets && preset.isCustom) {
                          startEditingInterfaceColorPreset(preset)
                        } else {
                          applyInterfaceColorPreset(preset.colors)
                        }
                      }}
                    >
                      {preset.isCustom ? preset.label : t(preset.label)}
                    </Badge>
                    {isEditingInterfaceColorPresets && preset.isCustom && (
                      <ActionIcon
                        pos="absolute"
                        top={-5}
                        right={-5}
                        variant="filled"
                        color="red"
                        size={16}
                        radius="xl"
                        aria-label={t('Delete')}
                        onClick={() => deleteInterfaceColorPreset(preset.id)}
                      >
                        <IconTrash size={10} />
                      </ActionIcon>
                    )}
                  </Box>
                ))}
                {!isCreatingInterfaceColorPreset && (
                  <Badge
                    component="button"
                    type="button"
                    className={presetBadgeButtonClassName}
                    circle
                    variant="outline"
                    aria-label={t('New Preset')}
                    style={{ cursor: 'pointer', height: 30, width: 30 }}
                    styles={{ label: { display: 'flex', width: '100%', justifyContent: 'center' } }}
                    onClick={() => {
                      cancelEditingInterfaceColorPreset()
                      setPresetLabel(`Custom Preset ${(settings.interfaceColorPresets?.length ?? 0) + 1}`)
                      setIsCreatingInterfaceColorPreset(true)
                    }}
                  >
                    <IconPlus size={14} />
                  </Badge>
                )}
              </Flex>
            </Stack>
            {(isCreatingInterfaceColorPreset || editingPresetId) && (
              <Stack gap="md">
                <TextInput
                  autoFocus
                  label={t('Name')}
                  value={presetLabel}
                  onChange={(event) => setPresetLabel(event.currentTarget.value)}
                />
                <SimpleGrid cols={2} spacing="md">
                  <Stack gap="md">
                    <InterfaceColorInput
                      label={t('Primary Background')}
                      value={currentInterfaceColors.backgroundPrimary}
                      onCommit={(value) => setInterfaceColor('backgroundPrimary', value)}
                    />
                    <InterfaceColorInput
                      label={t('Secondary Background')}
                      value={currentInterfaceColors.backgroundSecondary}
                      onCommit={(value) => setInterfaceColor('backgroundSecondary', value)}
                    />
                  </Stack>
                  <Stack gap="md">
                    <InterfaceColorInput
                      label={t('Tertiary Background')}
                      value={currentInterfaceColors.backgroundTertiary}
                      onCommit={(value) => setInterfaceColor('backgroundTertiary', value)}
                    />
                    <InterfaceColorInput
                      label={t('Brand Color')}
                      value={currentInterfaceColors.brand}
                      isColorAllowed={isInterfaceBrandColorAllowed}
                      onCommit={(value) => setInterfaceColor('brand', value)}
                    />
                  </Stack>
                </SimpleGrid>
                <SimpleGrid cols={2} spacing="md">
                  <Button variant="outline" onClick={resetInterfaceColors}>
                    {t('Reset Colors')}
                  </Button>
                  <Button
                    leftSection={<IconDeviceFloppy size={14} />}
                    disabled={!presetLabel.trim()}
                    onClick={editingPresetId ? saveEditedInterfaceColorPreset : saveInterfaceColorPreset}
                  >
                    {editingPresetId ? t('Save') : t('Save Preset')}
                  </Button>
                </SimpleGrid>
              </Stack>
            )}
          </Stack>

          {/* Font Size */}
          <Stack>
            <Text>{t('Font Size')}</Text>
            <LazySlider
              step={1}
              min={10}
              max={22}
              maw={720}
              marks={[
                {
                  value: 14,
                },
              ]}
              value={settings.fontSize}
              onChange={(val) =>
                setSettings({
                  fontSize: val,
                })
              }
            />
          </Stack>

          {/* Startup Page */}
          <Stack>
            <Text>{t('Startup Page')}</Text>
            <Radio.Group
              value={settings.startupPage}
              defaultValue="home"
              onChange={(val) => {
                if (val === 'home' || val === 'session') setSettings({ startupPage: val })
              }}
            >
              <Flex gap="md">
                <Radio label={t('Home Page')} value="home" />
                <Radio label={t('Last Session')} value="session" />
              </Flex>
            </Radio.Group>
          </Stack>
        </Stack>

        <Divider />

        {/* Network Proxy */}
        <Stack gap="xs">
          <Title order={5}>{t('Network Proxy')}</Title>
          <TextInput
            maw={320}
            placeholder="socks5://127.0.0.1:6153"
            value={settings.proxy}
            onChange={(e) =>
              setSettings({
                proxy: e.currentTarget.value,
              })
            }
          />
        </Stack>

        <Divider />

        {/* Data Recovery */}
        <DataRecoverySection />

        <Divider />
      </fieldset>

      {/* import and export data */}
      <ImportExportDataSection />

      <Divider />

      <fieldset
        disabled={backupOperation !== null}
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--mantine-spacing-xl)',
        }}
      >
        {/* Export Logs */}
        <ExportLogsSection />

        <Divider />

        {/* Error Reporting */}
        <Stack gap="md">
          <Stack gap="xxs">
            <Title order={5}>{t('Error Reporting')}</Title>
            <Text c="chatbox-tertiary">
              {t(
                'Chatbox respects your privacy and only uploads anonymous error data and events when necessary. You can change your preferences at any time in the settings.'
              )}
            </Text>
          </Stack>

          <Checkbox
            label={t('Enable optional anonymous reporting of crash and event data')}
            checked={settings.allowReportingAndTracking}
            onChange={(e) => setSettings({ allowReportingAndTracking: e.target.checked })}
          />
        </Stack>

        {/* others */}
        {platform.type === 'desktop' && (
          <>
            <Divider />

            <Stack gap="xl">
              <Switch
                label={t('Launch at system startup')}
                checked={settings.autoLaunch}
                onChange={(e) =>
                  setSettings({
                    autoLaunch: e.currentTarget.checked,
                  })
                }
              />
              <Switch
                label={t('Automatic updates')}
                checked={settings.autoUpdate}
                onChange={(e) =>
                  setSettings({
                    autoUpdate: e.currentTarget.checked,
                  })
                }
              />
              <Switch
                label={t('Beta updates')}
                checked={settings.betaUpdate}
                onChange={(e) =>
                  setSettings({
                    betaUpdate: e.currentTarget.checked,
                  })
                }
              />
            </Stack>
          </>
        )}
      </fieldset>
    </Stack>
  )
}

const DataRecoverySection = () => {
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
    <Stack gap="md">
      <Stack gap="xxs">
        <Title order={5}>{t('Data Recovery')}</Title>
        <Text c="chatbox-tertiary">
          {t('If conversations are missing from the list, use this feature to scan and recover them from storage')}
        </Text>
      </Stack>
      <Button className="self-start" onClick={handleRecover} disabled={isRecovering} loading={isRecovering}>
        {isRecovering ? t('Recovering...') : t('Recover Conversation List')}
      </Button>
      {recoveryResult && (
        <Alert
          className="self-start"
          variant="light"
          color={recoveryResult.success ? (hasPartialFailure ? 'yellow' : 'green') : 'red'}
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
                <Text size="sm" c="orange">
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
      )}
    </Stack>
  )
}

const ImportExportDataSection = () => {
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

  return (
    <>
      <Stack gap="md">
        <Title order={5} onDoubleClick={() => setShowStorageInfo(true)}>
          {t('Data Backup')}
        </Title>
        {showStorageInfo && (
          <Text size="xs" c="chatbox-tertiary">
            {storageInfo}
          </Text>
        )}
        <Button
          className="self-start"
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
              {platform.type === 'mobile' && (
                <Text size="xs" c="dimmed">
                  {t(
                    'Keep Chatbox in the foreground and ensure your device has sufficient battery during import or export.'
                  )}
                </Text>
              )}
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
      </Stack>

      <Divider />

      <Stack gap="lg">
        <Stack gap="xxs">
          <Title order={5}>{t('Data Restore')}</Title>
          <Text c="chatbox-tertiary">
            {t('Upon import, changes will take effect immediately and existing data will be overwritten')}
          </Text>
          <Text size="sm" c="chatbox-tertiary">
            {t('During restore, conversations cannot be changed. Leaving settings will interrupt the operation.')}
          </Text>
          {platform.type === 'mobile' && (
            <Text size="sm" c="chatbox-tertiary">
              {t(
                'Keep Chatbox in the foreground and ensure your device has sufficient battery during import or export.'
              )}
            </Text>
          )}
        </Stack>
        {isImporting && <BackupProgressView progress={progress} cancelling={cancelling} waiting={!backupReady} />}
        {importTips && (
          <Alert
            className=" self-start"
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
        <FileButton accept=".zip,.json,application/zip,application/json" onChange={onImport} disabled={isLoading}>
          {(props) => (
            <Flex gap="sm">
              <Button {...props} className="self-start" disabled={isLoading} loading={isImporting}>
                {isImporting ? t('Importing...') : t('Import and Restore')}
              </Button>
              {isImporting && (
                <Button variant="light" color="chatbox-gray" disabled={cancelling} onClick={cancelOperation}>
                  {t('Cancel')}
                </Button>
              )}
            </Flex>
          )}
        </FileButton>
      </Stack>
    </>
  )
}

enum ExportDataItem {
  Setting = 'setting',
  Key = 'key',
  Conversations = 'conversations',
  Copilot = 'copilot',
}

const ExportLogsSection = () => {
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
    <Stack gap="md">
      <Stack gap="xxs">
        <Title order={5}>{t('Diagnostic Logs')}</Title>
        <Text c="chatbox-tertiary">
          {t(
            'Export application logs for troubleshooting. These logs may be requested by support to help diagnose issues.'
          )}
        </Text>
      </Stack>
      <Flex gap="md">
        <Button variant="primary" onClick={handleExportLogs} disabled={isExporting} loading={isExporting}>
          {isExporting ? t('Exporting...') : t('Export Logs')}
        </Button>
        {/* <Button variant="subtle" color="red" onClick={handleClearLogs} disabled={isExporting}>
          {t('Clear Logs')}
        </Button> */}
      </Flex>
      {exportResult && !exportResult.success && (
        <Alert className="self-start" variant="light" color="red" title={t('Export failed')} icon={<IconInfoCircle />}>
          <Text size="sm">{exportResult.error || t('Unknown error')}</Text>
        </Alert>
      )}
    </Stack>
  )
}
