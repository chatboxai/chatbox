import type { Message, Session } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { rendererApplication } from '@/app/renderer-application'
import { searchSessions } from '@/stores/sessionHelpers'
import { booleanFlag, ChatboxCliUsageError, integerFlag } from './parser'
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
    files: message.files?.slice(0, 10).map((file) => file.name),
    threadId: thread?.id,
    threadName: thread?.name,
  }
}

function readableMessages(session: Session): Array<{ message: Message; thread?: { id: string; name: string } }> {
  const current = session.messages.map((message) => ({ message }))
  const history = (session.threads ?? []).flatMap((thread) =>
    thread.messages.map((message) => ({ message, thread: { id: thread.id, name: thread.name } }))
  )
  return [...current, ...history].filter(
    ({ message }) => isReadableConversationMessage(message) && Boolean(excerpt(message) || message.files?.length)
  )
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
      const hits: Record<string, unknown>[] = []

      await searchSessions(query, undefined, (sessions) => {
        for (const session of sessions) {
          for (const message of session.messages) {
            if (hits.length >= limit) return
            if (!isReadableConversationMessage(message)) continue
            hits.push({
              sessionId: session.id,
              sessionName: session.name,
              ...compactMessage(message),
            })
          }
        }
      })
      return { scope: 'global', query, hits, limitReached: hits.length >= limit }
    },
  },
  {
    path: ['chats', 'read'],
    description: 'Read compact user/assistant messages from one conversation without approval.',
    usage: 'chatbox chats read <session-id> [--limit 20] [--cursor 0]',
    async execute({ parsed }) {
      const sessionId = parsed.positionals[0]
      if (!sessionId) throw new ChatboxCliUsageError('Missing session id.')
      const limit = integerFlag(parsed, 'limit', { defaultValue: 20, min: 1, max: 50 })
      const cursor = integerFlag(parsed, 'cursor', { defaultValue: 0, min: 0, max: 10_000_000 })
      const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
      if (!session) throw new ChatboxCliUsageError(`Conversation not found: ${sessionId}`)

      const messages = readableMessages(session)
      const page = messages.slice(cursor, cursor + limit)
      return {
        scope: 'session',
        session: { id: session.id, name: session.name, type: session.type ?? 'chat' },
        messages: page.map(({ message, thread }) => compactMessage(message, thread)),
        nextCursor: cursor + page.length < messages.length ? cursor + page.length : null,
        total: messages.length,
      }
    },
  },
]
