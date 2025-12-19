import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { ActionIcon, Button, CopyButton, Flex, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { IconCheck, IconCopy, IconExternalLink } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/Overlay'

export interface EdgeOneDeploySuccessProps {
  url: string
}

const EdgeOneDeploySuccess = NiceModal.create(({ url }: EdgeOneDeploySuccessProps) => {
  const modal = useModal()
  const { t } = useTranslation()

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  return (
    <Modal opened={modal.visible} onClose={onClose} centered title={t('Webpage Published')}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t('Your HTML content has been published. You can access it via the link below.')}
        </Text>
        <Flex gap="xs">
          <TextInput
            value={url}
            readOnly
            className="flex-1"
            rightSection={
              <CopyButton value={url} timeout={2000}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? t('Copied') : t('Copy')} withArrow position="right">
                    <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy}>
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            }
          />
          <Button
            component="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            leftSection={<IconExternalLink size={16} />}
            color="blue"
            variant="filled"
          >
            {t('Open')}
          </Button>
        </Flex>
        <Flex justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            {t('Close')}
          </Button>
        </Flex>
      </Stack>
    </Modal>
  )
})

export default EdgeOneDeploySuccess
