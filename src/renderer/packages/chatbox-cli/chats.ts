import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { rendererApplication } from '@/app/renderer-application'
import { SessionSearchService } from '@chatbox/core/application/session'
import type { SessionTranscriptCursor } from '@chatbox/core/ports'
import { z } from 'zod'
import { booleanFlag, ChatboxCliUsageError, integerFlag, stringFlag } from './parser'
import type { ChatboxCliCommandDefinition } from './types'

const EXCERPT_LENGTH = 400

function isReadableConversationMessage(message: Message): boolean {
  return !message.backgroundTask && (message.role === 'user' || message.role === 'assistant')
}

function excerpt(message: Message): string {
  const text = getMessageText(message, true, false).trim()
  if (text.length <= EXCERPT_LENGTH) return text
  return `${text.slice(0, EXCERPT_LENGTH - 1)}…`
}

function compactMessage(message: Message, thread?: { id: string; name: string }): Record<string, unknown> {
  return {
    messageId: message.id,
    role: message.role,
    timestamp: message.timestamp,
    text: excerpt(message),
    images: message.contentParts
      .filter((part) => part.type === 'image')
      .slice(0, 16)
      .map((part) => ({ storageKey: part.storageKey })),
    files: message.files?.slice(0, 10).map((file) => file.name),
    threadId: thread?.id,
    threadName: thread?.name,
  }
}

const cursorSchema = z.object({
  sessionId: z.string(),
  revision: z.number().int().nonnegative(),
  threadId: z.string(),
  threadSeq: z.number().int(),
  messageId: z.string().nullable(),
  direction: z.enum(['before', 'after']),
  limit: z.number().int().min(1).max(50),
  maxBytes: z.number().int().positive(),
  scope: z.literal('transcript'),
})

function readCursor(value: string | undefined): SessionTranscriptCursor | undefined {
  if (!value || value === '0') return undefined
  try {
    if (value.length > 4096) throw new Error('Cursor too large')
    return cursorSchema.parse(JSON.parse(decodeURIComponent(value)))
  } catch {
    throw new ChatboxCliUsageError('Invalid history cursor. Start a new read without --cursor.')
  }
}

export const chatCommands: ChatboxCliCommandDefinition[] = [
  {
    path: ['chats', 'list'],
    description: 'List conversation metadata. Reading history does not require approval.',
    usage: 'chatbox chats list [--limit 10] [--cursor 0] [--archived]',
    async execute({ parsed }) {
      const limit = integerFlag(parsed, 'limit', { defaultValue: 10, min: 1, max: 20 })
      const cursor = integerFlag(parsed, 'cursor', { defaultValue: 0, min: 0, max: 10_000_000 })
      const archived = booleanFlag(parsed, 'archived')
      const page = archived
        ? await rendererApplication.sessions.listArchivedSessionsMetaPage(cursor, limit)
        : await rendererApplication.sessions.listSessionsMetaPage(cursor, limit)
      return {
        scope: 'global',
        items: page.items.map((item) => ({
          id: item.id,
          name: item.name,
          type: item.type ?? 'chat',
          starred: Boolean(item.starred),
          archivedAt: item.archivedAt,
          createdAt: item.createdAt,
        })),
        nextCursor: page.nextCursor,
        total: page.total,
        archived,
      }
    },
  },
  {
    path: ['chats', 'search'],
    description: 'Search message text across conversation history without approval.',
    usage: 'chatbox chats search <query> [--limit 10]',
    async execute({ parsed }) {
      const query = parsed.positionals.join(' ').trim()
      if (!query) throw new ChatboxCliUsageError('Missing search query.')
      const limit = integerFlag(parsed, 'limit', { defaultValue: 10, min: 1, max: 20 })
      const result = await new SessionSearchService(rendererApplication.sessions).search(query, {
        limit,
        conversationOnly: true,
        hideSystemPromptMessage: true,
      })
      return { scope: 'global', query, ...result }
    },
  },
  {
    path: ['chats', 'read'],
    description: 'Read compact user/assistant messages from one conversation without approval.',
    usage: 'chatbox chats read <session-id> [--limit 20] [--cursor <next-cursor>]',
    async execute({ parsed }) {
      const sessionId = parsed.positionals[0]
      if (!sessionId) throw new ChatboxCliUsageError('Missing session id.')
      const cursor = readCursor(stringFlag(parsed, 'cursor'))
      const limit = integerFlag(parsed, 'limit', { defaultValue: cursor?.limit ?? 20, min: 1, max: 50 })
      const source = await rendererApplication.sessions.getSessionHeader(sessionId)
      if (!source) throw new ChatboxCliUsageError(`Conversation not found: ${sessionId}`)
      const page = await rendererApplication.sessions.readSessionTranscriptWindow({
        sessionId,
        limit,
        maxBytes: 2 * 1024 * 1024,
        expectedRevision: cursor?.revision ?? source.revision,
        ...(cursor ? { cursor } : { origin: 'tail' }),
      })
      if (!page) throw new ChatboxCliUsageError(`Conversation not found: ${sessionId}`)
      const threads = new Map(page.threads.map((thread) => [thread.threadId, thread]))
      return {
        scope: 'session',
        session: { id: source.header.id, name: source.header.name, type: source.header.type ?? 'chat' },
        messages: page.messages
          .filter(
            ({ message }) =>
              isReadableConversationMessage(message) &&
              Boolean(
                excerpt(message) || message.files?.length || message.contentParts.some((part) => part.type === 'image')
              )
          )
          .map(({ message, threadId }) =>
            compactMessage(message, { id: threadId, name: threads.get(threadId)?.name ?? '' })
          ),
        nextCursor: page.older ? encodeURIComponent(JSON.stringify(page.older)) : null,
      }
    },
  },
]
