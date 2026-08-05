import { ActionIcon, Badge, Box, Button, Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import type { Message } from '@shared/types'
import { IconAlertCircle } from '@tabler/icons-react'
import { useAtomValue } from 'jotai'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { type SessionSubmissionQueue, submissionQueueStateMapAtom } from '@/stores/atoms/submissionQueueAtoms'
import {
  removeQueuedSubmission,
  resumeSubmissionQueue,
  updateQueuedSubmission,
} from '@/stores/session/submission-queue'
import { useUIStore } from '@/stores/uiStore'
import { getMessageText } from '@/utils/message'
import QueuedMessageEditor from './QueuedMessageEditor'

const DEFAULT_SESSION_SUBMISSION_QUEUE: SessionSubmissionQueue = { items: [], status: 'idle' }

function attachmentSummary(message: Message, t: (key: string) => string): string | undefined {
  const imageCount = message.contentParts.filter((part) => part.type === 'image').length
  const parts = [
    message.files?.length ? `${message.files.length} ${t(message.files.length === 1 ? 'file' : 'files')}` : undefined,
    message.links?.length ? `${message.links.length} ${t(message.links.length === 1 ? 'link' : 'links')}` : undefined,
    imageCount ? `${imageCount} ${t(imageCount === 1 ? 'image' : 'images')}` : undefined,
  ].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(', ') : undefined
}

export type QueuedMessagePanelProps = {
  sessionId: string
  generating?: boolean
}

export default function QueuedMessagePanel({ sessionId, generating = false }: QueuedMessagePanelProps) {
  const { t } = useTranslation()
  const widthFull = useUIStore((state) => state.widthFull)
  const stateMap = useAtomValue(submissionQueueStateMapAtom)
  const queue = stateMap[sessionId] ?? DEFAULT_SESSION_SUBMISSION_QUEUE
  const [editingItemId, setEditingItemId] = useState<string>()
  const editingItem = queue.items.find((item) => item.id === editingItemId)

  const hasPendingItem = queue.items.some((item) => item.state === 'pending')
  const hasQueuedBacklog = queue.status === 'paused' || queue.items.length > 1 || (generating && hasPendingItem)

  if (queue.items.length === 0 || !hasQueuedBacklog) return null

  return (
    <Box px="sm" mb="xs">
      <Stack className={cn(widthFull ? 'w-full' : 'max-w-4xl mx-auto')} gap="xs">
        {queue.status === 'paused' && queue.pauseReason === 'generation-error' && (
          <Paper withBorder className="overflow-hidden border-red-200 bg-red-50">
            <div className="flex">
              <div className="w-1 shrink-0 bg-red-500" />
              <div className="flex flex-1 flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                <div className="flex min-w-0 flex-1 gap-3">
                  <ThemeIcon color="red" variant="light" radius="xl" size="lg" className="shrink-0">
                    <IconAlertCircle size={20} />
                  </ThemeIcon>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Text fw={700}>{t('Generation failed')}</Text>
                      <Badge color="red" variant="light" size="sm">
                        {t('Queue paused')}
                      </Badge>
                    </div>
                    <Text size="sm" c="dimmed" mt={4}>
                      {t('Resolve the error, then continue sending.')}
                    </Text>
                    <div className="mt-2 flex items-center gap-2 text-xs text-red-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      <span>{t('{{count}} queued', { count: queue.items.length })}</span>
                    </div>
                  </div>
                </div>
                <Button className="w-full shrink-0 sm:w-auto" onClick={() => resumeSubmissionQueue(sessionId)}>
                  {t('Continue sending')}
                </Button>
              </div>
            </div>
          </Paper>
        )}
        {queue.status === 'paused' && queue.pauseReason === 'tool-pause' && (
          <Text size="xs" c="chatbox-tertiary">
            {t('Waiting for tool approval')}
          </Text>
        )}
        {queue.items.map((item, index) => {
          const dispatching = item.state === 'dispatching'
          const summary = getMessageText(item.message, false, false).trim()
          const attachments = attachmentSummary(item.message, t)
          return (
            <Paper key={item.id} withBorder p="xs" className="flex items-center gap-2">
              <Badge variant="light" color="gray">
                {index + 1}
              </Badge>
              <Stack gap={0} className="min-w-0 flex-1">
                <Text size="sm" lineClamp={1}>
                  {summary || t('Attachment message')}
                </Text>
                {attachments && (
                  <Text size="xs" c="chatbox-tertiary">
                    {attachments}
                  </Text>
                )}
              </Stack>
              {dispatching && <Badge color="blue">{t('Sending')}</Badge>}
              <ActionIcon
                variant="subtle"
                aria-label={t('Edit queued message')}
                disabled={dispatching}
                onClick={() => setEditingItemId(item.id)}
              >
                <Pencil size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={t('Delete queued message')}
                disabled={dispatching}
                onClick={() => void removeQueuedSubmission(sessionId, item.id)}
              >
                <Trash2 size={16} />
              </ActionIcon>
            </Paper>
          )
        })}
      </Stack>
      {editingItem && (
        <QueuedMessageEditor
          opened
          message={editingItem.message}
          dispatching={editingItem.state === 'dispatching'}
          onClose={() => setEditingItemId(undefined)}
          onSave={(message) => {
            updateQueuedSubmission(sessionId, editingItem.id, message)
            setEditingItemId(undefined)
          }}
        />
      )}
    </Box>
  )
}
