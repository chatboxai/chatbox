import { isActionAvailableInMode, type SessionMode } from '@chatbox/core/session/mode-policy'
import type { PromptCacheDeleteTarget } from '@chatbox/core/session/prompt-cache-policy'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Button, Checkbox, Collapse, Flex, Group, Stack, Text } from '@mantine/core'
import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { IconChevronDown, IconChevronUp, IconPencil, IconTrash } from '@tabler/icons-react'
import { type FC, memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from '@/components/Markdown'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { dismissPromptCacheBreakConfirm, isPromptCacheBreakConfirmDismissed } from '@/utils/prompt-cache-confirm'
import { ScalableIcon } from '../common/ScalableIcon'
import { Modal } from '../layout/Overlay'

interface SummaryMessageProps {
  msg: Message
  className?: string
  isLatestSummary?: boolean
  onDelete?: () => void
  sessionId: string
  highlighted?: boolean
  /** Resolved by the list container; both modes keep latest-summary edit and delete. */
  sessionMode?: SessionMode
  /** Resolve prompt-cache delete policy when the delete dialog opens. */
  shouldConfirmPromptCacheDelete?: (messageId: string, target: PromptCacheDeleteTarget) => boolean
}

const SummaryMessage: FC<SummaryMessageProps> = ({
  msg,
  className,
  isLatestSummary,
  onDelete,
  sessionId,
  highlighted = false,
  sessionMode = 'chat',
  shouldConfirmPromptCacheDelete,
}) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [explainPromptCacheBreak, setExplainPromptCacheBreak] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const enableMarkdownRendering = useSettingsStore((state) => state.enableMarkdownRendering)
  const enableLaTeXRendering = useSettingsStore((state) => state.enableLaTeXRendering)
  const enableMermaidRendering = useSettingsStore((state) => state.enableMermaidRendering)

  const summaryText = getMessageText(msg)

  const canDeleteSummary = onDelete !== undefined && isActionAvailableInMode('delete-message', sessionMode)

  const handleConfirmDelete = () => {
    if (explainPromptCacheBreak && dontShowAgain) {
      dismissPromptCacheBreakConfirm('delete-summary')
    }
    setShowDeleteConfirm(false)
    setDontShowAgain(false)
    onDelete?.()
  }

  const handleDeleteClick = () => {
    const shouldExplain =
      !isPromptCacheBreakConfirmDismissed('delete-summary') &&
      shouldConfirmPromptCacheDelete?.(msg.id, 'summary') === true
    setExplainPromptCacheBreak(shouldExplain)
    setDontShowAgain(false)
    setShowDeleteConfirm(true)
  }

  const handleEdit = useCallback(() => {
    void NiceModal.show('message-edit', { sessionId, msg, hideSaveAndResend: true })
  }, [sessionId, msg])

  useEffect(() => {
    if (highlighted) {
      setExpanded(true)
    }
  }, [highlighted])

  const summaryBadge = (
    <Flex
      align="center"
      gap="xxs"
      className="cursor-pointer select-none px-3 py-1 rounded-full bg-chatbox-background-secondary hover:bg-chatbox-background-secondary-hover transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <ActionIcon variant="transparent" size="xs" c="chatbox-tertiary" p={0}>
        <ScalableIcon icon={expanded ? IconChevronUp : IconChevronDown} size={14} />
      </ActionIcon>
      <Text size="xs" c="chatbox-tertiary" className="whitespace-nowrap">
        {t('Earlier messages summarized')}
      </Text>
    </Flex>
  )

  return (
    <div
      className={cn(
        'w-full py-4 group/summary rounded-xl transition-colors duration-500',
        highlighted && 'bg-chatbox-background-brand-secondary',
        className
      )}
    >
      <Flex align="center" gap="xs" className="w-full">
        <div className="flex-1 h-px bg-chatbox-border-primary" />
        {summaryBadge}
        <div className="flex-1 h-px bg-chatbox-border-primary" />
      </Flex>

      <Collapse in={expanded}>
        <div className="msg-block mt-3 mx-4 p-3 rounded-lg bg-chatbox-background-secondary border border-solid border-chatbox-border-primary">
          {enableMarkdownRendering ? (
            <Markdown
              uniqueId={`summary-${msg.id}`}
              sessionId={sessionId}
              enableLaTeXRendering={enableLaTeXRendering}
              enableMermaidRendering={enableMermaidRendering}
            >
              {summaryText}
            </Markdown>
          ) : (
            <Text size="sm" c="chatbox-secondary" className="whitespace-pre-wrap">
              {summaryText}
            </Text>
          )}

          {isLatestSummary && (
            <Flex gap={0} mt="xs" className="opacity-0 group-hover/summary:opacity-100 transition-opacity">
              <Tooltip label={t('Edit')} openDelay={1000} withArrow>
                <ActionIcon
                  variant="subtle"
                  w="auto"
                  h="auto"
                  miw="auto"
                  mih="auto"
                  p={4}
                  bd={0}
                  color="chatbox-secondary"
                  onClick={handleEdit}
                >
                  <ScalableIcon icon={IconPencil} size={16} />
                </ActionIcon>
              </Tooltip>
              {canDeleteSummary && (
                <Tooltip label={t('Delete')} openDelay={1000} withArrow>
                  <ActionIcon
                    variant="subtle"
                    w="auto"
                    h="auto"
                    miw="auto"
                    mih="auto"
                    p={4}
                    bd={0}
                    color="chatbox-error"
                    onClick={handleDeleteClick}
                  >
                    <ScalableIcon icon={IconTrash} size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Flex>
          )}
        </div>
      </Collapse>

      <Modal
        opened={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title={t('Delete Summary')}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">{t('Deleting this summary will restore original messages to context calculation.')}</Text>
          {explainPromptCacheBreak && (
            <>
              <Text size="sm">
                {t(
                  "It will also invalidate the model's cached context, so the next reply may cost more and take longer."
                )}
              </Text>
              <Checkbox
                label={t("Don't show again")}
                checked={dontShowAgain}
                onChange={(event) => setDontShowAgain(event.currentTarget.checked)}
              />
            </>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setShowDeleteConfirm(false)}>
              {t('Cancel')}
            </Button>
            <Button color="red" onClick={handleConfirmDelete}>
              {t('Delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}

export default memo(SummaryMessage)
