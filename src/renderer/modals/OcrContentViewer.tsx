import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Flex, Text } from '@mantine/core'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/Overlay'
import { ScalableIcon } from '@/components/ScalableIcon'
import { useCopied } from '@/hooks/useCopied'

interface OcrContentViewerProps {
  content: string
}

const OcrContentViewer = NiceModal.create(({ content }: OcrContentViewerProps) => {
  const modal = useModal()
  const { t } = useTranslation()

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  const { copied, copy: onCopy } = useCopied(content)

  return (
    <Modal opened={modal.visible} onClose={onClose} size="lg" centered title={t('OCR Text Content')}>
      <div className=" bg-chatbox-background-secondary border border-solid border-chatbox-border-secondary rounded-xs max-h-[60vh] overflow-y-auto p-sm">
        <Text
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'monospace',
          }}
        >
          {content}
        </Text>
      </div>

      <Flex gap="md" mt="md" justify="flex-end" align="center">
        <Button
          onClick={onCopy}
          variant="light"
          leftSection={<ScalableIcon size={16} icon={copied ? IconCheck : IconCopy} />}
        >
          {t('copy')}
        </Button>
        <Button onClick={onClose} color="chatbox-gray" variant="light">
          {t('close')}
        </Button>
      </Flex>
    </Modal>
  )
})

export default OcrContentViewer
