import type { MessageRow } from '@chatbox/core/session/session-tree'
import type { Message } from '@shared/types'
import type { MessageMinimapAnchor } from './MessageMinimapRail'

export function isUserNavigationMessage(message: Message): boolean {
  return message.role === 'user' && !message.isSummary && !message.backgroundTask
}

/** Bound preview work even when a loaded message contains a large body. */
export const MINIMAP_PREVIEW_MAX_LENGTH = 300

/**
 * Prefix of the message text for minimap previews. Matches the visible output
 * of `getMessageText(message, true, false)` (text parts joined, images as a
 * placeholder, reasoning excluded) but stops once `maxLength` characters are
 * collected instead of joining the whole message.
 */
export function getMessagePreviewText(message: Message, maxLength = MINIMAP_PREVIEW_MAX_LENGTH): string {
  const chunks: string[] = []
  let collected = 0
  for (const part of message.contentParts ?? []) {
    if (collected >= maxLength) {
      break
    }
    const text = part.type === 'text' ? part.text : part.type === 'image' ? '[image]' : null
    if (!text) {
      continue
    }
    if (chunks.length) {
      chunks.push('\n')
      collected++
    }
    const chunk = text.slice(0, maxLength - collected)
    chunks.push(chunk)
    collected += chunk.length
  }
  return chunks.join('').trim()
}

export function buildMessageMinimapAnchors(rows: readonly MessageRow[]): MessageMinimapAnchor[] {
  const anchors: MessageMinimapAnchor[] = []
  let pending: MessageMinimapAnchor | undefined
  let threadId: string | undefined
  for (const row of rows) {
    if (threadId !== row.threadId) pending = undefined
    threadId = row.threadId
    const message = row.message
    if (message.isSummary || message.backgroundTask || message.isForkMarker) continue
    if (message.role === 'user') {
      pending = { messageId: row.messageId, text: getMessagePreviewText(message) }
      anchors.push(pending)
    } else if (message.role === 'assistant' && pending) {
      pending.assistantText = getMessagePreviewText(message)
      pending = undefined
    }
  }
  return anchors
}

export function areMinimapAnchorsEqual(previous: MessageMinimapAnchor[], next: MessageMinimapAnchor[]): boolean {
  if (previous.length !== next.length) {
    return false
  }
  for (let i = 0; i < previous.length; i++) {
    const a = previous[i]
    const b = next[i]
    if (a.messageId !== b.messageId || a.text !== b.text || a.assistantText !== b.assistantText) {
      return false
    }
  }
  return true
}
