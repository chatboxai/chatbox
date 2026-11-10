import {
  type AssistantMessageHeader,
  getAssistantMessageHeader,
  getAssistantMessageSource,
} from '@chatbox/core/session/message-header'

export { getSessionAssistantName } from '@chatbox/core/session/message-header'

import type { Message } from '@shared/types'
import * as dateFns from 'date-fns'

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
