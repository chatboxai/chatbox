import { Button, Text, TextInput } from '@mantine/core'
import type { WebDavConfigurationStatus } from '@shared/sync'
import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { configureWebDav } from '@/packages/sync/runtime'
import { SavedSyncSecretInput } from './SavedSyncSecretInput'
import { SettingRow } from './SettingsLayout'

export function formatSyncError(error: string, t: TFunction) {
  const status = /^webdav_http_error:(\d{3})$/.exec(error)?.[1]
  return status
    ? t('WebDAV request failed (HTTP {{status}}).', { status })
    : t(error, { defaultValue: t('sync_failed') })
}

export function WebDavSyncSettings({
  configuration,
  disabled,
}: {
  configuration?: WebDavConfigurationStatus
  disabled: boolean
}) {
  const { t } = useTranslation()
  const savedUrl = configuration?.url ?? ''
  const savedUsername = configuration?.username ?? ''
  const [url, setUrl] = useState(savedUrl)
  const [username, setUsername] = useState(savedUsername)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ error?: string }>()
  const isDisabled = disabled || saving
  const hasSavedPassword =
    configuration?.passwordConfigured &&
    (url.trim() === savedUrl || `${url.trim()}/` === savedUrl) &&
    username.trim() === savedUsername

  useEffect(() => {
    setUrl(savedUrl)
    setUsername(savedUsername)
    setPassword('')
  }, [savedUrl, savedUsername])

  async function save() {
    setSaving(true)
    setResult(undefined)
    try {
      await configureWebDav({ url, username, password: password || undefined })
      setPassword('')
      setResult({})
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : 'webdav_network_error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SettingRow
        label={t('WebDAV server URL')}
        description={t(
          'Use the WebDAV endpoint. Chatbox stores the sync file in the ChatAny folder for compatibility.'
        )}
        disabled={isDisabled}
        control={(fieldId) => (
          <TextInput
            id={fieldId}
            type="url"
            w={280}
            maw="100%"
            value={url}
            disabled={isDisabled}
            placeholder="https://example.com/dav/"
            onChange={(event) => {
              setUrl(event.currentTarget.value)
              setResult(undefined)
            }}
          />
        )}
      />
      <SettingRow
        label={t('WebDAV username')}
        disabled={isDisabled}
        control={(fieldId) => (
          <TextInput
            id={fieldId}
            w={280}
            maw="100%"
            value={username}
            disabled={isDisabled}
            autoComplete="off"
            onChange={(event) => {
              setUsername(event.currentTarget.value)
              setResult(undefined)
            }}
          />
        )}
      />
      <SettingRow
        label={t('WebDAV password or app password')}
        description={t('Encrypted and stored only on this device.')}
        disabled={isDisabled}
        control={(fieldId) => (
          <SavedSyncSecretInput
            id={fieldId}
            w={280}
            maw="100%"
            value={password}
            disabled={isDisabled}
            saved={hasSavedPassword && configuration ? { kind: 'webdav-password', id: configuration.id } : undefined}
            onChange={(event) => {
              setPassword(event.currentTarget.value)
              setResult(undefined)
            }}
          />
        )}
      />
      <SettingRow
        label={t('WebDAV connection')}
        description={result?.error ? undefined : result && t('WebDAV connection verified and saved.')}
        disabled={disabled}
        control={
          <div>
            <Button variant="default" size="sm" disabled={disabled || !url.trim()} loading={saving} onClick={save}>
              {t('Test and save')}
            </Button>
            {result?.error && (
              <Text size="xs" c="chatbox-error" mt={6} maw={320}>
                {formatSyncError(result.error, t)}
              </Text>
            )}
          </div>
        }
      />
    </>
  )
}
