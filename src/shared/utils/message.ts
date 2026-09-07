import { assign, cloneDeep, omit } from 'lodash'
import type { Message, MessageContentParts, MessagePicture, SearchResultItem } from '../types'
import { countWord } from './word_count'

/**
 * Parts kept only for provider protocol replay (Anthropic redacted thinking,
 * signed empty thinking blocks). They are persisted with the message but must
 * never surface anywhere a user can see: rendering, exports, step counts.
 */
export function isProtocolOnlyPart(part: MessageContentParts[number]): boolean {
  return (part.type === 'text' || part.type === 'reasoning') && part.protocolOnly === true
}

/** The user-visible projection of a message's content parts. */
export function visibleContentParts(parts: MessageContentParts): MessageContentParts {
  return parts.some(isProtocolOnlyPart) ? parts.filter((part) => !isProtocolOnlyPart(part)) : parts
}

export function getMessageText(message: Message, includeImagePlaceHolder = true, includeReasoning = false): string {
  if (message.contentParts && message.contentParts.length > 0) {
    return message.contentParts
      .map((c) => {
        if (c.type === 'reasoning') {
          return includeReasoning ? c.text : null
        }
        if (c.type === 'text') {
          return c.text
        }
        if (c.type === 'image') {
          return includeImagePlaceHolder ? '[image]' : null
        }
        return ''
      })
      .filter((c) => c !== null)
      .join('\n')
  }
  return ''
}

// 只有这里可以访问 message 的 content / webBrowsing 字段，迁移到 contentParts 字段
export function migrateMessage(
  message: Omit<Message, 'contentParts'> & { contentParts?: MessageContentParts }
): Message {
  const result: Message = {
    id: message.id || '',
    role: message.role || 'user',
    contentParts: message.contentParts || [],
  }
  // 还是保留原始content字段，删除webBrowsing字段
  assign(result, omit(message, 'webBrowsing'))

  // 如果 contentParts 不存在，或者 contentParts 为空，或者 contentParts 的内容为 '...'(placeholder)，则使用 content 的值
  if (
    (!result.contentParts?.length || getMessageText(result) === '...' || !getMessageText(result)) &&
    'content' in message
  ) {
    const imageParts = (message as Message & { pictures?: MessagePicture[] }).pictures
      ?.filter((pic) => pic.storageKey || pic.url)
      .map((pic) => ({ type: 'image' as const, storageKey: pic.storageKey!, url: pic.url }))
    result.contentParts = [{ type: 'text', text: String(message.content ?? '') }, ...(imageParts || [])]
  }

  if ('webBrowsing' in message) {
    const webBrowsing = message.webBrowsing as {
      query: string[]
      links: { title: string; url: string }[]
    }
    result.contentParts.unshift({
      type: 'tool-call',
      state: 'result',
      toolCallId: `web_search_${message.id}`,
      toolName: 'web_search',
      args: {
        query: webBrowsing.query.join(', '),
      },
      result: {
        query: webBrowsing.query.join(', '),
        searchResults: webBrowsing.links.map((link) => ({
          title: link.title,
          link: link.url,
          snippet: link.title,
        })) satisfies SearchResultItem[],
      },
    })
  }

  return result
}

export function cloneMessage(message: Message): Message {
  return cloneDeep(message)
}

// No generation survives an app restart or renderer reload, so any message whose
// last persist predates this module's load is not actually generating anymore.
const MODULE_BOOT_TIME = Date.now()

export function isStaleGeneratingMessage(message: Message, bootTime = MODULE_BOOT_TIME): boolean {
  return message.generating === true && (message.timestamp === undefined || message.timestamp < bootTime)
}

/**
 * Finalize a message left `generating: true` in storage by a crash, force-quit,
 * or reload. Streaming persists refresh `timestamp` every couple of seconds, so a
 * generating message persisted before boot is definitionally stale. Without this,
 * the message is stuck spinning in the UI and — worse — silently excluded from
 * every future model context by the completed-message eligibility filter.
 *
 * Interrupted `call`-state tool parts become errors (still retryable via the
 * last-tool-step retry); `paused` parts keep their approval cards.
 */
