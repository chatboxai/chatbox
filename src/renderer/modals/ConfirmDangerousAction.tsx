import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'

interface Props {
  type: string
  description: string
}

const COUNTDOWN_SECONDS = 5
const ENABLE_AFTER_SECONDS = 1

const ConfirmDangerousAction = NiceModal.create(({ description }: Props) => {
  const modal = useModal()
  const { t } = useTranslation()
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)

  useEffect(() => {
    if (!modal.visible) return
    setSecondsLeft(COUNTDOWN_SECONDS)
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [modal.visible])

  const onCancel = () => {
    modal.resolve(false)
    modal.hide()
  }

  const onConfirm = () => {
    modal.resolve(true)
    modal.hide()
  }

  const elapsed = COUNTDOWN_SECONDS - secondsLeft
  const disabled = elapsed < ENABLE_AFTER_SECONDS
  const confirmLabel = secondsLeft > 0 ? t('Confirm ({{seconds}})', { seconds: secondsLeft }) : t('Confirm')

  return (
    <AdaptiveModal
      opened={modal.visible}
      onClose={onCancel}
      size="md"
      centered
      title={t('Confirm dangerous action')}
    >
      <Stack gap="xs">
        <Text>{description}</Text>
        <Text size="sm" c="chatbox-tertiary">
          {t('This action cannot be undone.')}
        </Text>
      </Stack>

      <AdaptiveModal.Actions>
        <Button variant="default" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button color="chatbox-error" onClick={onConfirm} disabled={disabled}>
          {confirmLabel}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default ConfirmDangerousAction
