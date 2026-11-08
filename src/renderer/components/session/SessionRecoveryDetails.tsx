import { Button } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { exportPreMigrationSession } from '@/packages/session-startup-recovery/export'
import { sessionStartupRecovery } from '@/packages/session-startup-recovery'
import { formatStartupDiagnostic } from '@/packages/session-startup-recovery/diagnostics'
import { getDiagnosticEnvironment } from '@/packages/session-startup-recovery/reporting'
import { add as addToast } from '@/stores/toastActions'

export function SessionRecoveryDetails({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const [environment, setEnvironment] = useState({ version: 'unknown', platform: 'unknown' })
  const [copying, setCopying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const diagnostic = sessionStartupRecovery.getDiagnostic(sessionId)
  useEffect(() => {
    let active = true
    void getDiagnosticEnvironment().then((value) => {
      if (active) setEnvironment(value)
    })
    return () => {
      active = false
    }
  }, [])
  const text = formatStartupDiagnostic(diagnostic, environment)
  const copy = async () => {
    setCopying(true)
    try {
      await navigator.clipboard.writeText(text)
      addToast(t('Copied'))
    } catch {
      addToast(t('Could not copy diagnostics. Select the details and copy them manually.'))
    } finally {
      setCopying(false)
    }
  }
  const exportOriginal = async () => {
    setExporting(true)
    try {
      if ((await exportPreMigrationSession(sessionId)) === 'unavailable') {
        addToast(t('No pre-migration data is available for this chat.'))
      }
    } catch {
      addToast(t('Could not export pre-migration data. Your chat has not been changed.'))
    } finally {
      setExporting(false)
    }
  }
  return (
    <details className="mt-6 w-full max-w-lg text-left">
      <summary className="cursor-pointer text-sm text-chatbox-tint-secondary">{t('View error details')}</summary>
      {!diagnostic && (
        <p className="text-sm text-chatbox-tint-secondary">
          {t('The previous load was interrupted. No error details were recorded.')}
        </p>
      )}
      {diagnostic?.message === 'Error details omitted to protect private data' && (
        <p className="text-sm text-chatbox-tint-secondary">{t('Error details omitted to protect private data')}</p>
      )}
      <pre className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-words select-text rounded-md bg-chatbox-background-secondary p-3 text-xs">
        {text}
      </pre>
      <Button size="xs" variant="subtle" loading={copying} onClick={() => void copy()}>
        {t('Copy diagnostic information')}
      </Button>
      <p className="mt-4 text-sm text-chatbox-tint-secondary">
        {t(
          'Save the original conversation as JSON for recovery. Attached files are not included. Your chat will not be changed.'
        )}
      </p>
      <Button size="xs" variant="outline" loading={exporting} onClick={() => void exportOriginal()}>
        {t('Export pre-migration data')}
      </Button>
    </details>
  )
}
