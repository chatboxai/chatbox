import { selectContextMessages } from '@shared/context'
import type { CompactionPoint, Message, Settings } from '@shared/types'
import { MAX_UPLOADED_FILE_LINES } from '@shared/uploaded-file-tools'

export const MAX_INLINE_FILE_LINES = MAX_UPLOADED_FILE_LINES
export { PREVIEW_LINES } from '@shared/context/attachments'

export interface SelectMessagesForSendContextParams {
  settings: Partial<Settings>
  msgs: Message[]
  compactionPoints?: CompactionPoint[]
  preserveLastUserMessage?: boolean
}

export function selectMessagesForSendContext(params: SelectMessagesForSendContextParams): Message[] {
  const { settings, msgs, compactionPoints, preserveLastUserMessage = true } = params
  const draft: Message = { id: 'token-preview-current-input', role: 'user', contentParts: [] }
  return selectContextMessages(preserveLastUserMessage ? msgs : [...msgs, draft], {
    compactionPoints,
    maxContextMessageCount: settings.maxContextMessageCount,
  }).filter((message) => message !== draft)
}
