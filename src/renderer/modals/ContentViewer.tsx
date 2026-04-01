import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Flex, Loader, Text } from '@mantine/core'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useCopied } from '@/hooks/useCopied'
import storage from '@/storage'

interface ContentViewerProps {
  title?: string
  content?: string
  storageKey?: string
}

const ContentViewer = NiceModal.create(({ title, content: directContent, storageKey }: ContentViewerProps) => {
  const modal = useModal()
  const { t } = useTranslation()

  // 如果提供了 storageKey，则异步加载内容；否则直接使用 content
  const { data: loadedContent, isLoading } = useQuery({
    queryKey: ['content-viewer', storageKey],
    queryFn: async () => {
      if (!storageKey) return ''
      const blob = await storage.getBlob(storageKey)
      return blob || ''
    },
    enabled: modal.visible && !!storageKey,
  })

  const content = directContent ?? loadedContent ?? ''
  const needsLoading = !!storageKey && isLoading

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  const { copied, copy: onCopy } = useCopied(content)

  return (
    <AdaptiveModal opened={modal.visible} onClose={onClose} size="lg" centered title={title || t('Content')}>
      {needsLoading ? (
        <Flex justify="center" align="center" className="min-h-[200px]">
          <Loader />
        </Flex>
      ) : content ? (
        <div className="bg-chatbox-background-secondary border border-solid border-chatbox-border-secondary rounded-xs max-h-[60vh] overflow-y-auto p-sm">
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
      ) : (
        <div className="bg-chatbox-background-secondary border border-solid border-chatbox-border-secondary rounded-xs p-sm">
          <Text c="dimmed">{t('No content available')}</Text>
        </div>
      )}

      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={onClose} />
        <Button
          onClick={onCopy}
          variant="light"
          disabled={!content}
          leftSection={<ScalableIcon size={16} icon={copied ? IconCheck : IconCopy} />}
        >
          {t('Copy')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default ContentViewer
