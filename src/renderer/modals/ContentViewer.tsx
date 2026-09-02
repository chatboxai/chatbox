import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Flex, Loader, Text } from '@mantine/core'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useBlob } from '@/hooks/useBlob'
import { useCopied } from '@/hooks/useCopied'

interface ContentViewerProps {
  title?: string
  content?: string
  storageKey?: string
  // 附件元信息（解析器、索引状态等）。label 省略时整条 value 自描述（如“解析器: MinerU”）。
  metadata?: Array<{ label?: string; value: string }>
}

const ContentViewer = NiceModal.create(
  ({ title, content: directContent, storageKey, metadata }: ContentViewerProps) => {
    const modal = useModal()
    const { t } = useTranslation()

    const { data: blobData, isLoading: isBlobLoading } = useBlob(
      modal.visible && !directContent ? storageKey : undefined
    )
    const loadedContent = blobData || ''
    const isLoading = !directContent && !!storageKey && isBlobLoading

    const content = directContent ?? loadedContent ?? ''
    const needsLoading = isLoading

    const onClose = () => {
      modal.resolve()
      modal.hide()
    }

    const { copied, copy: onCopy } = useCopied(content)

    return (
      <AdaptiveModal opened={modal.visible} onClose={onClose} size="lg" centered title={title || t('Content')}>
        {metadata && metadata.length > 0 && (
          <div className="mb-sm flex flex-col gap-0.5">
            {metadata.map((m) => (
              <Text
                key={m.label ? `${m.label}:${m.value}` : m.value}
                size="sm"
                c="dimmed"
                style={{ overflowWrap: 'anywhere' }}
              >
                {m.label ? `${m.label}: ${m.value}` : m.value}
              </Text>
            ))}
          </div>
        )}
        {needsLoading ? (
          <Flex justify="center" align="center" className="min-h-[200px]">
            <Loader />
          </Flex>
        ) : content ? (
          <div className="bg-chatbox-background-secondary border border-solid border-chatbox-border-secondary rounded-lg max-h-[60vh] overflow-y-auto p-sm">
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
          <div className="bg-chatbox-background-secondary border border-solid border-chatbox-border-secondary rounded-lg p-sm">
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
  }
)

export default ContentViewer
