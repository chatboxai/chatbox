import { ActionIcon, Button, Flex, Modal, Text } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { IconX } from '@tabler/icons-react'
import { type FC, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from '@/components/Markdown'
import { useSettingsStore } from '@/stores/settingsStore'
import '../../static/Block.css'
import { cn } from '@/lib/utils'
import { ScalableIcon } from '../common/ScalableIcon'
import { getMessageRoleClass } from './message-role-class'

/** Scroll offset that brings the pressed point of the message near the top third of the page. */
export function getSelectTextScrollTop(ratio: number, scrollHeight: number, clientHeight: number): number {
  const maxScroll = Math.max(0, scrollHeight - clientHeight)
  const target = ratio * scrollHeight - clientHeight / 3
  return Math.min(maxScroll, Math.max(0, Math.round(target)))
}

/**
 * Full-screen page showing one message with native text selection (handles and the system copy/select menu). The
 * transcript itself turns selection off on small screens so long-press can open the message menu.
 */
export const MessageSelectTextPage: FC<{
  msg: Message
  sessionId: string
  /** Where in the message the long press landed (0 = top, 1 = bottom), used for the initial scroll position. */
  scrollRatio: number
  onClose(): void
}> = ({ msg, sessionId, scrollRatio, onClose }) => {
  const { t } = useTranslation()
  const enableMarkdownRendering = useSettingsStore((state) => state.enableMarkdownRendering)
  const enableLaTeXRendering = useSettingsStore((state) => state.enableLaTeXRendering)
  const enableMermaidRendering = useSettingsStore((state) => state.enableMermaidRendering)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const text = getMessageText(msg, true, false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current
      if (!scroller) return
      scroller.scrollTop = getSelectTextScrollTop(scrollRatio, scroller.scrollHeight, scroller.clientHeight)
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollRatio])

  const selectAll = useCallback(() => {
    const body = bodyRef.current
    const selection = window.getSelection()
    if (!body || !selection) return
    selection.selectAllChildren(body)
  }, [])

  return (
    <Modal
      opened
      onClose={onClose}
      fullScreen
      withCloseButton={false}
      transitionProps={{ transition: 'slide-up', duration: 200 }}
      classNames={{ body: '!p-0 flex h-full flex-col' }}
      styles={{ content: { display: 'flex', flexDirection: 'column' } }}
    >
      <div data-testid={TestId.message.selectTextPage} className="flex h-full min-h-0 flex-col">
        <Flex
          align="center"
          gap="xs"
          px="xs"
          pt="var(--mobile-safe-area-inset-top, 0px)"
          className="flex-none border-0 border-b border-solid border-chatbox-border-primary"
        >
          <Flex flex="1 1 0" justify="flex-start">
            <ActionIcon
              variant="subtle"
              color="chatbox-primary"
              size={44}
              aria-label={t('Close')}
              data-testid={TestId.message.selectTextClose}
              onClick={onClose}
            >
              <ScalableIcon icon={IconX} size={22} />
            </ActionIcon>
          </Flex>
          <Text fw={600} size="md" className="py-3">
            {t('Select Text')}
          </Text>
          <Flex flex="1 1 0" justify="flex-end">
            <Button
              variant="subtle"
              color="chatbox-brand"
              data-testid={TestId.message.selectTextSelectAll}
              onClick={selectAll}
            >
              {t('Select all')}
            </Button>
          </Flex>
        </Flex>
        {/* The modal renders outside the transcript, so it opens the same message style scope itself. */}
        <div ref={scrollRef} className={cn('msg-block min-h-0 flex-1 overflow-y-auto', getMessageRoleClass(msg.role))}>
          <div
            ref={bodyRef}
            data-testid={TestId.message.selectTextBody}
            className="msg-content select-text px-5 pt-4 [-webkit-touch-callout:default]"
            style={{ paddingBottom: 'calc(var(--mobile-safe-area-inset-bottom, 0px) + 24px)' }}
          >
            {enableMarkdownRendering ? (
              <Markdown
                uniqueId={`${msg.id}-select-text`}
                sessionId={sessionId}
                enableLaTeXRendering={enableLaTeXRendering}
                enableMermaidRendering={enableMermaidRendering}
              >
                {text}
              </Markdown>
            ) : (
              <div className="break-words [overflow-wrap:anywhere] whitespace-pre-line">{text}</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