export function finalizeStaleGeneratingMessage(message: Message, bootTime = MODULE_BOOT_TIME): Message {
  if (!isStaleGeneratingMessage(message, bootTime)) {
    return message
  }
  const now = Date.now()
  return {
    ...message,
    generating: false,
    contentParts: message.contentParts.map((part) =>
      part.type === 'tool-call' && part.state === 'call'
        ? {
            ...part,
            state: 'error',
            pauseReason: undefined,
            resultStorageKey: undefined,
            resultImageStorageKey: undefined,
            resultImageMediaType: undefined,
            result: { error: 'Tool execution was interrupted before its result was persisted.' },
            duration: part.startTime ? now - part.startTime : undefined,
          }
        : part
    ),
  }
}

export function isEmptyMessage(message: Message): boolean {
  return getMessageText(message, true, true).length === 0 && !message.files?.length && !message.links?.length
}

export function countMessageWords(message: Message): number {
  return countWord(getMessageText(message))
}

export function mergeMessages(a: Message, b: Message): Message {
  const ret = cloneMessage(a)
  // Merge contentParts
  ret.contentParts = [...(ret.contentParts || []), ...(b.contentParts || [])]

  return ret
}

export function fixMessageRoleSequence(messages: Message[]): Message[] {
  let result: Message[] = []
  if (messages.length <= 1) {
    result = messages
  } else {
    let currentMessage = cloneMessage(messages[0]) // 复制，避免后续修改导致的引用问题

    for (let i = 1; i < messages.length; i++) {
      const message = cloneMessage(messages[i]) // 复制消息避免修改原对象

      if (message.role === currentMessage.role) {
        currentMessage = mergeMessages(currentMessage, message)
      } else {
        result.push(currentMessage)
        currentMessage = message
      }
    }
    result.push(currentMessage)
  }
  // 如果顺序中的第一条 assistant 消息前面不是 user 消息，则插入一个 user 消息
  const firstAssistantIndex = result.findIndex((m) => m.role === 'assistant')
  if (firstAssistantIndex !== -1 && result[firstAssistantIndex - 1]?.role !== 'user') {
    result = [
      ...result.slice(0, firstAssistantIndex),
      { role: 'user', contentParts: [{ type: 'text', text: 'OK.' }], id: 'user_before_assistant_id' },
      ...result.slice(firstAssistantIndex),
    ]
  }
  return result
}

function hasCompletedToolCalls(message: Message): boolean {
  return Boolean(
    message.contentParts?.some(
      (part) => part.type === 'tool-call' && (part.state === 'result' || part.state === 'error')
    )
  )
}

/**
 * Completed tool calls carry no text but are real model content: a resumed
 * tool-call-only assistant message must stay in the request, otherwise the
 * model loses the tool history it is supposed to continue from.
 */
function isEmptyForModelRequest(message: Message): boolean {
  return !hasCompletedToolCalls(message) && isEmptyMessage(message)
}

/**
 * SequenceMessages organizes and orders messages to follow the sequence: system -> user -> assistant -> user -> etc.
 * 这个方法只能用于 llm 接口请求前的参数构造，因为会过滤掉消息中的无关字段，所以不适用于其他消息存储的场景
 * 这个方法本质上是 golang API 服务中方法的 TypeScript 实现
 * @param msgs
 * @returns
 */
