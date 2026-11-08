import { Loader } from '@mantine/core'
import * as dateFns from 'date-fns'
import { Fragment, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { MessageLayout } from './message-layout'

export function formatMessageTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  if (dateFns.isToday(date)) return dateFns.format(date, 'HH:mm')
  if (dateFns.isThisYear(date)) return dateFns.format(date, 'MM-dd HH:mm')
  return dateFns.format(date, 'yyyy-MM-dd HH:mm')
}

/**
 * Name of the copilot a chat was started from, read from the saved copilot. The chat title is not a copilot
 * identity (it can be renamed or generated), so a copilot without a saved definition gets no name.
 */
export function getSessionAssistantName(
  session: { copilotId?: string },
  copilots: readonly { id: string; name: string }[]
): string | undefined {
  if (!session.copilotId) return undefined
  return copilots.find((copilot) => copilot.id === session.copilotId)?.name.trim() || undefined
}

export type MessageNameRowParts = {
  /** Copilot the chat was started from; omitted for ordinary chats. */
  assistantName?: string
  /** Model that wrote the reply, or the generic assistant label for replies that predate model tracking. */
  label?: string
  time?: string
  /** Hover text with the full, untruncated names. */
  title: string
}

export function getMessageNameRowParts({
  assistantName,
  model,
  time,
  fallbackLabel,
}: {
  assistantName?: string
  model?: string
  time?: string
  fallbackLabel: string
}): MessageNameRowParts {
  const name = assistantName?.trim() || undefined
  const modelName = model?.trim() || undefined
  const label = modelName ?? (name ? undefined : fallbackLabel)
  return {
    assistantName: name,
    label,
    time,
    title: [name, label].filter(Boolean).join(' · '),
  }
}

/**
 * The line above every assistant reply: `[assistant] · model · [time]`. It stays a single line. The assistant name
 * keeps its width up to half the row; the model name is the only part that shrinks, so a long model id gives way
 * first. The model does not grow either, which keeps the time right after it.
 */
export function MessageNameRow({
  assistantName,
  model,
  timestamp,
  layout,
  isSmallScreen,
  generating,
}: {
  assistantName?: string
  model?: string
  timestamp?: number
  layout: MessageLayout
  isSmallScreen: boolean
  /** Spinner at the end of the row, for replies streaming without an avatar to carry the loader. */
  generating: boolean
}) {
  const { t } = useTranslation()
  const parts = getMessageNameRowParts({
    assistantName,
    model,
    time: timestamp === undefined ? undefined : formatMessageTimestamp(timestamp),
    fallbackLabel: t('Assistant'),
  })
  const segments: { key: string; node: ReactNode }[] = []
  if (parts.assistantName) {
    segments.push({
      key: 'assistant',
      node: (
        <span className="max-w-[50%] shrink-0 truncate font-semibold text-chatbox-tint-primary">
          {parts.assistantName}
        </span>
      ),
    })
  }
  if (parts.label) {
    segments.push({
      key: 'model',
      node: (
        <span className={cn('min-w-0 truncate text-chatbox-tint-secondary', !parts.assistantName && 'font-semibold')}>
          {parts.label}
        </span>
      ),
    })
  }
  if (parts.time) segments.push({ key: 'time', node: <span className="shrink-0">{parts.time}</span> })

  return (
    <div
      title={isSmallScreen ? undefined : parts.title}
      className={cn(
        'flex w-full min-w-0 max-w-full items-center whitespace-nowrap text-[var(--chatbox-message-name-muted)]',
        isSmallScreen ? 'h-[18px] gap-1 text-xs leading-[18px]' : 'h-5 gap-1.5 text-[13px] leading-5',
        layout === 'bubble' ? 'mb-1.5' : 'mb-1'
      )}
    >
      {segments.map((segment, index) => (
        <Fragment key={segment.key}>
          {index > 0 && (
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
          )}
          {segment.node}
        </Fragment>
      ))}
      {generating && (
        <Loader
          size={12}
          aria-label={t('Generating...') as string}
          className="shrink-0"
          classNames={{ root: "after:content-[''] after:border-[2px]" }}
        />
      )}
    </div>
  )
}
