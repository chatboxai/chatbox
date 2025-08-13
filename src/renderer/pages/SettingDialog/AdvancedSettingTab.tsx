import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Switch,
  Tab,
  Tabs,
  Typography,
  useTheme,
} from '@mui/material'
import { useAtom } from 'jotai'
import { uniq, uniqBy } from 'lodash'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { migrateOnData } from '@/stores/migration'
import type { Settings } from '../../../shared/types'
import { Accordion, AccordionDetails, AccordionSummary } from '../../components/Accordion'
import { ShortcutConfig } from '../../components/Shortcut'
import TextFieldReset from '../../components/TextFieldReset'
import platform from '../../platform'
import storage, { StorageKey } from '../../storage'
import * as atoms from '../../stores/atoms'

interface Props {
  settingsEdit: Settings
  setSettingsEdit: (settings: Settings) => void
  onCancel: () => void
}

export default function AdvancedSettingTab(props: Props) {
  const { settingsEdit, setSettingsEdit } = props
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  return (
    <Box>
      <Accordion>
        <AccordionSummary aria-controls="panel1a-content">
          <Typography>{t('Network Proxy')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TextFieldReset
            label={t('Proxy Address')}
            value={settingsEdit.proxy || ''}
            onValueChange={(value) => {
              setSettingsEdit({ ...settingsEdit, proxy: value.trim() })
            }}
            placeholder="socks5://127.0.0.1:6153"
            autoFocus={!isSmallScreen}
            fullWidth
            margin="dense"
            variant="outlined"
            disabled={platform.type === 'web'}
            inputProps={{
              className: platform.type === 'web' ? 'cursor-not-allowed' : '',
            }}
            helperText={
              platform.type === 'web' ? <span className="text-red-600">{t('not available in browser')}</span> : null
            }
          />
        </AccordionDetails>
      </Accordion>
      {platform.type !== 'mobile' && (
        <Accordion>
          <AccordionSummary aria-controls="panel1a-content">
            <Typography>{t('Hotkeys')}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <ShortcutConfig
              shortcuts={settingsEdit.shortcuts}
              setShortcuts={(shortcuts) => setSettingsEdit({ ...settingsEdit, shortcuts })}
            />
          </AccordionDetails>
        </Accordion>
      )}
      <Accordion>
        <AccordionSummary aria-controls="panel1a-content">
          <Typography>{t('Data Backup and Restore')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <ExportAndImport onCancel={props.onCancel} />
        </AccordionDetails>
      </Accordion>
      <Accordion>
        <AccordionSummary aria-controls="panel1a-content">
          <Typography>{t('Error Reporting')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <AnalyticsSetting />
        </AccordionDetails>
      </Accordion>

      {platform.type === 'desktop' && (
        <Box className="mt-2">
          <FormGroup>
            <FormControlLabel
              control={<Switch />}
              label={t('Launch at system startup')}
              checked={settingsEdit.autoLaunch}
              onChange={(e, checked) =>
                setSettingsEdit({
                  ...settingsEdit,
                  autoLaunch: checked,
                })
              }
            />
          </FormGroup>
        </Box>
      )}
      {platform.type === 'desktop' && (
        <Box className="mt-2">
          <FormGroup>
            <FormControlLabel
              control={<Switch />}
              label={t('Automatic updates')}
              checked={settingsEdit.autoUpdate}
              onChange={(e, checked) =>
                setSettingsEdit({
                  ...settingsEdit,
                  autoUpdate: checked,
                })
              }
            />
            {settingsEdit.autoUpdate && (
              <FormControlLabel
                control={<Switch />}
                label={t('Beta updates')}
                checked={settingsEdit.betaUpdate}
                onChange={(e, checked) =>
                  setSettingsEdit({
                    ...settingsEdit,
                    betaUpdate: checked,
                  })
                }
              />
            )}
          </FormGroup>
        </Box>
      )}
    </Box>
  )
}

enum ExportDataItem {
  Setting = 'setting',
  Key = 'key',
  Conversations = 'conversations',
  Copilot = 'copilot',
}

function ExportAndImport(props: { onCancel: () => void }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const [tab, setTab] = useState<'export' | 'import'>('export')
  const [exportItems, setExportItems] = useState<ExportDataItem[]>([
    ExportDataItem.Setting,
    ExportDataItem.Conversations,
    ExportDataItem.Copilot,
  ])
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importTips, setImportTips] = useState('')
  const onExport = async () => {
    const data = await storage.getAll()
    delete data[StorageKey.Configs] // 不导出 uuid
    ;(data[StorageKey.Settings] as Settings).licenseDetail = undefined // 不导出license认证数据
    ;(data[StorageKey.Settings] as Settings).licenseInstances = undefined // 不导出license设备数据，导入数据的新设备也应该计入设备数
    if (!exportItems.includes(ExportDataItem.Key)) {
      delete (data[StorageKey.Settings] as Settings).licenseKey
      delete (data[StorageKey.Settings] as Settings).providers
    }
    if (!exportItems.includes(ExportDataItem.Setting)) {
      delete data[StorageKey.Settings]
    }
    if (!exportItems.includes(ExportDataItem.Conversations)) {
      delete data[StorageKey.ChatSessions]
      delete data[StorageKey.ChatSessionsList]
      Object.keys(data).forEach((key) => {
        if (key.startsWith('session:')) {
          delete data[key]
        }
      })
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
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const errTip = t('Import failed, unsupported data format')
    const file = e.target.files?.[0]
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      ;(async () => {
        setImportTips('')
        try {
          const result = event.target?.result
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
          props.onCancel() // 导出成功后立即关闭设置窗口，防止用户点击保存、导致设置数据被覆盖
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
    <Box
      sx={{
        backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100],
      }}
      className="p-4"
    >
      <Tabs value={tab} onChange={(_, value) => setTab(value)} className="mb-4">
        <Tab
          value="export"
          label={<span className="inline-flex justify-center items-center">{t('Data Backup')}</span>}
        />
        <Tab
          value="import"
          label={<span className="inline-flex justify-center items-center">{t('Data Restore')}</span>}
        />
      </Tabs>
      {tab === 'export' && (
        <Box sx={{}}>
          <FormGroup className="mb-2">
            {[
              { label: t('Settings'), value: ExportDataItem.Setting },
              { label: t('API KEY & License'), value: ExportDataItem.Key },
              { label: t('Chat History'), value: ExportDataItem.Conversations },
              { label: t('My Copilots'), value: ExportDataItem.Copilot },
            ].map((item) => (
              <FormControlLabel
                key={item.value}
                label={item.label}
                control={
                  <Checkbox
                    checked={exportItems.includes(item.value)}
                    onChange={(e, checked) => {
                      if (checked && !exportItems.includes(item.value)) {
                        setExportItems([...exportItems, item.value])
                      } else if (!checked) {
                        setExportItems(exportItems.filter((v) => v !== item.value))
                      }
                    }}
                  />
                }
              />
            ))}
          </FormGroup>
          <Button variant="contained" color="primary" onClick={onExport}>
            {t('Export Selected Data')}
          </Button>
        </Box>
      )}
      {tab === 'import' && (
        <Box>
          <Box className="p-1">
            {t('Upon import, changes will take effect immediately and existing data will be overwritten')}
          </Box>
          {importTips && <Box className="p-1 text-red-600">{importTips}</Box>}
          <input style={{ display: 'none' }} type="file" ref={importInputRef} onChange={onImport} />
          <Button variant="contained" color="primary" onClick={() => importInputRef.current?.click()}>
            {t('Import and Restore')}
          </Button>
        </Box>
      )}
    </Box>
  )
}

export function AnalyticsSetting() {
  const { t } = useTranslation()
  return (
    <Box>
      <div>
        <p className="opacity-70">
          {t(
            'Chatbox respects your privacy and only uploads anonymous error data and events when necessary. You can change your preferences at any time in the settings.'
          )}
        </p>
      </div>
      <div className="my-2">
        <AllowReportingAndTrackingCheckbox />
      </div>
    </Box>
  )
}

export function AllowReportingAndTrackingCheckbox(props: { className?: string }) {
  const { t } = useTranslation()
  const [allowReportingAndTracking, setAllowReportingAndTracking] = useAtom(atoms.allowReportingAndTrackingAtom)
  return (
    <span className={props.className}>
      <input
        type="checkbox"
        checked={allowReportingAndTracking}
        onChange={(e) => setAllowReportingAndTracking(e.target.checked)}
      />
      {t('Enable optional anonymous reporting of crash and event data')}
    </span>
  )
}
