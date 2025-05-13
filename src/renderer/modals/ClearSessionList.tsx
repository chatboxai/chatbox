import NiceModal, { muiDialogV5, useModal } from '@ebay/nice-modal-react'
import { Button, Dialog, DialogContent, DialogActions, DialogTitle, Typography, Box } from '@mui/material'
import { useTranslation, Trans } from 'react-i18next'
import { useState, useEffect } from 'react'
import { Input } from '@mui/material'
import * as sessionActions from '../stores/sessionActions'
import { trackingEvent } from '@/packages/event'

const ClearSessionList = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()
  const [value, setValue] = useState(10)

  const handleClose = () => {
    modal.resolve()
    modal.hide()
  }

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(event.target.value)
    if (!isNaN(newValue) && newValue > 0) {
      setValue(newValue)
    }
  }

  const clean = () => {
    sessionActions.clearConversationList(value)
    trackingEvent('clear_conversation_list', { event_category: 'user' })
    handleClose()
  }

  useEffect(() => {
    trackingEvent('clear_conversation_list_window', { event_category: 'screen_view' })
  }, [])

  return (
    <Dialog
      {...muiDialogV5(modal)}
      onClose={() => {
        modal.resolve()
        modal.hide()
      }}
    >
      <DialogTitle>{t('Clear Conversation List')}</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body1">
            <Trans
              i18nKey="Keep only the Top N Conversations in List and Permanently Delete the Rest"
              values={{ n: value }}
            />
          </Typography>
          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2">{t('Number of conversations to keep:')}</Typography>
            <Input
              value={value}
              onChange={handleInput}
              className="w-14"
              inputProps={{ style: { textAlign: 'center' } }}
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('cancel')}</Button>
        <Button onClick={clean} color="error">
          {t('clean it up')}
        </Button>
      </DialogActions>
    </Dialog>
  )
})

export default ClearSessionList
