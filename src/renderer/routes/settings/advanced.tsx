import { Button, Flex, Text, TextInput } from '@mantine/core'
import { IconCircleCheck, IconCircleX } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DiagnosticLogsRow, useBackupOperationActive } from '@/components/settings/DataSections'
import { isValidProxyAddress } from '@/components/settings/proxy-address'
import { SettingRow, SettingSwitchRow, SettingsPage, SettingsSection } from '@/components/settings/SettingsLayout'
import { useFieldDraft } from '@/hooks/useFieldDraft'
import platform from '@/platform'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/advanced')({
  component: RouteComponent,
})

const CONNECTIVITY_CHECK_URL = 'https://www.gstatic.com/generate_204'
const CONNECTIVITY_TIMEOUT_MS = 10_000

type ConnectionResult = { ok: true; ms: number } | { ok: false }

async function checkConnection(): Promise<ConnectionResult> {
  const started = performance.now()
  try {
    await fetch(CONNECTIVITY_CHECK_URL, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(CONNECTIVITY_TIMEOUT_MS),
    })
    return { ok: true, ms: Math.round(performance.now() - started) }
  } catch {
    return { ok: false }
  }
}

function ProxyRow({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const proxy = useSettingsStore((s) => s.proxy)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ConnectionResult | null>(null)
  // Results of a test started before the address changed are dropped.
  const testRun = useRef(0)
  // The address is saved as typed and handed to the network stack; the format check only warns.
  const { draft, setDraft, flush } = useFieldDraft(proxy ?? '', (next) => {
    const value = next.trim()
    testRun.current += 1
    setTesting(false)
    setResult(null)
    if (value === (proxy ?? '')) return 'unchanged'
    setSettings({ proxy: value })
    return 'applied'
  })
  const looksValid = isValidProxyAddress(draft.trim())

  return (
    <SettingRow
      id="proxy"
      label={t('Network Proxy')}
      description={t('Supports http, https and socks5. Leave empty to connect directly.')}
      controlLayout="block"
      control={(fieldId) => (
        <div className="flex flex-col gap-1.5">
          <Flex gap="xs" align="flex-start">
            <TextInput
              id={fieldId}
              flex={1}
              size="sm"
              disabled={disabled || testing}
              aria-label={t('Network Proxy') ?? undefined}
              placeholder="socks5://127.0.0.1:6153"
              value={draft}
              error={looksValid ? undefined : t('Use a format like socks5://127.0.0.1:6153')}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onBlur={flush}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
            {platform.type === 'desktop' && (
              <Button
                variant="default"
                size="sm"
                loading={testing}
                disabled={disabled}
                onClick={async () => {
                  flush()
                  const run = ++testRun.current
                  setTesting(true)
                  setResult(null)
                  // Resolves once the app uses the address, so the request goes through it.
                  const outcome = await platform
                    .ensureProxyConfig({ proxy: settingsStore.getState().proxy })
                    .then(checkConnection, (): ConnectionResult => ({ ok: false }))
                  if (run !== testRun.current) return
                  setResult(outcome)
                  setTesting(false)
                }}
              >
                {t('Test connection')}
              </Button>
            )}
          </Flex>
          {result && (
            <Flex align="center" gap={4}>
              {result.ok ? (
                <IconCircleCheck size={14} className="text-chatbox-tint-success" />
              ) : (
                <IconCircleX size={14} className="text-chatbox-tint-error" />
              )}
              <Text fz={12} c={result.ok ? 'chatbox-success' : 'chatbox-error'}>
                {result.ok
                  ? t('Connected in {{ms}} ms', { ms: result.ms })
                  : t('Could not connect. Check the proxy address and that the proxy is running.')}
              </Text>
            </Flex>
          )}
        </div>
      )}
    />
  )
}

export function RouteComponent() {
  const { t } = useTranslation()
  const allowReportingAndTracking = useSettingsStore((s) => s.allowReportingAndTracking)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const backupActive = useBackupOperationActive()

  return (
    <SettingsPage title={t('Advanced')} description={t('Network, diagnostics and privacy.')}>
      <SettingsSection title={t('Network')}>
        <ProxyRow disabled={backupActive} />
      </SettingsSection>
      <SettingsSection title={t('Diagnostics & privacy')}>
        <DiagnosticLogsRow />
        <SettingSwitchRow
          id="error-reporting"
          label={t('Error Reporting')}
          description={t(
            'Chatbox respects your privacy and only uploads anonymous error data and events when necessary. You can change your preferences at any time in the settings.'
          )}
          disabled={backupActive}
          checked={allowReportingAndTracking}
          onChange={(checked) => setSettings({ allowReportingAndTracking: checked })}
        />
      </SettingsSection>
    </SettingsPage>
  )
}
