import { assign, cloneDeep, omit } from 'lodash'
import type { Message, MessageAppLifecycle, MessageContentParts, MessagePicture, SearchResultItem } from '../types'
import { countWord } from './word_count'

type MessageContentPartLike = {
  type?: unknown
  text?: unknown
  appId?: unknown
  appName?: unknown
  appInstanceId?: unknown
  lifecycle?: unknown
  state?: unknown
  summary?: unknown
  summaryForModel?: unknown
  toolCallId?: unknown
  bridgeSessionId?: unknown
  snapshot?: unknown
  values?: unknown
  error?: unknown
  title?: unknown
  description?: unknown
  statusText?: unknown
  fallbackTitle?: unknown
  fallbackText?: unknown
}

const APP_LIFECYCLES = new Set<MessageAppLifecycle>(['launching', 'ready', 'active', 'complete', 'error', 'stale'])

function getNormalizedAppLifecycle(part: MessageContentPartLike): MessageAppLifecycle | null {
  if (typeof part.lifecycle === 'string' && APP_LIFECYCLES.has(part.lifecycle as MessageAppLifecycle)) {
    return part.lifecycle as MessageAppLifecycle
  }
  if (typeof part.state === 'string' && APP_LIFECYCLES.has(part.state as MessageAppLifecycle)) {
    return part.state as MessageAppLifecycle
  }
  return null
}

export function getMessageAppPartText(part: MessageContentPartLike): string {
  const summary = typeof part.summary === 'string' ? part.summary.trim() : ''
  if (summary) {
    return summary
  }

  const appLabel =
    typeof part.appName === 'string' && part.appName.trim()
      ? part.appName.trim()
      : typeof part.appId === 'string' && part.appId.trim()
        ? part.appId.trim()
        : 'App'
  const lifecycle = getNormalizedAppLifecycle(part)

  if (lifecycle === 'error' && typeof part.error === 'string' && part.error.trim()) {
    return `${appLabel} error: ${part.error.trim()}`
  }

  return `${appLabel} lifecycle: ${lifecycle ?? 'unknown'}`
}

function normalizeContentParts(contentParts?: MessageContentParts | MessageContentPartLike[]): MessageContentParts {
  return (contentParts ?? []).map((part) => {
    if (part?.type !== 'app') {
      return part as MessageContentParts[number]
    }

    const lifecycle = getNormalizedAppLifecycle(part)
    if (!lifecycle || typeof part.appId !== 'string' || typeof part.appInstanceId !== 'string') {
      return part as MessageContentParts[number]
    }

    return {
      type: 'app',
      appId: part.appId,
      appInstanceId: part.appInstanceId,
      lifecycle,
      ...(typeof part.appName === 'string' ? { appName: part.appName } : {}),
      ...(typeof part.summary === 'string' ? { summary: part.summary } : {}),
      ...(typeof part.summaryForModel === 'string' ? { summaryForModel: part.summaryForModel } : {}),
      ...(typeof part.toolCallId === 'string' ? { toolCallId: part.toolCallId } : {}),
      ...(typeof part.bridgeSessionId === 'string' ? { bridgeSessionId: part.bridgeSessionId } : {}),
      ...(part.snapshot && typeof part.snapshot === 'object' && !Array.isArray(part.snapshot)
        ? { snapshot: part.snapshot as Record<string, unknown> }
        : {}),
      ...(part.values && typeof part.values === 'object' && !Array.isArray(part.values)
        ? { values: part.values as Record<string, unknown> }
        : {}),
      ...(typeof part.error === 'string' ? { error: part.error } : {}),
      ...(typeof part.title === 'string' ? { title: part.title } : {}),
      ...(typeof part.description === 'string' ? { description: part.description } : {}),
      ...(typeof part.statusText === 'string' ? { statusText: part.statusText } : {}),
      ...(typeof part.fallbackTitle === 'string' ? { fallbackTitle: part.fallbackTitle } : {}),
      ...(typeof part.fallbackText === 'string' ? { fallbackText: part.fallbackText } : {}),
    } satisfies MessageContentParts[number]
  })
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
        if (c.type === 'app') {
          return getMessageAppPartText(c)
        }
        return ''
      })
      .filter((c) => c !== null)
      .join('\n')
  }
  return ''
}

function shouldHydrateFromLegacyContent(contentParts?: MessageContentParts | MessageContentPartLike[]): boolean {
  if (!contentParts?.length) {
    return true
  }

  return contentParts.every((part) => {
    if (part?.type !== 'text') {
      return false
    }

    const text = typeof part.text === 'string' ? part.text.trim() : ''
    return text === '' || text === '...'
  })
}

// 只有这里可以访问 message 的 content / webBrowsing 字段，迁移到 contentParts 字段
export function migrateMessage(
  message: Omit<Message, 'contentParts'> & { contentParts?: MessageContentParts }
): Message {
  const result: Message = {
    id: message.id || '',
    role: message.role || 'user',
    contentParts: normalizeContentParts(message.contentParts),
  }
  // 还是保留原始content字段，删除webBrowsing字段
  assign(result, omit(message, 'webBrowsing'))
  result.contentParts = normalizeContentParts(message.contentParts)

  // 如果 contentParts 不存在，或者 contentParts 为空，或者 contentParts 的内容为 '...'(placeholder)，则使用 content 的值
  if (shouldHydrateFromLegacyContent(result.contentParts) && 'content' in message) {
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

/**
 * SequenceMessages organizes and orders messages to follow the sequence: system -> user -> assistant -> user -> etc.
 * 这个方法只能用于 llm 接口请求前的参数构造，因为会过滤掉消息中的无关字段，所以不适用于其他消息存储的场景
 * 这个方法本质上是 golang API 服务中方法的 TypeScript 实现
 * @param msgs
 * @returns
 */
export function sequenceMessages(msgs: Message[]): Message[] {
  // Merge all system messages first
  let system: Message = {
    id: '',
    role: 'system',
    contentParts: [],
  }
  for (const msg of msgs) {
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
  for (const msg of msgs) {
    // Skip the already processed system messages or empty messages
    if (msg.role === 'system' || isEmptyMessage(msg)) {
      continue
    }
    // Merge consecutive messages from the same role
    if (msg.role === next.role) {
      next = mergeMessages(next, msg)
      continue
    }
    // Merge all assistant messages as a quote block if constructing the first user message
    if (isEmptyMessage(next) && isFirstUserMsg && msg.role === 'assistant') {
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
    if (!isEmptyMessage(next)) {
      ret.push(next)
      isFirstUserMsg = false
    }
    next = msg
  }
  // Add the last message if it's not empty
  if (!isEmptyMessage(next)) {
    ret.push(next)
  }
  // If there's only one system message, convert it to a user message
  if (ret.length === 1 && ret[0].role === 'system') {
    ret[0].role = 'user'
  }
  return ret
}
