import { isActionAvailableInMode, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import { ActionIcon, Badge, Box, Button, Flex, Text, Textarea } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message } from '@shared/types'
import { IconAlertCircle, IconArrowUp, IconClockHour4, IconPaperclip, IconPencil, IconX } from '@tabler/icons-react'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import {
  clearPendingQueuedMessages,
  isSteerableQueuedMessage,
  MAX_QUEUED_MESSAGES,
  messageQueueStore,
  type QueuedUserMessage,
  type QueuePausedReason,
  removeQueuedMessage,
  requestSteerQueuedMessage,
  resumeQueueAndDrain,
  updateQueuedMessageText,
  wakeQueuedUserMessages,
} from '@/stores/session/message-queue'
import { ScalableIcon } from '../common/ScalableIcon'

function getQueuedMessageText(message: Message): string {
  return message.contentParts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
}

function getQueuedMessagePreview(message: Message): string {
  const text = getQueuedMessageText(message).trim()
  if (text) return text.split('\n')[0]
  return ''
}

function countQueuedAttachments(message: Message): number {
  const imageParts = message.contentParts.filter((part) => part.type === 'image').length
  return imageParts + (message.files?.length ?? 0) + (message.links?.length ?? 0)
}

function getPausedLabel(reason: QueuePausedReason, t: (key: string) => string): string {
  switch (reason) {
    case 'stopped':
      return t('Generation was stopped, queued messages were not sent')
    case 'error':
      return t('An error occurred, queued messages were not sent')
    case 'agent-mode-suggested':
      return t('Sending paused')
    case 'conversation-changed':
      return t('The conversation changed, queued messages were not sent')
  }
}

interface QueuedItemRowProps {
  sessionId: string
  item: QueuedUserMessage
  order: number
  paused: boolean
  /** Mode policy: chat mode drains legacy items but offers no queue-jumping. */
  steeringEnabled: boolean
}

function QueuedItemRow({ sessionId, item, order, paused, steeringEnabled }: QueuedItemRowProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)

  const attachmentCount = countQueuedAttachments(item.message)
  const steerable = steeringEnabled && isSteerableQueuedMessage(item.message) && !paused && !item.steerRequested

  // The editor is much taller than the collapsed row, so it can extend past
  // the bottom of the scroll area it expands inside.
  useEffect(() => {
    if (editing) {
      editorRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [editing])

  const startEdit = () => {
    setDraft(getQueuedMessageText(item.message))
    setEditing(true)
  }
  const saveEdit = () => {
    const text = draft.trim()
    if (text) {
      updateQueuedMessageText(sessionId, item.id, text)
    } else {
      removeQueuedMessage(sessionId, item.id)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <Box
        ref={editorRef}
        data-testid={TestId.chat.queuedMessageItem}
        className="rounded-md bg-chatbox-background-primary px-2 py-1.5"
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              saveEdit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setEditing(false)
            }
          }}
          autosize
          minRows={2}
          maxRows={6}
          autoFocus
          size="sm"
        />
        <Flex align="center" justify="space-between" mt={6} gap="xs">
          <Text size="xs" c="chatbox-tertiary" className="truncate">
            {t('Enter to save · Esc to cancel · keeps its place in the queue')}
          </Text>
          <Flex gap={4} className="flex-shrink-0">
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </Button>
            <Button size="compact-xs" onClick={saveEdit}>
              {t('Save')}
            </Button>
          </Flex>
        </Flex>
      </Box>
    )
  }

  return (
    <Flex
      data-testid={TestId.chat.queuedMessageItem}
      align="center"
      gap={8}
      className="group/queue-item rounded-md bg-chatbox-background-secondary px-2 py-1 min-h-[30px]"
    >
      <Text size="xs" c="chatbox-tertiary" className="w-3 text-center flex-shrink-0 tabular-nums">
        {order}
      </Text>
      <Text size="sm" c="chatbox-secondary" className="min-w-0 flex-1 truncate">
        {getQueuedMessagePreview(item.message)}
      </Text>
      {attachmentCount > 0 && (
        <Badge
          size="xs"
          variant="light"
          color="gray"
          leftSection={<IconPaperclip size={10} />}
          className="flex-shrink-0"
        >
          {attachmentCount}
        </Badge>
      )}
      <Flex
        align="center"
        gap={2}
        className={cn(
          'flex-shrink-0 transition-opacity',
          item.steerRequested ? 'opacity-100' : 'opacity-30 group-hover/queue-item:opacity-100 focus-within:opacity-100'
        )}
      >
        {item.steerRequested ? (
          <Text size="xs" c="chatbox-brand" fw={600} className="animate-pulse px-1">
            {t('Interjecting…')}
          </Text>
        ) : steeringEnabled ? (
          <Tooltip
            label={
              steerable
                ? t('Send immediately instead of waiting for the current reply')
                : t('Messages with attachments cannot jump the queue')
            }
          >
            <Button
              data-testid={TestId.chat.queuedMessageSteer}
              size="compact-xs"
              variant="subtle"
              color="chatbox-brand"
              disabled={!steerable}
              leftSection={<IconArrowUp size={12} />}
              onClick={() => requestSteerQueuedMessage(sessionId, item.id)}
            >
              {t('Send now')}
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip label={t('Edit')}>
          <ActionIcon
            data-testid={TestId.chat.queuedMessageEdit}
            size="sm"
            variant="subtle"
            color="gray"
            aria-label={t('Edit') || ''}
            onClick={startEdit}
          >
            <IconPencil size={13} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('Remove queued message')}>
          <ActionIcon
            data-testid={TestId.chat.queuedMessageRemove}
            size="sm"
            variant="subtle"
            color="gray"
            aria-label={t('Remove queued message') || ''}
            onClick={() => removeQueuedMessage(sessionId, item.id)}
          >
            <IconX size={13} />
          </ActionIcon>
        </Tooltip>
      </Flex>
    </Flex>
  )
}

