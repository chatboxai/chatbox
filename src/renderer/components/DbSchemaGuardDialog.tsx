import { Button, Modal, Progress, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import { useDbSchemaGuardStore } from '@/storage/db-schema-guard'
import { installUpdate, useUpdateStore } from '@/stores/updateStore'

/**
 * Blocking guidance for the two IndexedDB schema-mismatch situations
 * (see docs/technical/storage.md, "IndexedDB 版本策略"):
 * - schema-too-new: the user downgraded across a schema bump; data cannot be
 *   read by this build but is intact — guide them through an in-app update
 *   (the updater runs in the main process and is unaffected).
 * - upgraded-elsewhere: another window/tab bumped the schema while this one
 *   held a connection; a reload picks up the new state.
 */
export default function DbSchemaGuardDialog() {
  const { t, i18n } = useTranslation()
  const schemaTooNewDbName = useDbSchemaGuardStore((s) => s.schemaTooNewDbName)
  const upgradedElsewhereDbName = useDbSchemaGuardStore((s) => s.upgradedElsewhereDbName)
  const upgradeBlockedDbName = useDbSchemaGuardStore((s) => s.upgradeBlockedDbName)

  if (schemaTooNewDbName) {
    return (
      <Modal
        opened
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        title={t('Your data was created by a newer version of Chatbox')}
      >
        <Stack gap="sm">
          <Text size="sm">
            {t(
              'This version of Chatbox cannot read data created by a newer version. Your data is safe — update Chatbox to the latest version to continue.'
            )}
          </Text>
          <UpdateAction language={i18n.language} />
        </Stack>
      </Modal>
    )
  }

  if (upgradeBlockedDbName) {
    // Clears automatically once the other window releases its connection and open succeeds.
    return (
      <Modal
        opened
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        title={t('Waiting for other Chatbox windows')}
      >
        <Text size="sm">{t('Close other Chatbox windows or tabs to finish updating the local database.')}</Text>
      </Modal>
    )
  }

  if (upgradedElsewhereDbName) {
    return (
      <Modal
        opened
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        title={t('Chatbox was updated in another window')}
      >
        <Stack gap="sm">
          <Text size="sm">{t('Reload this page to continue.')}</Text>
          <Button onClick={() => window.location.reload()}>{t('Reload')}</Button>
        </Stack>
      </Modal>
    )
  }

  return null
}

function UpdateAction({ language }: { language: string }) {
  const { t } = useTranslation()
  const status = useUpdateStore((s) => s.status)
  const progress = useUpdateStore((s) => s.progress)
  const error = useUpdateStore((s) => s.error)

  if (platform.type !== 'desktop' || !platform.checkForUpdate) {
    // Web is always served the latest build, so a mismatch there resolves with a
    // reload; other platforms fall back to the download page.
    return (
      <Stack gap="xs">
        <Button onClick={() => window.location.reload()}>{t('Reload')}</Button>
        <Button
          variant="default"
          onClick={() => platform.openLink(buildChatboxUrl(`/redirect_app/check_update/${language}`))}
        >
          {t('Check Update')}
        </Button>
      </Stack>
    )
  }

  switch (status) {
    case 'checking':
      return <Button loading>{t('Checking...')}</Button>
    case 'downloading':
      return (
        <Stack gap="xs">
          <Progress value={progress} animated />
          <Text size="xs" c="dimmed">
            {t('Downloading...')}
          </Text>
        </Stack>
      )
    case 'downloaded':
      return <Button onClick={() => installUpdate()}>{t('Restart & Update')}</Button>
    case 'error':
      return (
        <Stack gap="xs">
          {error && (
            <Text size="xs" c="red">
              {error}
            </Text>
          )}
          <Button onClick={() => checkForUpdateNow()}>{t('Check Update')}</Button>
        </Stack>
      )
    default:
      return <Button onClick={() => checkForUpdateNow()}>{t('Check Update')}</Button>
  }
}

async function checkForUpdateNow() {
  useUpdateStore.setState({ status: 'checking', error: null })
  try {
    const result = await platform.checkForUpdate?.()
    // If check was skipped (another check already in progress), reset UI
    if (result && !result.started && useUpdateStore.getState().status === 'checking') {
      useUpdateStore.setState({ status: 'idle' })
    }
  } catch {
    useUpdateStore.setState({ status: 'idle' })
  }
  // Safety timeout: if still stuck at 'checking' after 30s, reset
  setTimeout(() => {
    if (useUpdateStore.getState().status === 'checking') {
      useUpdateStore.setState({ status: 'idle' })
    }
  }, 30_000)
}
