import {
  Alert,
  Button,
  Checkbox,
  Divider,
  FileButton,
  Flex,
  PasswordInput,
  Radio,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { type Language, type Settings, Theme } from '@shared/types'
import { formatFileSize } from '@shared/utils'
import { IconInfoCircle } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import LazySlider from '@/components/common/LazySlider'
import { languageNameMap, languages } from '@/i18n/locales'
import { sanitizeSettingsForExport } from '@/packages/settings-export'
import { createDefaultWebDAVSyncDeps } from '@/packages/sync/local'
import { downloadAndMergeWebDAVSnapshot, testWebDAVConnection, uploadWebDAVSnapshot } from '@/packages/sync/service'
import { toastError } from '@/packages/toast'
import platform from '@/platform'
import storage, { StorageKey } from '@/storage'
import { getMetaStorage, recoverSessionList } from '@/stores/chatStore'
import { migrateOnData } from '@/stores/migration'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/general')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)

  return (
    <Stack p="md" gap="xl">
      <Title order={5}>{t('General Settings')}</Title>

      {/* Display Settings */}
      <Stack gap="md">
        <Title order={5}>{t('Display Settings')}</Title>

        {/* language */}
        <AdaptiveSelect
          maw={320}
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

        {/* theme */}
        <AdaptiveSelect
          maw={320}
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

        {/* Font Size */}
        <Stack>
          <Text>{t('Font Size')}</Text>
          <LazySlider
            step={1}
            min={10}
            max={22}
            maw={320}
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
            onChange={(val) => setSettings({ startupPage: val as any })}
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

      {platform.type !== 'web' && (
        <>
          <Divider />

          <WebDAVSyncSection />
        </>
      )}

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

const WebDAVSyncSection = () => {
  const { t } = useTranslation()
  const { setSettings, sync } = useSettingsStore((state) => ({
    setSettings: state.setSettings,
    sync: state.sync,
  }))
  const [runningAction, setRunningAction] = useState<'test' | 'upload' | 'download' | null>(null)

  const updateWebDAVSettings = (patch: Partial<typeof sync.webdav>) => {
    setSettings((settings) => {
      settings.sync.webdav = {
        ...settings.sync.webdav,
        ...patch,
      }
    })
  }

  const runSyncAction = async (action: 'test' | 'upload' | 'download', task: () => Promise<string | undefined>) => {
    if (runningAction) return
    setRunningAction(action)
    try {
      const message = await task()
      if (message) {
        toast.success(message)
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunningAction(null)
    }
  }

  const currentSettings = () => settingsStore.getState().getSettings()

  return (
    <Stack gap="md">
      <Stack gap="xxs">
        <Title order={5}>{t('WebDAV Sync')}</Title>
        <Text c="chatbox-tertiary">
          {t(
            'Sync chat history through your own WebDAV storage. API keys, licenses, and provider credentials are not synced.'
          )}
        </Text>
      </Stack>

      <Switch
        label={t('Enable WebDAV sync')}
        checked={sync.enabled}
        onChange={(event) =>
          setSettings((settings) => {
            settings.sync.enabled = event.currentTarget.checked
          })
        }
      />

      <TextInput
        maw={420}
        label={t('WebDAV URL')}
        placeholder="https://dav.example.com/remote.php/dav/files/me/"
        value={sync.webdav.url}
        onChange={(event) => updateWebDAVSettings({ url: event.currentTarget.value })}
      />

      <TextInput
        maw={320}
        label={t('Username')}
        value={sync.webdav.username}
        onChange={(event) => updateWebDAVSettings({ username: event.currentTarget.value })}
      />

      <PasswordInput
        maw={320}
        label={t('WebDAV password')}
        value={sync.webdav.password}
        onChange={(event) => updateWebDAVSettings({ password: event.currentTarget.value })}
      />

      <PasswordInput
        maw={320}
        label={t('Sync encryption password')}
        value={sync.webdav.syncPassword}
        onChange={(event) => updateWebDAVSettings({ syncPassword: event.currentTarget.value })}
      />

      {sync.lastSyncedAt && (
        <Text size="sm" c="chatbox-tertiary">
          {t('Last synced at {{time}}', { time: dayjs(sync.lastSyncedAt).format('YYYY-MM-DD HH:mm') })}
        </Text>
      )}

      <Flex gap="sm" wrap="wrap">
        <Button
          variant="light"
          loading={runningAction === 'test'}
          disabled={Boolean(runningAction)}
          onClick={() =>
            runSyncAction('test', async () => {
              await testWebDAVConnection(currentSettings(), { platform })
              return String(t('Connection successful'))
            })
          }
        >
          {t('Test Connection')}
        </Button>
        <Button
          variant="light"
          loading={runningAction === 'upload'}
          disabled={Boolean(runningAction) || !sync.enabled}
          onClick={() =>
            runSyncAction('upload', async () => {
              const result = await uploadWebDAVSnapshot(currentSettings(), createDefaultWebDAVSyncDeps())
              return String(t('Uploaded {{count}} conversations', { count: result.uploaded }))
            })
          }
        >
          {t('Upload Now')}
        </Button>
        <Button
          variant="light"
          loading={runningAction === 'download'}
          disabled={Boolean(runningAction) || !sync.enabled}
          onClick={() =>
            runSyncAction('download', async () => {
              const result = await downloadAndMergeWebDAVSnapshot(currentSettings(), createDefaultWebDAVSyncDeps())
              if (result.remoteMissing) {
                return String(t('No remote sync snapshot found'))
              }
              return String(
                t('Imported {{imported}} conversations, created {{conflicts}} synced copies', {
                  imported: result.imported,
                  conflicts: result.conflicts,
                })
              )
            })
          }
        >
          {t('Download and Merge')}
        </Button>
      </Flex>
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
      const result = await recoverSessionList()
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

  const [importTips, setImportTips] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [exportItems, setExportItems] = useState<ExportDataItem[]>([
    ExportDataItem.Setting,
    ExportDataItem.Conversations,
    ExportDataItem.Copilot,
  ])

  const isLoading = isExporting || isImporting

  const onExport = async () => {
    if (isLoading) return

    setIsExporting(true)
    try {
      const date = new Date()
      const dateStr = dayjs(date).format('YYYY-M-D')

      const streamingDataGenerator = async function* () {
        yield '{'

        let isFirstItem = true

        // 导出metadata
        if (!isFirstItem) yield ','
        yield `"__exported_items":${JSON.stringify(exportItems)}`
        isFirstItem = false

        if (!isFirstItem) yield ','
        yield `"__exported_at":"${date.toISOString()}"`

        // 获取所有存储的keys
        try {
          const allKeys = await storage.getAllKeys()

          for (const key of allKeys) {
            let shouldExport = false

            // 判断是否需要导出这个key
            if (key === StorageKey.Settings && exportItems.includes(ExportDataItem.Setting)) {
              shouldExport = true
            } else if (key.startsWith('session:') && exportItems.includes(ExportDataItem.Conversations)) {
              shouldExport = true
            } else if (key === StorageKey.MyCopilots && exportItems.includes(ExportDataItem.Copilot)) {
              shouldExport = true
            } else if (key === StorageKey.ChatSessionsList) {
              // Skip: session meta is now exported from DB below
              shouldExport = false
            } else if (key === StorageKey.ChatSessionSettings && exportItems.includes(ExportDataItem.Conversations)) {
              shouldExport = true
            } else if (
              key === StorageKey.PictureSessionSettings &&
              exportItems.includes(ExportDataItem.Conversations)
            ) {
              shouldExport = true
            } else if (key === StorageKey.ConfigVersion) {
              shouldExport = true
            }

            // 跳过不需要导出的key
            if (key === StorageKey.Configs) {
              shouldExport = false // 不导出 uuid
            }

            if (shouldExport) {
              try {
                const value = await storage.getItem(key, null)
                if (value !== null) {
                  // 对settings进行特殊处理，清理敏感数据
                  if (key === StorageKey.Settings) {
                    const cleanedSettings = sanitizeSettingsForExport(
                      value as Settings,
                      exportItems.includes(ExportDataItem.Key)
                    )

                    yield ','
                    yield `"${key}":${JSON.stringify(cleanedSettings)}`
                  } else {
                    yield ','
                    yield `"${key}":${JSON.stringify(value)}`
                  }
                }
              } catch (error) {
                console.warn(`Failed to export key ${key}:`, error)
              }
            }
          }
        } catch (error) {
          console.error('Failed to get storage keys:', error)
        }

        // Export session meta from DB (no longer in key-value storage)
        if (exportItems.includes(ExportDataItem.Conversations)) {
          try {
            const metaStorage = await getMetaStorage()
            const allMeta = await metaStorage.getAll()
            if (allMeta.length > 0) {
              yield ','
              yield `"${StorageKey.ChatSessionsList}":${JSON.stringify(allMeta)}`
            }
          } catch (error) {
            console.error('Failed to export session meta from DB:', error)
          }
        }

        yield '}'
      }

      await platform.exporter.exportStreamingJson(`chatbox-exported-data-${dateStr}.json`, streamingDataGenerator)
    } catch (error) {
      console.error('Export failed:', error)
    } finally {
      setIsExporting(false)
    }
  }

  const onImport = (file: File | null) => {
    if (isLoading) return

    const errTip = t('Import failed, unsupported data format')
    if (!file) {
      return
    }

    setIsImporting(true)
    setImportTips('')

    const reader = new FileReader()
    reader.onload = (event) => {
      void (async () => {
        try {
          const result = event.target?.result
          if (typeof result !== 'string') {
            throw new Error('FileReader result is not string')
          }
          const importData = JSON.parse(result)
          // 如果导入数据中包含了老的版本号，应该仅仅针对老的版本号进行迁移
          await migrateOnData(
            {
              getData: (key, defaultValue) => Promise.resolve(importData[key] ?? defaultValue),
              setData: (key, value) => {
                importData[key] = value
                return Promise.resolve()
              },
              setAll: (data) => {
                Object.assign(importData, data)
                return Promise.resolve()
              },
            },
            false
          )

          const entriesToImport = Object.entries(importData).filter(
            ([key]) => key !== StorageKey.ChatSessionsList && key !== StorageKey.ConfigVersion && !key.startsWith('__')
          )

          const importedChatSessions = Array.isArray(importData[StorageKey.ChatSessionsList])
            ? importData[StorageKey.ChatSessionsList]
            : undefined

          for (const [key, value] of entriesToImport) {
            await storage.setItemNow(key, value)
          }

          if (importedChatSessions) {
            const metaStorage = await getMetaStorage()
            for (const item of importedChatSessions) {
              const existing = await metaStorage.getById(item.id)
              if (!existing) {
                await metaStorage.create({
                  ...item,
                  sortOrder: item.sortOrder ?? Date.now(),
                  createdAt: item.createdAt ?? Date.now(),
                })
              }
            }
          }

          // 由于即将重启应用，这里不需要清理loading状态
          // props.onCancel() // 导入成功后立即关闭设置窗口，防止用户点击保存、导致设置数据被覆盖
          platform.relaunch() // 重启应用以生效
        } catch (err) {
          setImportTips(errTip)
          setIsImporting(false)
          throw err
        }
      })()
    }
    reader.onerror = (event) => {
      setImportTips(errTip)
      setIsImporting(false)
      const err = event.target?.error
      if (!err) {
        throw new Error('FileReader error but no error message')
      }
      throw err
    }
    reader.readAsText(file)
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
        <Button className="self-start" onClick={onExport} disabled={isLoading} loading={isExporting}>
          {isExporting ? t('Exporting...') : t('Export Selected Data')}
        </Button>
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
          <Alert
            className=" self-start"
            variant="light"
            color="yellow"
            title={importTips}
            icon={<IconInfoCircle />}
          ></Alert>
        )}
        <FileButton accept="application/json" onChange={onImport} disabled={isLoading}>
          {(props) => (
            <Button {...props} className="self-start" disabled={isLoading} loading={isImporting}>
              {isImporting ? t('Importing...') : t('Import and Restore')}
            </Button>
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

  const handleClearLogs = async () => {
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