interface QueuedMessagesBarProps {
  sessionId: string
}

export const QueuedMessagesBar = memo(function QueuedMessagesBar({ sessionId }: QueuedMessagesBarProps) {
  const { t } = useTranslation()
  const queue = useStore(messageQueueStore, (state) => state.queues[sessionId])
  const pausedReason = useStore(messageQueueStore, (state) => state.paused[sessionId])
  // Chat mode still drains items queued before the mode split (drain-only),
  // but never offers queue-jumping — steering is a work-mode capability.
  const agentModeEntry = useSessionAgentMode(sessionId)
  const steeringEnabled = isActionAvailableInMode('steer-queued-message', resolveSessionMode(agentModeEntry.value))
  const listRef = useRef<HTMLDivElement>(null)
  const previousTailRef = useRef<{ id: string | undefined; count: number } | null>(null)

  // Covers entries restored from persistence after an app restart: no enqueue
  // rekicks the drain, so nudge it when the bar appears (no-op while paused,
  // and delivery waits on the generation lock while a reply is streaming).
  useEffect(() => {
    wakeQueuedUserMessages(sessionId)
  }, [sessionId])

  // In-flight items are already being delivered (their reply is streaming);
  // showing them as "will send later" would be misleading.
  const visibleQueue = queue?.filter((item) => !item.inFlight)
  const visibleCount = visibleQueue?.length ?? 0
  const tailId = visibleQueue?.at(-1)?.id

  // A longer list ending on a new id is the shape a local append takes, and
  // only the local user appends — so that is the one case worth scrolling for.
  // Counting alone would also fire when a failed delivery clears `inFlight` and
  // returns an item to the head, scrolling away from the very item retried
  // next. The first run is the baseline: a queue restored from persistence
  // stays at its head, which is what sends next.
  useEffect(() => {
    const list = listRef.current
    const previous = previousTailRef.current
    previousTailRef.current = { id: tailId, count: visibleCount }
    if (list && previous && tailId !== previous.id && visibleCount > previous.count) {
      list.scrollTop = list.scrollHeight
    }
  }, [tailId, visibleCount])

  if (!visibleQueue?.length) {
    return null
  }

  return (
    <Box
      data-testid={TestId.chat.queuedMessageBar}
      className="rounded-lg bg-chatbox-background-tertiary border border-chatbox-border-primary shadow-sm px-2.5 py-2"
    >
      <Flex align="center" justify="space-between" gap="xs" className="px-0.5">
        <Flex align="center" gap={6} className="min-w-0">
          <ScalableIcon
            icon={pausedReason ? IconAlertCircle : IconClockHour4}
            size={14}
            className={pausedReason ? 'text-orange-500 flex-shrink-0' : 'text-chatbox-tertiary flex-shrink-0'}
          />
          <Text size="xs" c={pausedReason ? 'orange' : 'chatbox-tertiary'} className="truncate">
            {pausedReason ? getPausedLabel(pausedReason, t) : t('Will send after the current response finishes')}
          </Text>
          {!pausedReason && (
            <Badge size="xs" variant="light" color="gray" className="flex-shrink-0 normal-case font-normal">
              {visibleQueue.length} / {MAX_QUEUED_MESSAGES}
            </Badge>
          )}
        </Flex>
        <Flex align="center" gap={4} className="flex-shrink-0">
          {pausedReason && (
            <Button
              data-testid={TestId.chat.queuedMessageSendNow}
              size="compact-xs"
              variant="light"
              onClick={() => resumeQueueAndDrain(sessionId)}
            >
              {t('Send now')}
            </Button>
          )}
          <Button
            data-testid={TestId.chat.queuedMessageClear}
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => clearPendingQueuedMessages(sessionId)}
          >
            {t('Clear queue')}
          </Button>
        </Flex>
      </Flex>
      <Flex
        ref={listRef}
        direction="column"
        gap={3}
        mt={6}
        // A full queue is 20 rows tall — cap it so the bar never crowds out the
        // conversation, and cut the last visible row to hint at the overflow.
        className="max-h-[min(30vh,180px)] overflow-y-auto"
      >
        {visibleQueue.map((item, index) => (
          <QueuedItemRow
            key={item.id}
            sessionId={sessionId}
            item={item}
            order={index + 1}
            paused={Boolean(pausedReason)}
            steeringEnabled={steeringEnabled}
          />
        ))}
      </Flex>
    </Box>
  )
})
