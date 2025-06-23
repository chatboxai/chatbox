import { AIModelProviderMenuOptionList } from '@/packages/models'
import NiceModal, { muiDialogV5, useModal } from '@ebay/nice-modal-react'
import { Box, Dialog, DialogContent, List, ListItem, ListItemButton, ListItemText } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { ModelProvider, ModelProviderEnum } from '../../shared/types'

const ProviderSelector = NiceModal.create(() => {
  const { t } = useTranslation()
  const modal = useModal()

  const onSetup = (provider: ModelProvider) => {
    modal.resolve(provider)
    modal.hide()
  }

  return (
    <Dialog
      {...muiDialogV5(modal)}
      onClose={() => {
        modal.resolve()
        modal.hide()
      }}
      maxWidth="xs"
      fullWidth
    >
      <DialogContent>
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <p className="text-sm text-gray-600 dark:text-gray-300 m-0">
            {t('Select and configure an AI model provider')}
          </p>
        </Box>
        <List sx={{ width: '100%' }}>
          {AIModelProviderMenuOptionList.map((provider) => (
            <ListItem key={provider.value} disablePadding>
              <ListItemButton
                onClick={() => onSetup(provider.value)}
                sx={{
                  borderRadius: '8px',
                  mb: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <ListItemText
                  primary={provider.label}
                  primaryTypographyProps={{
                    fontWeight: 600,
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
          <ListItem key={'custom'} disablePadding>
            <ListItemButton
              onClick={() => onSetup(ModelProviderEnum.Custom)}
              sx={{
                borderRadius: '8px',
                mb: 1,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <ListItemText
                primary={t('Add Custom Provider')}
                primaryTypographyProps={{
                  fontWeight: 600,
                }}
              />
            </ListItemButton>
          </ListItem>
        </List>
      </DialogContent>
    </Dialog>
  )
})

export default ProviderSelector
