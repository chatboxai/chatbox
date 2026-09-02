import type { Message } from '@shared/types'
import type { MessageMinimapAnchor } from './MessageMinimapRail'

export function isUserNavigationMessage(message: Message): boolean {
  return message.role === 'user' && !message.isSummary && !message.backgroundTask
}

/**
 * Minimap previews render a few clamped lines at most, so anchors only need a
 * short prefix of each message. Building them from the full text made every
 * streaming chunk re-join the entire conversation (minutes-long chats lagged
 * on each token, see feedback 1589).
 */
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
    const chunk = text.length > maxLength - collected ? text.slice(0, maxLength - collected) : text
    chunks.push(chunk)
    collected += chunk.length
  }
  return chunks.join('\n').trim()
}

/**
 * Streaming cache updates replace only the generating assistant message while
 * preserving the other message objects. Reuse the minimap only for that exact
 * update shape; edits, inserts, removals, reorders, and generation completion
 * must rebuild anchors.
 */
export function canReuseMinimapAnchorsDuringGeneration(previous: Message[], current: Message[]): boolean {
  if (previous.length !== current.length) {
    return false
  }

  for (let i = 0; i < previous.length; i++) {
    const previousMessage = previous[i]
    const currentMessage = current[i]
    if (previousMessage === currentMessage) {
      continue
    }
    if (
      previousMessage.id !== currentMessage.id ||
      previousMessage.role !== 'assistant' ||
      currentMessage.role !== 'assistant' ||
      previousMessage.generating !== true ||
      currentMessage.generating !== true
    ) {
      return false
    }
  }

  return true
}

/**
 * Comparing against the previous result lets MessageList keep a stable array
 * reference when unrelated session state changes. Streaming replies are
 * frozen separately by MessageList and refreshed once generation completes.
 */
export function areMinimapAnchorsEqual(previous: MessageMinimapAnchor[], next: MessageMinimapAnchor[]): boolean {
  if (previous.length !== next.length) {
    return false
  }
  for (let i = 0; i < previous.length; i++) {
    const a = previous[i]
    const b = next[i]
    if (
      a.messageId !== b.messageId ||
      a.itemIndex !== b.itemIndex ||
      a.text !== b.text ||
      a.assistantText !== b.assistantText
    ) {
      return false
    }
  }
  return true
}
