import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

/** Asks for a folder name; resolves the trimmed name, or `null` when cancelled. */
const SessionFolderName = NiceModal.create((props: { title: string; initialName?: string }) => {
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [name, setName] = useState(props.initialName ?? '')
  const trimmed = name.trim()

  const close = (result: string | null) => {
    modal.resolve(result)
    modal.hide()
  }

  return (
    <AdaptiveModal opened={modal.visible} onClose={() => close(null)} centered title={props.title}>
      <TextInput
        autoFocus={!isSmallScreen}
        aria-label={t('Folder name') || undefined}
        placeholder={t('Folder name') || undefined}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && trimmed) {
            event.preventDefault()
            close(trimmed)
          }
        }}
      />
      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={() => close(null)} />
        <Button disabled={!trimmed} onClick={() => close(trimmed)}>
          {t('Save')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default SessionFolderName
