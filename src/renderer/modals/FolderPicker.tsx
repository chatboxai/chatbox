import NiceModal, { useModal } from '@ebay/nice-modal-react'
import type { SessionFolder } from '@shared/types'
import { Button, Flex, Text, UnstyledButton } from '@mantine/core'
import { IconCheck, IconFolder, IconFolderPlus, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { getCachedSessionsMeta, moveSessionToFolder, useFolders } from '@/stores/chatStore'

const FolderPicker = NiceModal.create((props: { sessionId: string }) => {
  const modal = useModal()
  const { t } = useTranslation()
  const { folders } = useFolders()
  const currentFolderId = getCachedSessionsMeta().find((s) => s.id === props.sessionId)?.folderId

  const close = () => {
    modal.resolve(undefined)
    modal.hide()
  }

  const moveTo = async (folderId: string | null) => {
    await moveSessionToFolder(props.sessionId, folderId)
    close()
  }

  const createAndMove = async () => {
    const folder = await NiceModal.show<SessionFolder | undefined>('folder-settings', { mode: 'create' })
    if (folder) {
      await moveSessionToFolder(props.sessionId, folder.id)
    }
    close()
  }

  return (
    <AdaptiveModal opened={modal.visible} onClose={close} centered title={t('Move to Folder')}>
      <Flex direction="column" gap={2} mah="50vh" style={{ overflowY: 'auto' }}>
        {currentFolderId && (
          <UnstyledButton
            onClick={() => void moveTo(null)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-chatbox-background-gray-secondary"
          >
            <ScalableIcon icon={IconX} size={16} className="shrink-0 text-chatbox-tertiary" />
            <Text span size="sm" c="chatbox-secondary">
              {t('Remove from Folder')}
            </Text>
          </UnstyledButton>
        )}
        {folders.map((folder) => (
          <UnstyledButton
            key={folder.id}
            onClick={() => void moveTo(folder.id)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-chatbox-background-gray-secondary"
          >
            <ScalableIcon icon={IconFolder} size={16} className="shrink-0 text-chatbox-tertiary" />
            <Text span size="sm" lineClamp={1} flex={1} c="chatbox-primary">
              {folder.name}
            </Text>
            <Flex
              w={20}
              justify="center"
              className={clsx(folder.id === currentFolderId ? 'flex' : 'hidden')}
              aria-hidden
            >
              {folder.id === currentFolderId && (
                <ScalableIcon icon={IconCheck} size={16} className="text-chatbox-brand" />
              )}
            </Flex>
          </UnstyledButton>
        ))}
        {folders.length === 0 && (
          <Text size="sm" c="chatbox-tertiary" px={8} py={4}>
            {t('No folders yet. Create one to group your conversations.')}
          </Text>
        )}
      </Flex>
      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={close} />
        <Button
          variant="light"
          leftSection={<ScalableIcon icon={IconFolderPlus} size={16} />}
          onClick={createAndMove}
        >
          {t('New Folder')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default FolderPicker
