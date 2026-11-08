import {
  type AssistantMessageHeader,
  getAssistantMessageHeader,
  getAssistantMessageSource,
  MESSAGE_HEADER_SEPARATOR,
} from '@chatbox/core/session/message-header'

export { getSessionAssistantName } from '@chatbox/core/session/message-header'

import { Loader } from '@mantine/core'
import type { Message } from '@shared/types'
import * as dateFns from 'date-fns'
import { Fragment, type ReactNode, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { MessageLayout } from './message-layout'
import { useSnapEllipsis } from './snap-ellipsis'

export function formatMessageTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  if (dateFns.isToday(date)) return dateFns.format(date, 'HH:mm')
  if (dateFns.isThisYear(date)) return dateFns.format(date, 'MM-dd HH:mm')
  return dateFns.format(date, 'yyyy-MM-dd HH:mm')
}

/** Header of an assistant reply, from the message's provider/model record and the display settings. */
export function getMessageHeader(
  message: Pick<Message, 'aiProvider' | 'aiProviderName' | 'model' | 'modelId' | 'timestamp'>,
  options: {
    assistantName?: string
    fallbackLabel: string
    showModelName: boolean
    showTime: boolean
    lookupProviderName?: (providerId: string) => string | undefined
  }
): AssistantMessageHeader {
  return getAssistantMessageHeader(getAssistantMessageSource(message, options.lookupProviderName), {
    assistantName: options.assistantName,
    fallbackLabel: options.fallbackLabel,
    showModelName: options.showModelName,
    showTime: options.showTime,
    time: message.timestamp === undefined ? undefined : formatMessageTimestamp(message.timestamp),
  })
}

/** Name and every detail of a reply on two lines, for hover text. */
export function getMessageHeaderTitle(header: AssistantMessageHeader): string {
  return header.detail ? `${header.name}\n${header.detail}` : header.name
}

/**
 * The line above every assistant reply: a bold name followed by grey monospace `[provider ·] model · time`. It stays
 * a single line. The name keeps up to 45% of the row; in the grey part the model id gives way first, then the
 * provider (capped at 10em), and the time never shrinks.
 */
export function MessageNameRow({
  header,
  layout,
  isSmallScreen,
  offsetTop = 0,
  generating,
  className,
}: {
  header: AssistantMessageHeader
  layout: MessageLayout
  isSmallScreen: boolean
  /** Pushes the row down so its line box centers on the avatar beside it. */
  offsetTop?: number
  /** Spinner at the end of the row, for replies streaming without an avatar to carry the loader. */
  generating: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const { provider, model, time } = header.meta
  const meta: { key: string; node: ReactNode }[] = []
  if (provider) {
    meta.push({
      key: 'provider',
      node: (
        <span data-snap-ellipsis className="min-w-0 max-w-[10em] shrink truncate">
          {provider}
        </span>
      ),
    })
  }
  if (model)
    meta.push({
      key: 'model',
      node: (
        <span data-snap-ellipsis className="min-w-0 shrink-[1000] truncate">
          {model}
        </span>
      ),
    })
  if (time) meta.push({ key: 'time', node: <span className="shrink-0">{time}</span> })
  const rowRef = useRef<HTMLDivElement>(null)
  useSnapEllipsis(rowRef, `${header.name}|${provider}|${model}|${time}`)

  return (
    <div
      ref={rowRef}
      title={isSmallScreen ? undefined : getMessageHeaderTitle(header)}
      style={offsetTop ? { marginTop: offsetTop } : undefined}
      className={cn(
        'flex w-full min-w-0 max-w-full items-baseline gap-1.5 whitespace-nowrap leading-5',
        layout === 'bubble' ? 'mb-1.5' : 'mb-1',
        className
      )}
    >
      <span
        data-snap-ellipsis
        className={cn(
          'min-w-0 truncate text-sm font-semibold text-chatbox-tint-primary',
          meta.length > 0 && 'max-w-[45%] shrink-0'
        )}
      >
        {header.name}
      </span>
      {meta.length > 0 && (
        <span className="flex min-w-0 font-mono text-xs text-[var(--chatbox-message-name-muted)]">
          {meta.map((segment, index) => (
            <Fragment key={segment.key}>
              {index > 0 && (
                <span aria-hidden="true" className="shrink-0 whitespace-pre">
                  {MESSAGE_HEADER_SEPARATOR}
                </span>
              )}
              {segment.node}
            </Fragment>
          ))}
        </span>
      )}
      {generating && (
        <Loader
          size={12}
          aria-label={t('Generating...') as string}
          className="shrink-0 self-center"
          classNames={{ root: "after:content-[''] after:border-[2px]" }}
        />
      )}
    </div>
  )
}
