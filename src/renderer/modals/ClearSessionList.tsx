import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Flex, Input } from '@mantine/core'
import { type ChangeEvent, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Modal } from '@/components/Overlay'
import { trackingEvent } from '@/packages/event'
import { clearConversationList } from '@/stores/sessionActions'

const ClearSessionList = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()
  const [value, setValue] = useState(100)
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const int = parseInt(event.target.value || '0')
    if (int >= 0) {
      setValue(int)
    }
  }

  useEffect(() => {
    trackingEvent('clear_conversation_list_window', { event_category: 'screen_view' })
  }, [])

  const clean = () => {
    clearConversationList(value)
    trackingEvent('clear_conversation_list', { event_category: 'user' })
    handleClose()
  }

  const handleClose = () => {
    modal.resolve()
    modal.hide()
  }

  return (
    <Modal
      opened={modal.visible}
      onClose={() => {
        modal.resolve()
        modal.hide()
      }}
      centered
      title={t('Clear Conversation List')}
    >
      <Trans
        i18nKey="Keep only the Top <input /> Conversations in List and Permanently Delete the Rest"
        values={{ n: value }}
        components={{
          input: (
            <Input
              key={'0'}
              value={value}
              onChange={handleInput}
              className=" inline-block w-14"
              classNames={{ input: '!border-0 !border-b !rounded-none !bg-transparent' }}
            />
          ),
        }}
      />

      <Flex gap="md" mt="md" justify="flex-end" align="center">
        <Button onClick={handleClose} color="chatbox-gray" variant="light">
          {t('cancel')}
        </Button>
        <Button onClick={clean} color="chatbox-error">
          {t('clean it up')}
        </Button>
      </Flex>
    </Modal>
  )
})

export default ClearSessionList
