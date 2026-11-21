import { Button, Checkbox, Group, NumberInput, Select, Text, TextInput } from '@mantine/core'
import {
  type BaiduAccountStatus,
  baiduRedirectUri,
  type SyncMode,
  type SyncPreferencesUpdate,
  type SyncSelection,
  type SyncService,
} from '@shared/sync'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingSwitchRow, SettingsSection } from '@/components/settings/SettingsLayout'
import { initializeSyncRuntime, saveSyncPreferences, syncNow, syncRuntime } from '@/packages/sync/runtime'
import platform from '@/platform'
import { SavedSyncSecretInput } from './SavedSyncSecretInput'
import { formatSyncError, WebDavSyncSettings } from './WebDavSyncSettings'

export function SyncSettingsSection() {
  const { t } = useTranslation()
  const sync = platform.sync
  const [syncEnabled, setSyncEnabled] = useState(false)
  const [syncService, setSyncService] = useState<SyncService>('baidu-netdisk')
  const [baiduAccount, setBaiduAccount] = useState<BaiduAccountStatus | null>(null)
  const [accountLoading, setAccountLoading] = useState(false)
  const [loginInProgress, setLoginInProgress] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [savedClientId, setSavedClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [clientSecretConfigured, setClientSecretConfigured] = useState(false)
  const [encryptionEnabled, setEncryptionEnabled] = useState(false)
  const [token, setToken] = useState('')
  const [syncMode, setSyncMode] = useState<SyncMode>('interval')
  const [intervalMinutes, setIntervalMinutes] = useState(30)
  const [selection, setSelection] = useState<SyncSelection>({
    sessions: true,
    settings: true,
    copilots: true,
    credentials: false,
  })
  const runtime = useSyncExternalStore(syncRuntime.subscribe, syncRuntime.getSnapshot, syncRuntime.getSnapshot)

  const savePreferences = (update: SyncPreferencesUpdate) => saveSyncPreferences(update).catch(() => undefined)

  useEffect(() => {
    void initializeSyncRuntime()
  }, [])

  useEffect(() => {
    if (!runtime.loaded) return
    setSyncEnabled(runtime.preferences.enabled)
    setSyncService(runtime.preferences.service)
    setSyncMode(runtime.preferences.mode)
    setIntervalMinutes(runtime.preferences.intervalMinutes)
    setSelection(runtime.preferences.selection)
    setEncryptionEnabled(runtime.preferences.encryptionEnabled)
  }, [runtime.loaded, runtime.preferences])

  const localizeAccountError = (error: string) => {
    switch (error) {
      case 'baidu_oauth_state_mismatch':
        return t('Baidu authorization validation failed. Please try again.')
      case 'login_cancelled':
        return t('Login was cancelled.')
      default:
        return t(error, { defaultValue: t('Baidu Netdisk login failed.') })
    }
  }

  useEffect(() => {
    if (!sync || !runtime.loaded || syncService !== 'baidu-netdisk') return
    let active = true
    setAccountLoading(true)
    sync
      .getBaiduAccount()
      .then((result) => {
        if (!active) return
        setBaiduAccount(result.success && result.account?.authenticated ? result.account : null)
        if (result.configuration?.clientId) {
          setClientId(result.configuration.clientId)
          setSavedClientId(result.configuration.clientId)
        }
        setClientSecretConfigured(Boolean(result.configuration?.clientSecretConfigured))
        setAccountError(result.success ? null : result.error || t('Unable to load Baidu Netdisk account.'))
      })
      .catch(() => {
        if (active) setAccountError(t('Unable to load Baidu Netdisk account.'))
      })
      .finally(() => {
        if (active) setAccountLoading(false)
      })
    return () => {
      active = false
    }
  }, [runtime.loaded, sync, syncService, t])

  const login = async () => {
    if (!sync) return
    setAccountLoading(true)
    setLoginInProgress(true)
    setAccountError(null)
    try {
      const result = await sync.signInToBaidu({
        clientId,
        clientSecret: clientSecret || undefined,
      })
      if (result.configuration) {
        setSavedClientId(result.configuration.clientId ?? '')
        setClientSecretConfigured(result.configuration.clientSecretConfigured)
        if (result.configuration.clientSecretConfigured) setClientSecret('')
      }
      if (!result.success || !result.account?.authenticated) {
        setAccountError(result.error ? localizeAccountError(result.error) : t('Baidu Netdisk login failed.'))
        return
      }
      setBaiduAccount(result.account)
    } catch {
      setAccountError(t('Baidu Netdisk login failed.'))
    } finally {
      setLoginInProgress(false)
      setAccountLoading(false)
    }
  }

  const cancelLogin = async () => {
    if (!sync) return
    try {
      const result = await sync.cancelBaiduLogin()
      setAccountError(result.success ? t('Login was cancelled.') : result.error || t('Baidu Netdisk login failed.'))
    } catch {
      setAccountError(t('Baidu Netdisk login failed.'))
    } finally {
      setLoginInProgress(false)
      setAccountLoading(false)
    }
  }

  const logout = async () => {
    if (!sync) return
    setAccountLoading(true)
    setAccountError(null)
    try {
      const result = await sync.signOutOfBaidu()
      if (!result.success) {
        setAccountError(result.error || t('Unable to sign out from Baidu Netdisk.'))
        return
      }
      setBaiduAccount(null)
    } catch {
      setAccountError(t('Unable to sign out from Baidu Netdisk.'))
    } finally {
      setAccountLoading(false)
    }
  }

  const canLogin =
    Boolean(clientId.trim()) &&
    (Boolean(clientSecret.trim()) || (clientSecretConfigured && clientId.trim() === savedClientId))
  const serviceConfigured = syncService === 'webdav' ? Boolean(runtime.preferences.webdav) : Boolean(baiduAccount)
  const controlsDisabled = !syncEnabled || runtime.running

  return (
    <SettingsSection
      title={t('Synchronization')}
      description={t(
        'Synchronize conversations and settings across devices. A newer cloud backup replaces the selected data on this device.'
      )}
    >
      <SettingSwitchRow
        label={t('Enable synchronization')}
        checked={syncEnabled}
        disabled={!runtime.loaded || runtime.running}
        onChange={(checked) => {
          setSyncEnabled(checked)
          savePreferences({ enabled: checked })
        }}
      />
      <SettingRow
        label={t('Synchronization service')}
        description={t('Choose where Chatbox stores synchronized data.')}
        disabled={controlsDisabled}
        control={(fieldId) => (
          <Select
            id={fieldId}
            w={220}
            comboboxProps={{ withinPortal: true, withArrow: true }}
            aria-label={t('Synchronization service') ?? undefined}
            data={[
              { value: 'baidu-netdisk', label: t('Baidu Netdisk') },
              { value: 'webdav', label: 'WebDAV' },
            ]}
            value={syncService}
            disabled={controlsDisabled}
            allowDeselect={false}
            onChange={(value) => {
              if (value === 'baidu-netdisk' || value === 'webdav') {
                setSyncService(value)
                void savePreferences({ service: value })
              }
            }}
          />
        )}
      />
      {syncService === 'webdav' && (
        <WebDavSyncSettings configuration={runtime.preferences.webdav} disabled={controlsDisabled} />
      )}
      {syncService === 'baidu-netdisk' && (
        <>
          <SettingRow
            label={t('Baidu AppKey')}
            description={t(
              'Create your own application in the Baidu Netdisk Open Platform and register the callback URL: {{url}}',
              { url: baiduRedirectUri }
            )}
            disabled={controlsDisabled}
            control={(fieldId) => (
              <TextInput
                id={fieldId}
                w={280}
                maw="100%"
                aria-label={t('Baidu AppKey') ?? undefined}
                value={clientId}
                disabled={controlsDisabled || loginInProgress}
                readOnly={Boolean(baiduAccount)}
                placeholder={t('Enter AppKey') ?? undefined}
                onChange={(event) => setClientId(event.currentTarget.value)}
              />
            )}
          />
          <SettingRow
            label={t('Baidu SecretKey')}
            description={t('Encrypted and stored only on this device.')}
            disabled={controlsDisabled}
            control={(fieldId) => (
              <SavedSyncSecretInput
                id={fieldId}
                w={280}
                maw="100%"
                aria-label={t('Baidu SecretKey') ?? undefined}
                value={clientSecret}
                disabled={controlsDisabled || loginInProgress}
                readOnly={Boolean(baiduAccount)}
                saved={
                  clientSecretConfigured && clientId.trim() === savedClientId
                    ? { kind: 'baidu-secret-key', clientId: savedClientId }
                    : undefined
                }
                placeholder={t('Enter SecretKey') ?? undefined}
                onChange={(event) => setClientSecret(event.currentTarget.value)}
              />
            )}
          />
        </>
      )}
      {syncService === 'baidu-netdisk' &&
        (baiduAccount ? (
          <>
            <SettingRow
              label={t('User information')}
              disabled={controlsDisabled}
              control={
                <Text size="sm" c={syncEnabled ? 'chatbox-secondary' : 'chatbox-tertiary'}>
                  {baiduAccount.displayName || baiduAccount.userId || t('Authorized Baidu Netdisk account')}
                </Text>
              }
            />
            <SettingRow
              label={t('Last API call')}
              disabled={controlsDisabled}
              control={
                <Text size="sm" c={syncEnabled ? 'chatbox-secondary' : 'chatbox-tertiary'}>
                  {baiduAccount.lastCallAt ? new Date(baiduAccount.lastCallAt).toLocaleString() : t('Never')}
                </Text>
              }
            />
            <SettingRow
              label={t('Account actions')}
              disabled={controlsDisabled}
              control={
                <div>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={controlsDisabled}
                    loading={accountLoading}
                    onClick={logout}
                  >
                    {t('Sign out')}
                  </Button>
                  {accountError && (
                    <Text size="xs" c="chatbox-error" mt={6} maw={320}>
                      {accountError}
                    </Text>
                  )}
                </div>
              }
            />
          </>
        ) : (
          <SettingRow
            label={t('Baidu Netdisk configuration')}
            description={t('Connect your Baidu Netdisk account to enable synchronization.')}
            disabled={controlsDisabled}
            control={
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={controlsDisabled || !canLogin || (accountLoading && !loginInProgress)}
                    loading={loginInProgress}
                    onClick={login}
                  >
                    {t('Sign in')}
                  </Button>
                  {loginInProgress && (
                    <Button variant="default" size="sm" onClick={cancelLogin}>
                      {t('Cancel')}
                    </Button>
                  )}
                </div>
                {accountError && (
                  <Text size="xs" c="chatbox-error" mt={6} maw={320}>
                    {accountError}
                  </Text>
                )}
              </div>
            }
          />
        ))}
      <SettingSwitchRow
        label={t('End-to-end encryption')}
        description={t('Encrypt synchronized data before it leaves this device.')}
        checked={encryptionEnabled}
        disabled={controlsDisabled}
        onChange={(checked) => {
          setEncryptionEnabled(checked)
          savePreferences({ encryptionEnabled: checked })
        }}
      />
      {encryptionEnabled && (
        <SettingRow
          label={t('Token')}
          description={t('Used to encrypt and decrypt synchronized data.')}
          controlLayout="block"
          disabled={controlsDisabled}
          control={(fieldId) => (
            <SavedSyncSecretInput
              id={fieldId}
              aria-label={t('Token') ?? undefined}
              value={token}
              disabled={controlsDisabled}
              saved={runtime.preferences.encryptionTokenConfigured ? { kind: 'encryption-token' } : undefined}
              placeholder={t('Enter an encryption token') ?? undefined}
              onChange={(event) => setToken(event.currentTarget.value)}
              onBlur={() => {
                if (token.trim()) savePreferences({ encryptionToken: token })
              }}
            />
          )}
        />
      )}
      <SettingRow
        label={t('Synchronization method')}
        disabled={controlsDisabled}
        control={(fieldId) => (
          <Select
            id={fieldId}
            w={220}
            value={syncMode}
            disabled={controlsDisabled}
            allowDeselect={false}
            data={[
              { value: 'interval', label: t('Scheduled synchronization') },
              { value: 'window-close', label: t('Synchronize when window closes') },
            ]}
            onChange={(value) => {
              if (value === 'interval' || value === 'window-close') {
                setSyncMode(value)
                savePreferences({ mode: value })
              }
            }}
          />
        )}
      />
      {syncMode === 'interval' && (
        <SettingRow
          label={t('Synchronization interval')}
          description={t('The interval is measured in minutes.')}
          disabled={controlsDisabled}
          control={(fieldId) => (
            <NumberInput
              id={fieldId}
              w={220}
              min={1}
              max={1440}
              suffix={` ${t('minutes')}`}
              value={intervalMinutes}
              disabled={controlsDisabled}
              onChange={(value) => {
                const minutes = typeof value === 'number' ? value : 30
                setIntervalMinutes(minutes)
              }}
              onBlur={() => savePreferences({ intervalMinutes })}
            />
          )}
        />
      )}
      <SettingRow
        label={t('Synchronization time')}
        control={
          <Text size="sm" c={syncEnabled ? 'chatbox-secondary' : 'chatbox-tertiary'}>
            {runtime.preferences.lastSyncAt ? new Date(runtime.preferences.lastSyncAt).toLocaleString() : t('Never')}
          </Text>
        }
      />
      <SettingRow
        label={t('Synchronization data')}
        description={t(
          'Choose the data included in synchronization. Credentials are part of the cloud backup when selected.'
        )}
        controlLayout="block"
        disabled={controlsDisabled}
        control={
          <Group gap="lg">
            {(
              [
                ['sessions', t('Conversations')],
                ['settings', t('Settings')],
                ['copilots', t('Copilot')],
                ['credentials', t('Credentials')],
              ] as Array<[keyof SyncSelection, string]>
            ).map(([key, label]) => (
              <Checkbox
                key={key}
                label={label}
                checked={selection[key]}
                disabled={controlsDisabled || (key === 'settings' && selection.credentials)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  const next = { ...selection, [key]: checked }
                  if (key === 'credentials' && checked) next.settings = true
                  setSelection(next)
                  savePreferences({ selection: next })
                }}
              />
            ))}
          </Group>
        }
      />
      <SettingRow
        label={t('Synchronize')}
        description={
          runtime.error
            ? formatSyncError(runtime.error, t)
            : runtime.completed
              ? t('Synchronization completed.')
              : undefined
        }
        disabled={controlsDisabled}
        control={
          <Button
            size="sm"
            disabled={
              controlsDisabled ||
              !serviceConfigured ||
              (encryptionEnabled && !token.trim() && !runtime.preferences.encryptionTokenConfigured)
            }
            loading={runtime.running}
            onClick={() => {
              void (async () => {
                if (token.trim()) await saveSyncPreferences({ encryptionToken: token })
                await syncNow()
              })().catch(() => undefined)
            }}
          >
            {t('Synchronize')}
          </Button>
        }
      />
    </SettingsSection>
  )
}
