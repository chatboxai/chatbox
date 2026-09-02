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
import { getBackupFilename } from '@shared/utils/backup'
import { IconCheck, IconDeviceFloppy, IconInfoCircle, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { InterfaceColorInput } from '@/components/common/InterfaceColorInput'
import LazySlider from '@/components/common/LazySlider'
import { languageNameMap, languages } from '@/i18n/locales'
import {
  type BackupExportItem,
  type BackupProgress,
  type BackupWarning,
  exportBackupArchive,
  importBackupArchive,
  importLegacyJsonBackup,
  isZipBackupFile,
  rehydrateImportedSession,
} from '@/packages/backup'
import platform from '@/platform'
import { canShareFile, shareFile } from '@/platform/web_file_share'
import storage from '@/storage'
import { withAgentPersonaLocks } from '@/stores/agentPersonaStore'
import { rendererApplication } from '@/app/renderer-application'
import { getMetaStorage } from '@/stores/sessionHelpers'
import { migrateOnData } from '@/stores/migration'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'

export const Route = createFileRoute('/settings/general')({
  component: RouteComponent,
})

const presetBadgeButtonClassName =
  'transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none'

export function RouteComponent() {
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

      {/* import and export data */}
      <ImportExportDataSection />

      <Divider />

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

  const formatBackupWarning = (warning: BackupWarning) => {
    switch (warning.code) {
      case 'session-read-failed':
        return t('Conversation data could not be read and was not included.')
      case 'resource-read-failed':
        return t('Managed attachment or image data could not be read and was not included.')
      case 'external-resource-skipped':
        return t('The original external file is not managed by Chatbox and was not included.')
      case 'rag-rebuild-failed':
        return t('The attachment search index could not be restored.')
    }
  }

  const formatBackupProgressPhase = (phase: BackupProgress['phase']) => {
    switch (phase) {
      case 'preparing':
        return t('Preparing backup')
      case 'sessions':
        return t('Exporting conversations')
      case 'resources':
        return t('Exporting attachments')
      case 'packing':
        return t('Creating backup archive')
      case 'reading':
        return t('Reading backup')
      case 'validating':
        return t('Validating backup')
      case 'restoring':
        return t('Restoring data')
    }
  }

  const [importTips, setImportTips] = useState('')
  const [importDetails, setImportDetails] = useState('')
  const [importRequiresRestart, setImportRequiresRestart] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [exportNotice, setExportNotice] = useState<{
    color: 'green' | 'yellow' | 'red'
    title: string
    body?: string
  }>()
  const [pendingDownload, setPendingDownload] = useState<{ filename: string; blob: Blob }>()
  const [pendingDownloadUrl, setPendingDownloadUrl] = useState<string>()
  const operationAbortRef = useRef<AbortController | null>(null)
  const [exportItems, setExportItems] = useState<ExportDataItem[]>([
    ExportDataItem.Setting,
    ExportDataItem.Conversations,
    ExportDataItem.Copilot,
  ])

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
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('Failed to share backup:', error)
    }
  }

  const onExport = async () => {
    if (isLoading) return

    const abortController = new AbortController()
    operationAbortRef.current = abortController
    setIsExporting(true)
    setProgress(null)
    setExportNotice(undefined)
    setPendingDownload(undefined)
    try {
      const date = new Date()
      const result = await exportBackupArchive({
        exportItems: exportItems.map((item) => item as BackupExportItem),
        includeKeys: exportItems.includes(ExportDataItem.Key),
        exportedAt: date,
        storage,
        metaStorage: getMetaStorage(),
        application: { version: platform.getVersion(), platform: platform.getPlatform() },
        signal: abortController.signal,
        onProgress: setProgress,
        writeArchive: (dataCallback) =>
          platform.exporter.exportStreamingFile(
            getBackupFilename(date),
            dataCallback,
            'application/zip',
            abortController.signal
          ),
      })
      const warningCount = result.manifest.warnings.length
      const warningSummary = result.manifest.warnings
        .slice(0, 3)
        .map((warning) => `${warning.itemId ? `${warning.itemId}: ` : ''}${formatBackupWarning(warning)}`)
        .join('\n')
      setPendingDownload(result.pendingDownload)
      const warningBody = [
        warningCount > 0
          ? String(
              t('{{count}} item(s) could not be included. See manifest.json in the backup for details.', {
                count: warningCount,
              })
            )
          : '',
        warningSummary,
        result.pendingDownload
          ? String(
              t(
                "Your backup was created in memory. Select Download, then confirm it appears in your browser's downloads."
              )
            )
          : !result.boundedMemory
            ? String(t('This browser does not support streaming downloads, so the backup was buffered before saving.'))
            : '',
      ]
        .filter(Boolean)
        .join('\n')
      setExportNotice(
        result.pendingDownload
          ? {
              color: warningCount > 0 ? 'yellow' : 'green',
              title: String(t('Backup ready to download')),
              body: warningBody,
            }
          : warningCount > 0 || !result.boundedMemory
            ? {
                color: 'yellow',
                title: String(t('Backup exported with warnings')),
                body: warningBody,
              }
            : { color: 'green', title: String(t('Backup exported successfully')) }
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setExportNotice({ color: 'yellow', title: String(t('Export canceled')) })
      } else {
        console.error('Export failed:', error)
        setExportNotice({ color: 'red', title: String(t('Export failed')), body: String(error) })
      }
    } finally {
      operationAbortRef.current = null
      setIsExporting(false)
      setProgress(null)
    }
  }

  const onImport = async (file: File | null) => {
    if (isLoading || !file) return
    const abortController = new AbortController()
    operationAbortRef.current = abortController
    setIsImporting(true)
    setImportTips('')
    setImportDetails('')
    setImportRequiresRestart(false)
    setProgress(null)
    try {
      if (await isZipBackupFile(file)) {
        // Restoring writes agent-soul/agent-memories directly through storage;
        // holding the persona locks queues concurrent save_memory / Soul edits
        // until the import transaction finishes so neither side is clobbered.
        const result = await withAgentPersonaLocks(async () =>
          importBackupArchive(file, {
            storage,
            metaStorage: await getMetaStorage(),
            signal: abortController.signal,
            onProgress: setProgress,
            rehydrateSession: rehydrateImportedSession,
          })
        )
        if (result.warnings.length > 0) {
          const warningSummary = result.warnings
            .slice(0, 3)
            .map((warning) => `${warning.itemId ? `${warning.itemId}: ` : ''}${formatBackupWarning(warning)}`)
            .join('\n')
          setImportTips(
            String(
              t(
                'Backup restore is almost complete, with {{count}} warning(s). Select Continue to restart Chatbox and finish restoring.',
                {
                  count: result.warnings.length,
                }
              )
            )
          )
          setImportDetails(warningSummary)
          setImportRequiresRestart(true)
          return
        }
      } else {
        await importLegacyJsonBackup(file, {
          storage,
          metaStorage: await getMetaStorage(),
          migrateData: (dataStore) => migrateOnData(dataStore, false),
          recoverSessionList: async () => {
            await rendererApplication.sessions.recoverSessionList()
          },
        })
      }
      await platform.relaunch()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setImportTips(String(t('Import canceled')))
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
      operationAbortRef.current = null
      setIsImporting(false)
      setProgress(null)
    }
  }

  const cancelOperation = () => {
    operationAbortRef.current?.abort(new DOMException('Operation canceled', 'AbortError'))
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
        <Text c="chatbox-tertiary">
          {t('ZIP backups include each conversation and its managed images and attachments.')}
        </Text>
        <Text size="sm" c="chatbox-tertiary">
          {t('Backup files exported here can only be imported in Chatbox 1.22 or later.')}
        </Text>
        {[
          { label: t('Settings'), value: ExportDataItem.Setting },
          { label: t('API KEY & License'), value: ExportDataItem.Key },
          { label: t('Chat History'), value: ExportDataItem.Conversations },
          { label: t('My Copilots'), value: ExportDataItem.Copilot },
        ].map(({ label, value }) => (
          <Checkbox
            key={value}
            checked={exportItems.includes(value)}
            label={label}
            disabled={isLoading}
            onChange={(e) => {
              const checked = e.currentTarget.checked
              if (checked && !exportItems.includes(value)) {
                setExportItems([...exportItems, value])
              } else if (!checked) {
                setExportItems(exportItems.filter((v) => v !== value))
              }
            }}
          />
        ))}
        <Flex gap="sm">
          <Button className="self-start" onClick={onExport} disabled={isLoading} loading={isExporting}>
            {isExporting ? t('Exporting...') : t('Export Selected Data')}
          </Button>
          {isExporting && (
            <Button variant="light" color="chatbox-gray" onClick={cancelOperation}>
              {t('Cancel')}
            </Button>
          )}
        </Flex>
        {progress && (
          <Text size="sm" c="chatbox-tertiary">
            {t('{{phase}}: {{current}} / {{total}}', {
              phase: formatBackupProgressPhase(progress.phase),
              current: progress.current,
              total: progress.total,
            })}
            {progress.label ? ` · ${progress.label}` : ''}
          </Text>
        )}
        {exportNotice && (
          <Alert
            className="self-start"
            variant="light"
            color={exportNotice.color}
            title={exportNotice.title}
            icon={<IconInfoCircle />}
          >
            {exportNotice.body && (
              <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
                {exportNotice.body}
              </Text>
            )}
            {pendingDownload && pendingDownloadUrl && (
              <Flex gap="sm" mt="sm">
                {canSharePendingDownload && <Button onClick={onSharePendingDownload}>{t('Save')}</Button>}
                <Button
                  component="a"
                  variant={canSharePendingDownload ? 'light' : 'filled'}
                  href={pendingDownloadUrl}
                  download={pendingDownload.filename}
                >
                  {t('Download')}
                </Button>
              </Flex>
            )}
          </Alert>
        )}
      </Stack>

      <Divider />

      <Stack gap="lg">
        <Stack gap="xxs">
          <Title order={5}>{t('Data Restore')}</Title>
          <Text c="chatbox-tertiary">
            {t('Upon import, changes will take effect immediately and existing data will be overwritten')}
          </Text>
        </Stack>
        {importTips && (
          <Alert className=" self-start" variant="light" color="yellow" title={importTips} icon={<IconInfoCircle />}>
            {importDetails && (
              <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
                {importDetails}
              </Text>
            )}
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
                <Button variant="light" color="chatbox-gray" onClick={cancelOperation}>
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
