import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Input } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { type ChangeEvent, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { trackingEvent } from '@/packages/event'
import { clearConversationList } from '@/stores/session/crud'

const ClearSessionList = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()
  const [value, setValue] = useState(100)
  const [cleaning, setCleaning] = useState(false)
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const int = parseInt(event.target.value || '0')
    if (int >= 0) {
      setValue(int)
    }
  }

  useEffect(() => {
    trackingEvent('clear_conversation_list_window', { event_category: 'screen_view' })
  }, [])

  const clean = async () => {
    if (cleaning) return
    setCleaning(true)
    try {
      await clearConversationList(value)
      trackingEvent('clear_conversation_list', { event_category: 'user' })
      handleClose()
    } finally {
      setCleaning(false)
    }
  }

  const handleClose = () => {
    modal.resolve()
    modal.hide()
  }

  return (
    <AdaptiveModal
      opened={modal.visible}
      onClose={() => {
        modal.resolve()
        modal.hide()
      }}
      centered
      title={t('Clear Conversation List')}
    >
      <div>
        <Trans
          i18nKey="Keep only the Top <input /> Conversations in List and Archive the Rest"
          values={{ n: value }}
          components={{
            input: (
              <Input
                key={'0'}
                data-testid={TestId.settings.clearSessionListKeep}
                value={value}
                onChange={handleInput}
                className="inline-block w-[4em]"
                classNames={{ input: '!border-0 !border-b !rounded-none !bg-transparent !text-center' }}
              />
            ),
          }}
        />
      </div>

      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={handleClose} />
        <Button data-testid={TestId.settings.clearSessionListConfirm} onClick={clean} loading={cleaning}>
          {t('Archive')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default ClearSessionList
