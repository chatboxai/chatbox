import LazySlider from '@/components/LazySlider'
import { useSettings } from '@/hooks/useSettings'
import { languageNameMap, languages } from '@/i18n/locales'
import platform from '@/platform'
import storage, { StorageKey } from '@/storage'
import { migrateOnData } from '@/stores/migration'
import { Flex, Radio } from '@mantine/core'
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  FileButton,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { mapValues, uniqBy } from 'lodash'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Language, ProviderInfo, Settings, Theme } from 'src/shared/types'

export const Route = createFileRoute('/settings/general')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { settings, setSettings } = useSettings()

  return (
    <Stack p="md" gap="xl">
      <Title order={5}>{t('General Settings')}</Title>

      {/* Display Settings */}
      <Stack gap="md">
        <Title order={5}>{t('Display Settings')}</Title>

        {/* language */}
        <Select
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
        <Select
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

      {/* import and export data */}
      <ImportExportDataSection />

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

const ImportExportDataSection = () => {
  const { t } = useTranslation()

  const [importTips, setImportTips] = useState('')
  const [exportItems, setExportItems] = useState<ExportDataItem[]>([
    ExportDataItem.Setting,
    ExportDataItem.Conversations,
    ExportDataItem.Copilot,
  ])

  const onExport = async () => {
    const data = await storage.getAll()
    delete data[StorageKey.Configs] // 不导出 uuid
    ;(data[StorageKey.Settings] as Settings).licenseDetail = undefined // 不导出license认证数据
    ;(data[StorageKey.Settings] as Settings).licenseInstances = undefined // 不导出license设备数据，导入数据的新设备也应该计入设备数
    if (!exportItems.includes(ExportDataItem.Key)) {
      delete (data[StorageKey.Settings] as Settings).licenseKey
      data[StorageKey.Settings].providers = mapValues(
        (data[StorageKey.Settings] as Settings).providers,
        (provider: ProviderInfo) => {
          delete provider.apiKey
          return provider
        }
      )
    }
    if (!exportItems.includes(ExportDataItem.Setting)) {
      delete data[StorageKey.Settings]
    }
    if (!exportItems.includes(ExportDataItem.Conversations)) {
      delete data[StorageKey.ChatSessions]
    }
    if (!exportItems.includes(ExportDataItem.Copilot)) {
      delete data[StorageKey.MyCopilots]
    }
    const date = new Date()
    data['__exported_items'] = exportItems
    data['__exported_at'] = date.toISOString()
    const dateStr = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    platform.exporter.exportTextFile(`chatbox-exported-data-${dateStr}.json`, JSON.stringify(data))
  }

  const onImport = (file: File | null) => {
    const errTip = t('Import failed, unsupported data format')
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      ;(async () => {
        setImportTips('')
        try {
          let result = event.target?.result
          if (typeof result !== 'string') {
            throw new Error('FileReader result is not string')
          }
          const importData = JSON.parse(result)
          // 如果导入数据中包含了老的版本号，应该仅仅针对老的版本号进行迁移
          await migrateOnData(
            {
              getData: async (key, defaultValue) => {
                return importData[key] || defaultValue
              },
              setData: async (key, value) => {
                importData[key] = value
              },
              setAll: async (data) => {
                Object.assign(importData, data)
              },
            },
            false
          )

          const previousData = await storage.getAll()
          // FIXME: 这里缺少了数据校验
          await storage.setAll({
            ...previousData, // 有时候 importData 在导出时没有包含一些数据，这些数据应该保持原样
            ...importData,
            [StorageKey.ChatSessionsList]: uniqBy(
              [
                ...(previousData[StorageKey.ChatSessionsList] || []),
                ...(importData[StorageKey.ChatSessionsList] || []),
              ],
              'id'
            ),
          })
          // props.onCancel() // 导出成功后立即关闭设置窗口，防止用户点击保存、导致设置数据被覆盖
          platform.relaunch() // 重启应用以生效
        } catch (err) {
          setImportTips(errTip)

          throw err
        }
      })()
    }
    reader.onerror = (event) => {
      setImportTips(errTip)
      const err = event.target?.error
      if (!err) {
        throw new Error('FileReader error but no error message')
      }
      throw err
    }
    reader.readAsText(file)
  }

  return (
    <>
      <Stack gap="md">
        <Title order={5}>{t('Data Backup')}</Title>
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
        <Button className="self-start" onClick={onExport}>
          {t('Export Selected Data')}
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
        <FileButton accept="application/json" onChange={onImport}>
          {(props) => (
            <Button {...props} className="self-start">
              {t('Import and Restore')}
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
