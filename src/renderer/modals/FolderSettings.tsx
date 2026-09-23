import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Input } from '@mantine/core'
import type { SessionFolder } from '@shared/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { createFolder, renameFolder } from '@/stores/sessionFolders'

type FolderSettingsModalProps = {
  mode: 'create' | 'rename'
  folder?: SessionFolder
}

const FolderSettings = NiceModal.create((props: FolderSettingsModalProps) => {
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [name, setName] = useState(props.folder?.name ?? '')
  // NiceModal keeps this component mounted across show() calls, so the input
  // must be re-derived when the modal targets a different folder — a useState
  // initializer alone would keep the previous folder's name in the box. Create
  // mode passes no folder, so create/rename switches also land here.
  useEffect(() => {
    setName(props.folder?.name ?? '')
  }, [props.folder])
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
