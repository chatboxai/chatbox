import NiceModal, { useModal } from '@ebay/nice-modal-react'
import type { SessionFolder } from '@shared/types'
import { Button, Input } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { createFolder, renameFolder } from '@/stores/chatStore'

type FolderSettingsModalProps = {
  mode: 'create' | 'rename'
  folder?: SessionFolder
}

const FolderSettings = NiceModal.create((props: FolderSettingsModalProps) => {
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [name, setName] = useState(props.folder?.name ?? '')
  const [saving, setSaving] = useState(false)

  const title = props.mode === 'create' ? t('New Folder') : t('Rename Folder')

  const close = () => {
    modal.resolve(undefined)
    modal.hide()
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      if (props.mode === 'create') {
        const folder = await createFolder(trimmed)
        modal.resolve(folder)
      } else if (props.folder) {
        await renameFolder(props.folder.id, trimmed)
        modal.resolve(undefined)
      }
      modal.hide()
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdaptiveModal opened={modal.visible} onClose={close} centered title={title}>
      <Input
        autoFocus={!isSmallScreen}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        placeholder={t('Folder Name')}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            void save()
          }
        }}
      />
      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={close} />
        <Button onClick={save} loading={saving} disabled={!name.trim()}>
          {t('Save')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default FolderSettings
