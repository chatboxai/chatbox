import { Alert, Box, Button, Stack, Text } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { SettingRow } from '@/components/settings/SettingsLayout'
import platform from '@/platform'
import { BackupControls } from './BackupControls'

export function DataRecoveryRow() {
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
        <Button variant="default" size="xs" onClick={handleRecover} disabled={isRecovering} loading={isRecovering}>
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
  return <BackupControls />
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
