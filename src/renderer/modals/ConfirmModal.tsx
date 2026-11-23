import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Checkbox, Text } from '@mantine/core'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'

export interface ConfirmModalProps {
  signal?: AbortSignal
  title: string
  message: ReactNode
  confirmText?: string
  cancelText?: string
  /** Runs inside the button click so browser APIs can retain the user gesture. */
  onConfirm?(): void
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
  ({ title, message, confirmText, cancelText, danger, dontShowAgainText, onConfirm, signal }: ConfirmModalProps) => {
    const modal = useModal()
    const { t } = useTranslation()
    const [dontShowAgain, setDontShowAgain] = useState(false)

    useEffect(() => {
      if (modal.visible) {
        setDontShowAgain(false)
      }
    }, [modal.visible])

    useEffect(() => {
      if (!signal) return
      const cancel = () => {
        modal.resolve(false)
        void modal.hide()
      }
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
      return () => signal.removeEventListener('abort', cancel)
    }, [signal, modal.resolve, modal.hide])

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
          {cancelText ? (
            <Button color="chatbox-gray" variant="light" onClick={() => close(false)}>
              {cancelText}
            </Button>
          ) : (
            <AdaptiveModal.CloseButton onClick={() => close(false)}>{t('Cancel')}</AdaptiveModal.CloseButton>
          )}
          <Button
            color={danger ? 'chatbox-error' : undefined}
            onClick={() => {
              onConfirm?.()
              close(true)
            }}
          >
            {confirmText || t('Confirm')}
          </Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>
    )
  }
)

export default ConfirmModal
