import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Input } from '@mantine/core'
import type { Folder } from '@shared/types/folder'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { createFolder } from '@/stores/folderStore'

interface CreateFolderModalProps {
  /** Parent folder id, or null/undefined for a top-level folder. */
  parentId?: string | null
  /** Initial value pre-filled into the name input. */
  initialName?: string
}

/**
 * Prompt the user for a folder name, then create the folder via
 * {@link createFolder}. Resolves to the created {@link Folder} (or `undefined`
 * if cancelled) so callers can, e.g., expand the parent and scroll to the new
 * folder.
 *
 * Mirrors the {@link ThreadNameEdit} / {@link ModelEdit} NiceModal + AdaptiveModal
 * pattern used elsewhere in the app. Registered as `create-folder`.
 */
const CreateFolderModal = NiceModal.create((props: CreateFolderModalProps = {}) => {
  const { parentId = null, initialName } = props
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [name, setName] = useState(initialName ?? '')
  const [creating, setCreating] = useState(false)

  // Reset the field whenever the modal is (re)opened.
  useEffect(() => {
    if (modal.visible) {
      setName(initialName ?? '')
    }
  }, [modal.visible, initialName])

  const onClose = useCallback(() => {
    modal.resolve(undefined)
    modal.hide()
  }, [modal])

  const onCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const folder = await createFolder(trimmed, parentId ?? null)
      modal.resolve(folder)
      modal.hide()
    } finally {
      setCreating(false)
    }
  }, [name, creating, parentId, modal])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void onCreate()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [onCreate, onClose]
  )

  return (
    <AdaptiveModal opened={modal.visible} onClose={onClose} centered title={t('New Folder')}>
      <Input
        autoFocus={!isSmallScreen}
        placeholder={t('Folder name') || ''}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        disabled={creating}
      />
      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={onClose} />
        <Button onClick={onCreate} loading={creating} disabled={!name.trim()}>
          {t('Create')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default CreateFolderModal
