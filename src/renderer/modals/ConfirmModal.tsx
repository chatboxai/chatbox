import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Checkbox, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'

export interface ConfirmModalProps {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  /** Style the confirm button as a destructive action. */
  danger?: boolean
  /** When set, show a "don't show again" checkbox and resolve an object on confirm. */
  dontShowAgainText?: string
}

export type ConfirmModalResult = boolean | { confirmed: true; dontShowAgain: boolean }

/**
 * Generic confirmation dialog. Resolves `true` when the user confirms, `false` when
 * they cancel or dismiss it. With `dontShowAgainText`, a confirmed choice resolves
 * `{ confirmed: true, dontShowAgain }`. Use via `await NiceModal.show('confirm', props)`.
 */
const ConfirmModal = NiceModal.create(
  ({ title, message, confirmText, cancelText, danger, dontShowAgainText }: ConfirmModalProps) => {
    const modal = useModal()
    const { t } = useTranslation()
    const [dontShowAgain, setDontShowAgain] = useState(false)

    useEffect(() => {
      if (modal.visible) {
        setDontShowAgain(false)
      }
    }, [modal.visible])

    const close = (confirmed: boolean) => {
      const result: ConfirmModalResult = confirmed && dontShowAgainText ? { confirmed: true, dontShowAgain } : confirmed
      modal.resolve(result)
      modal.hide()
    }

    return (
      <AdaptiveModal opened={modal.visible} onClose={() => close(false)} centered title={title}>
        <Text size="sm" c="chatbox-secondary" style={{ whiteSpace: 'pre-wrap' }}>
          {message}
        </Text>

        {dontShowAgainText && (
          <Checkbox
            mt="md"
            label={dontShowAgainText}
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.currentTarget.checked)}
          />
        )}

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={() => close(false)}>
            {cancelText || t('Cancel')}
          </AdaptiveModal.CloseButton>
          <Button color={danger ? 'chatbox-error' : undefined} onClick={() => close(true)}>
            {confirmText || t('Confirm')}
          </Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>
    )
  }
)

export default ConfirmModal
