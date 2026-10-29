import type { Message } from '@shared/types'
import type { MessageRow } from '@chatbox/core/session/session-tree'
import type { SessionTranscriptThread } from '@chatbox/core/ports'

// MessageList renders the latest user turn and its assistant reply as ONE Virtuoso item
// (so they scroll as a unit while streaming). Every consumer that needs a Virtuoso item
// index for a message (e.g. scrollToMessage) must locate it through the items built
// here, or scrolling to anything at/after the latest user message lands wrong.

export type MessageRenderItem =
  | { type: 'thread'; key: string; messages: []; thread: SessionTranscriptThread }
  | {
      type: 'message'
      key: string
      messages: [Message]
    }
  | {
      type: 'group'
      key: string
      messages: [Message] | [Message, Message]
    }

/**
 * Index of the latest user message when it starts a grouped last turn, -1 otherwise.
 * Grouping applies when the latest user message is the last message, or is directly
 * followed by an assistant reply that is not a fork marker.
 */
function findGroupedLastTurnStart(messages: Pick<Message, 'role' | 'isForkMarker'>[]): number {
  let latestUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      latestUserIndex = i
      break
    }
  }
  if (latestUserIndex < 0) return -1

  const shouldGroupLastTurn =
    latestUserIndex === messages.length - 1 ||
    (latestUserIndex + 1 < messages.length &&
      messages[latestUserIndex + 1].role === 'assistant' &&
      !messages[latestUserIndex + 1].isForkMarker)

  return shouldGroupLastTurn ? latestUserIndex : -1
}

/** Whether the grouped last turn starting at `groupStart` includes an assistant reply. */
function groupedTurnHasReply(messages: Pick<Message, 'role'>[], groupStart: number): boolean {
  return groupStart + 1 < messages.length && messages[groupStart + 1].role === 'assistant'
}

export function buildMessageRenderItems(messages: Message[], lastUserMessageId?: string | null): MessageRenderItem[] {
  const candidate = findGroupedLastTurnStart(messages)
  const groupStart = lastUserMessageId === undefined || messages[candidate]?.id === lastUserMessageId ? candidate : -1
  const items: MessageRenderItem[] = []

  for (let i = 0; i < messages.length; i++) {
    if (i === groupStart) {
      const groupedMessages: [Message] | [Message, Message] = groupedTurnHasReply(messages, groupStart)
        ? [messages[i], messages[i + 1]]
        : [messages[i]]

      items.push({
        type: 'group',
        // Key the last-turn group by the user message only. Including the
        // assistant id would change the Virtuoso item identity when the reply
        // arrives (group-u1 → group-u1-a1) and remount the user bubble.
        key: `group-${groupedMessages[0].id}`,
        messages: groupedMessages,
      })
      if (groupedMessages.length === 2) {
        i++
      }
      continue
    }

    items.push({
      type: 'message',
      key: messages[i].id,
      messages: [messages[i]],
    })
  }

  return items
}

export function buildTranscriptRenderItems(
  rows: readonly MessageRow[],
  threads: readonly SessionTranscriptThread[]
): MessageRenderItem[] {
  const result: MessageRenderItem[] = []
  const ordered = [...threads].sort(
    (a, b) => (a.threadOrder < 0 ? Infinity : a.threadOrder) - (b.threadOrder < 0 ? Infinity : b.threadOrder)
  )
  for (const thread of ordered) {
    const messages = rows.filter((row) => row.threadId === thread.threadId).map((row) => row.message)
    if (!messages.length && thread.rootMessageId === null) {
      result.push({ type: 'thread', key: `thread-${thread.threadId}`, messages: [], thread })
    } else result.push(...buildMessageRenderItems(messages, thread.summary?.lastUserMessageId ?? null))
  }
  return result
}
