import { directoryFolderName, findDirectoryFolder, normalizeWorkingDirectory } from '@chatbox/core/application/session'
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Flex, Stack, Text, TextInput } from '@mantine/core'
import type { SessionFolder } from '@shared/types'
import { IconFolder, IconFolderPlus, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ICON_SIZE, IconButton } from '@/components/common/IconButton'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { supportsWorkingDirectories } from '@/components/InputBox/useAgentModeSettingsState'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'
import { createSessionFolder } from '@/stores/session/folders'
import * as toastActions from '@/stores/toastActions'

const useSessionFolders = () => rendererApplication.sessionHooks.useSessionFolders()

/**
 * Creates a project; resolves the project, or `null` when cancelled. On desktop
 * a source folder can be attached, and the name then defaults to its basename.
 */
const SessionFolderCreate = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const { folders } = useSessionFolders()
  const [name, setName] = useState('')
  const [directory, setDirectory] = useState<string>()
  const [creating, setCreating] = useState(false)
  const canPickDirectory = supportsWorkingDirectories()
  const trimmed = name.trim()
  const existing = findDirectoryFolder(folders ?? [], directory)
  const canCreate = !creating && (Boolean(trimmed) || directory !== undefined)

  const close = (result: SessionFolder | null) => {
    modal.resolve(result)
    modal.hide()
  }

  const pickDirectory = async () => {
    const result = await platform.openDirectoryDialog?.()
    if (!result || result.canceled || !result.path) return
    setDirectory(normalizeWorkingDirectory(result.path))
  }

  const create = async () => {
    if (!canCreate) return
    setCreating(true)
    try {
      close(await createSessionFolder(trimmed, directory))
    } catch (error) {
      console.error('Failed to create project:', error)
      toastActions.add(t('Failed to create project. Please try again.') || '')
      setCreating(false)
    }
  }

  return (
    <AdaptiveModal
      opened={modal.visible}
      onClose={() => close(null)}
      onExitTransitionEnd={modal.remove}
      centered
      title={t('New project')}
    >
      <Stack gap="md">
        <TextInput
          autoFocus={!isSmallScreen}
          aria-label={t('Project name') || undefined}
          placeholder={
            directory !== undefined && !existing
              ? directoryFolderName(directory, folders ?? [])
              : t('Project name') || undefined
          }
          leftSection={<ScalableIcon icon={IconFolder} size={16} />}
          value={existing ? existing.name : name}
          disabled={Boolean(existing)}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void create()
            }
          }}
        />
        {canPickDirectory && (
          <Stack gap={6}>
            <Text size="sm" fw={500}>
              {t('Source folder')}
            </Text>
            {directory === undefined ? (
              <Stack
                align="center"
                gap="xs"
                py="md"
                px="sm"
                className="rounded-md border border-solid border-chatbox-border-primary"
              >
                <Text size="sm" c="chatbox-tertiary" ta="center">
                  {t('Work Mode chats in this folder are added to the project automatically.')}
                </Text>
                <Button
                  variant="light"
                  color="chatbox-gray"
                  size="compact-sm"
                  leftSection={<ScalableIcon icon={IconFolderPlus} size={16} />}
                  onClick={() => void pickDirectory()}
                >
                  {t('Add')}
                </Button>
              </Stack>
            ) : (
              <Stack gap={4}>
                <Flex
                  align="center"
                  gap="xs"
                  pl="sm"
                  pr={4}
                  py={6}
                  className="rounded-md border border-solid border-chatbox-border-primary"
                >
                  <ScalableIcon icon={IconFolder} size={16} className="shrink-0 text-chatbox-secondary" />
                  <Text size="sm" className="min-w-0 flex-1 truncate" title={directory}>
                    {directory}
                  </Text>
                  <IconButton
                    icon={IconX}
                    size="sm"
                    iconSize={ICON_SIZE.inline}
                    color="chatbox-tertiary"
                    aria-label={t('Remove')}
                    onClick={() => setDirectory(undefined)}
                  />
                </Flex>
                {existing && (
                  <Text size="xs" c="chatbox-tertiary">
                    {t('This folder already belongs to the project “{{name}}”.', { name: existing.name })}
                  </Text>
                )}
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={() => close(null)} />
        <Button disabled={!canCreate} loading={creating} onClick={() => void create()}>
          {existing ? t('Show project') : t('Create project')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default SessionFolderCreate
