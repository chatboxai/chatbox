import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Stack, Text } from '@mantine/core'
import { IconFolder, IconFolderOff, IconFolderPlus } from '@tabler/icons-react'
import clsx from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { createSessionFolder, moveSessionToFolder } from '@/stores/session/folders'
import * as toastActions from '@/stores/toastActions'

const useSessionFolders = () => rendererApplication.sessionHooks.useSessionFolders()

/** Picks the folder a session is filed in, including "no folder" and a new folder. */
const SessionFolderMove = NiceModal.create((props: { sessionId: string; folderId?: string }) => {
  const modal = useModal()
  const { t } = useTranslation()
  const { folders } = useSessionFolders()
  const [moving, setMoving] = useState(false)
  const currentFolderId = folders?.some((folder) => folder.id === props.folderId) ? props.folderId : undefined

  const close = () => {
    modal.resolve()
    modal.hide()
  }

  const move = async (folderId: string | undefined) => {
    if (moving) return
    // Compare with the stored value: "No folder" still clears a deleted folder's id.
    if (folderId === (props.folderId || undefined)) {
      close()
      return
    }
    setMoving(true)
    try {
      await moveSessionToFolder(props.sessionId, folderId)
      close()
    } catch (error) {
      console.error('Failed to move session to folder:', error)
      toastActions.add(t('Failed to move chat. Please try again.') || '')
    } finally {
      setMoving(false)
    }
  }

  const createAndMove = async () => {
    const name = await NiceModal.show<string | null>('session-folder-name', { title: t('New folder') })
    if (!name) return
    const folder = await createSessionFolder(name)
    if (folder) await move(folder.id)
  }

  const option = (key: string, label: string, icon: typeof IconFolder, selected: boolean, onClick: () => void) => (
    <Button
      key={key}
      variant={selected ? 'light' : 'subtle'}
      color={selected ? 'chatbox-brand' : 'chatbox-primary'}
      justify="flex-start"
      fullWidth
      disabled={moving}
      aria-pressed={selected}
      leftSection={<ScalableIcon icon={icon} size={16} />}
      onClick={onClick}
    >
      <Text span size="sm" lineClamp={1} className={clsx(selected && 'font-semibold')}>
        {label}
      </Text>
    </Button>
  )

  return (
    <AdaptiveModal opened={modal.visible} onClose={close} centered title={t('Move to folder')}>
      <Stack gap={2}>
        {option('none', t('No folder'), IconFolderOff, currentFolderId === undefined, () => void move(undefined))}
        {(folders ?? []).map((folder) =>
          option(folder.id, folder.name, IconFolder, folder.id === currentFolderId, () => void move(folder.id))
        )}
        {option('new', t('New folder'), IconFolderPlus, false, () => void createAndMove())}
      </Stack>
      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={close} />
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default SessionFolderMove