export function sequenceMessages(msgs: Message[]): Message[] {
  const orderedMessages = orderSteeredMessagesForModel(msgs)
  // Merge all system messages first
  let system: Message = {
    id: '',
    role: 'system',
    contentParts: [],
  }
  for (const msg of orderedMessages) {
    if (msg.role === 'system') {
      system = mergeMessages(system, msg)
    }
  }
  // Initialize the result array with the non-empty system message, if present
  const ret: Message[] = !isEmptyMessage(system) ? [system] : []
  let next: Message = {
    id: '',
    role: 'user',
    contentParts: [],
  }
  let isFirstUserMsg = true // Special handling for the first user message
  for (const msg of orderedMessages) {
    // Skip the already processed system messages or empty messages
    if (msg.role === 'system' || isEmptyForModelRequest(msg)) {
      continue
    }
    // Merge consecutive messages from the same role
    if (msg.role === next.role) {
      next = mergeMessages(next, msg)
      continue
    }
    // Merge all assistant messages as a quote block if constructing the first user message
    if (isEmptyMessage(next) && isFirstUserMsg && msg.role === 'assistant') {
      // Quoting flattens the message to text and would erase completed tool calls
      // (the resumed history a continuation depends on, e.g. with a message limit
      // of 0). Keep the message whole behind a placeholder user turn instead.
      if (hasCompletedToolCalls(msg)) {
        ret.push({ id: 'user_before_assistant_id', role: 'user', contentParts: [{ type: 'text', text: 'OK.' }] })
        isFirstUserMsg = false
        next = msg
        continue
      }
      const text = getMessageText(msg)
      // Split and quote each line, preserving empty lines
      const lines = text.split('\n')
      // Remove the last empty element only if text ends with newline
      const linesToQuote = text.endsWith('\n') ? lines.slice(0, -1) : lines
      const quotedText = linesToQuote.map((line) => `> ${line}`).join('\n')
      // Add back the ending newline(s) to match original structure
      const quote = text.endsWith('\n\n') ? `${quotedText}\n\n` : `${quotedText}\n`
      // Clone the message to avoid mutating the original, which could cause
      // duplicate ">" prefixes if sequenceMessages is called multiple times
      const quotedMsg = cloneMessage(msg)
      quotedMsg.contentParts = [{ type: 'text', text: quote }]
      next = mergeMessages(next, quotedMsg)
      continue
    }
    // If not the first user message, add the current message to the result and start a new one
    if (!isEmptyForModelRequest(next)) {
      ret.push(next)
      isFirstUserMsg = false
    }
    next = msg
  }
  // Add the last message if it's not empty
  if (!isEmptyForModelRequest(next)) {
    ret.push(next)
  }
  // If there's only one system message, convert it to a user message
  if (ret.length === 1 && ret[0].role === 'system') {
    ret[0].role = 'user'
  }
  return ret
}

/**
 * Legacy steering records (alpha builds before true-order persistence) stored
 * the steered user AFTER the assistant reply it interrupted, so old transcripts
 * need their causal order restored before model calls: the model saw those user
 * messages before completing that assistant reply, and they must not remain as
 * unanswered trailing turns.
 *
 * Current builds persist steering in true causal order instead — the
 * interrupted assistant segment is finalized with finishReason 'steered' before
 * the steered user is inserted — so their records are skipped here and need no
 * reordering. (This also covers the degraded failure shape where a
 * continuation could not be created: the owning assistant then keeps a normal
 * finishReason and its trailing steered user is reordered like a legacy
 * record.)
 *
 * Multiple consecutive steered messages keep their original order. The
 * transform is idempotent, which lets both context construction (before message
 * limits/compaction) and final request sequencing apply it safely.
 */
export function orderSteeredMessagesForModel(messages: Message[]): Message[] {
  const ordered = [...messages]
  for (let index = 1; index < ordered.length; index += 1) {
    const message = ordered[index]
    if (message.role !== 'user' || !message.steered) continue

    // A compaction summary may have been inserted between a legacy steered
    // user and the assistant it interrupted (the summary is persisted right
    // after its boundary message). Look through summaries so the causal
    // restore still reaches the interrupted assistant; otherwise the steered
    // user stays after the boundary and shows up in both the summary and the
    // post-boundary context.
    let targetIndex = index
    while (targetIndex > 0 && ordered[targetIndex - 1].isSummary) {
      targetIndex -= 1
    }
    if (targetIndex === 0) continue

    const previous = ordered[targetIndex - 1]
    if (previous.role !== 'assistant' || previous.finishReason === 'steered') continue

    ordered.splice(index, 1)
    ordered.splice(targetIndex - 1, 0, message)
  }
  return ordered
}
