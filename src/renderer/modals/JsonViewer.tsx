import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Flex, Text } from '@mantine/core'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/Overlay'
import { ScalableIcon } from '@/components/ScalableIcon'
import { useCopied } from '@/hooks/useCopied'

interface JsonViewerProps {
  title: string
  data: unknown
}

const JsonViewer = NiceModal.create(({ title, data }: JsonViewerProps) => {
  const modal = useModal()
  const { t } = useTranslation()
  const prettyJson = useMemo(() => JSON.stringify(data, null, 2), [data])
  const { copied, copy } = useCopied(prettyJson)

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  return (
    <Modal opened={modal.visible} onClose={onClose} size="xl" centered title={title}>
      <div className="bg-chatbox-background-secondary border border-solid border-chatbox-border-secondary rounded-xs max-h-[60vh] overflow-y-auto p-sm">
        <Text
          component="pre"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
          }}
        >
          {prettyJson}
        </Text>
      </div>

      <Flex gap="md" mt="md" justify="flex-end" align="center">
        <Button
          onClick={copy}
          variant="light"
          leftSection={<ScalableIcon size={16} icon={copied ? IconCheck : IconCopy} />}
        >
          {copied ? t('copied to clipboard') : t('copy')}
        </Button>
        <Button onClick={onClose} color="chatbox-gray" variant="light">
          {t('close')}
        </Button>
      </Flex>
    </Modal>
  )
})

export default JsonViewer
