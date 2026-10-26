import {
  DEFAULT_TRANSCRIPT_PAGE_BYTES,
  type SessionTranscriptPage,
  type SessionTranscriptRequest,
} from '@chatbox/core/ports'
import { Theme, type Message, type SessionMetaPage, type Settings } from '@chatbox/core'
import { tool } from 'ai'
import { z } from 'zod'
import { throwIfWorkAborted } from './abort'

export interface MobileProductInfoHost {
  imageCommands?: {
    execute(
      argv: string[],
      context: { sessionId: string; toolCallId: string; signal: AbortSignal }
    ): Promise<Record<string, unknown>>
  }
  getSettings(): Settings
  refreshAccount(): Promise<boolean>
  getVersion(): Promise<{ installedVersion: string; platform: string }>
  listChats(cursor: number, limit: number, archived: boolean): Promise<SessionMetaPage>
  readChatPage(request: SessionTranscriptRequest): Promise<SessionTranscriptPage | null>
}

const commands = [
  'capabilities',
  'help',
  'version',
  'account status',
  'account license',
  'account quota',
  'account refresh',
  'settings list',
  'settings get <key>',
  'chats list [--limit 10] [--cursor 0] [--archived]',
  'chats read <id> [--limit 20] [--cursor <nextCursor>]',
  'chats search <query> [--limit 10] [--cursor <nextCursor>] [--archived]',
]
const inputSchema = z.object({ argv: z.array(z.string().max(32000)).min(1).max(16) }).strict()

function account(settings: Settings) {
  const detail = settings.licenseDetail
  return {
    signedIn: settings.licenseActivationMethod === 'login',
    licenseConfigured: Boolean(settings.licenseKey),
    activationMethod: settings.licenseActivationMethod ?? 'none',
    hasExpiredLicense: Boolean(settings.hasExpiredLicense),
    plan: detail
      ? { name: detail.name, plan: detail.plan, status: detail.status, expiresAt: detail.expires_at }
      : undefined,
    quota: detail
      ? {
          unifiedTokens: {
            used: detail.unified_token_usage,
            total: detail.unified_token_limit,
            remainingPercentage: Number(
              (
                100 *
                Math.min(
                  1,
                  Math.max(
                    0,
                    detail.unified_token_limit > 0
                      ? 1 - detail.unified_token_usage / detail.unified_token_limit
                      : detail.remaining_quota_unified
                  )
                )
              ).toFixed(1)
            ),
            nextRefreshTime: detail.token_next_refresh_time,
            expireTime: detail.token_expire_time,
          },
          expansionPack: { used: detail.expansion_pack_usage, total: detail.expansion_pack_limit },
          image: { used: detail.image_used_count, total: detail.image_total_quota },
        }
      : undefined,
  }
}

function safeSettings(settings: Settings) {
  return {
    'appearance.theme': settings.theme === Theme.Dark ? 'dark' : settings.theme === Theme.Light ? 'light' : 'system',
    'appearance.language': settings.language,
    'appearance.font-size': settings.fontSize,
    'chat.stream': settings.stream !== false,
    'chat.temperature': settings.temperature ?? 0.7,
    'chat.max-context-messages': settings.maxContextMessageCount,
  }
}

function compactMessage(message: Message, threadId: string) {
  const text = message.contentParts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  return {
    messageId: message.id,
    role: message.role,
    timestamp: message.timestamp,
    threadId,
    images: message.contentParts
      .filter((part) => part.type === 'image')
      .slice(0, 16)
      .map((part) => ({ storageKey: part.storageKey })),
    text: text.slice(0, 1000),
    truncated: text.length > 1000,
  }
}
function readable(message: Message) {
  return !message.backgroundTask && (message.role === 'user' || message.role === 'assistant')
}
const rowCursorSchema = z
  .object({
    sessionId: z.string(),
    revision: z.number().int().nonnegative(),
    threadId: z.string(),
    threadOrder: z.number().int(),
    messageId: z.string().nullable(),
    direction: z.enum(['before', 'after']),
    limit: z.number().int().min(1).max(50),
    maxBytes: z.literal(DEFAULT_TRANSCRIPT_PAGE_BYTES),
    scope: z.literal('transcript'),
  })
  .strict()
const searchCursorSchema = z
  .object({
    version: z.literal(1),
    query: z.string(),
    archived: z.boolean(),
    sessionIndex: z.number().int().nonnegative(),
    sessionId: z.string().optional(),
    cursor: rowCursorSchema.optional(),
    revision: z.number().int().nonnegative().optional(),
    offset: z.number().int().min(0).max(50),
  })
  .strict()
type SearchCursor = z.infer<typeof searchCursorSchema>
function encodeCursor(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value))
}
function decodeCursor(value: string): unknown {
  return JSON.parse(decodeURIComponent(value))
}

function integer(value: string, max = 10_000_000) {
  if (!/^\d+$/.test(value) || Number(value) > max) throw new Error('Invalid pagination argument')
  return Number(value)
}

export function buildMobileProductInfoTool(host: MobileProductInfoHost, signal: AbortSignal, sessionId?: string) {
  return tool({
    description:
      'Read Chatbox account/quota, allowlisted settings and local conversation history. Controlled virtual CLI, not a shell. Use argv ["capabilities"] for commands. Use capabilities to discover available operations. Image generation requires user confirmation when supported. Settings writes are unsupported.',
    inputSchema,
    execute: async (input, options) => {
      const currentSignal = options.abortSignal ?? signal
      throwIfWorkAborted(currentSignal)
      const { argv } = inputSchema.parse(input)
      const [domain, action, ...args] = argv
      try {
        if (domain === 'capabilities' || domain === 'help')
          return {
            commands: host.imageCommands
              ? [
                  ...commands,
                  'image models',
                  'image generate --prompt <text> [--provider <id>] [--model <id>] [--count <1-4>] [--aspect-ratio <ratio>] [--reference-images <json-array>]',
                  'image status <record-id>',
                ]
              : commands,
            readOnly: !host.imageCommands,
            imageGeneration: Boolean(host.imageCommands),
          }
        if (domain === 'image' && host.imageCommands && sessionId) {
          return await host.imageCommands.execute([action, ...args], {
            sessionId,
            toolCallId: options.toolCallId,
            signal: currentSignal,
          })
        }
        if (domain === 'version' && argv.length === 1) return await host.getVersion()
        if (domain === 'account' && argv.length === 2 && ['status', 'license', 'quota', 'refresh'].includes(action)) {
          const refreshed = action === 'refresh' ? await host.refreshAccount() : undefined
          throwIfWorkAborted(currentSignal)
          const status = account(host.getSettings())
          if (action === 'quota')
            return { cached: true, quota: status.quota, licenseConfigured: status.licenseConfigured }
          if (action === 'license') {
            const { quota: _quota, ...license } = status
            return license
          }
          return {
            ...status,
            cached: action !== 'refresh' || !refreshed,
            ...(action === 'refresh' ? { refreshed } : {}),
          }
        }
        if (domain === 'settings') {
          const settings = safeSettings(host.getSettings())
          const location = 'Chatbox Settings'
          if (action === 'list' && !args.length)
            return { readOnly: true, location, items: Object.entries(settings).map(([key, value]) => ({ key, value })) }
          if (action === 'get' && args.length === 1 && Object.hasOwn(settings, args[0]))
            return { key: args[0], value: settings[args[0] as keyof typeof settings], readOnly: true, location }
          return {
            error:
              'Unsupported setting or operation. Use settings list. Changes must be made manually in Chatbox Settings.',
          }
        }
        if (domain !== 'chats' || !['list', 'read', 'search'].includes(action))
          return { error: 'Unsupported command. Use capabilities.' }
        const rest = [...args]
        const target = action === 'list' ? '' : (rest.shift() ?? '')
        if (action !== 'list' && !target?.trim()) return { error: 'Missing conversation id or search query.' }
        const flags = new Map<string, string>()
        while (rest.length) {
          const flag = rest.shift() ?? ''
          if (!['--limit', '--cursor', '--archived'].includes(flag) || flags.has(flag)) throw new Error('Invalid flag')
          if (flag === '--archived') flags.set(flag, 'true')
          else {
            const value = rest.shift()
            if (!value) throw new Error('Missing flag value')
            flags.set(flag, value)
          }
        }
        const limit = integer(flags.get('--limit') ?? (action === 'read' ? '20' : '10'), action === 'read' ? 50 : 20)
        if (limit < 1) throw new Error('Invalid limit')
        const archived = flags.has('--archived')
        if (action === 'list') {
          const page = await host.listChats(integer(flags.get('--cursor') ?? '0'), limit, archived)
          throwIfWorkAborted(currentSignal)
          return {
            items: page.items.map(({ id, name, type, createdAt, archivedAt }) => ({
              id,
              name: name.slice(0, 200),
              type,
              createdAt,
              archivedAt,
            })),
            nextCursor: page.nextCursor,
            total: page.total,
            archived,
          }
        }
        if (action === 'read') {
          if (archived) throw new Error('Unsupported flag')
          const cursor = flags.has('--cursor') ? rowCursorSchema.parse(decodeCursor(flags.get('--cursor')!)) : undefined
          if (cursor && (cursor.sessionId !== target || cursor.limit !== limit || cursor.direction !== 'before'))
            throw new Error('Invalid read cursor')
          const page = await host.readChatPage({ sessionId: target, limit, origin: 'tail', cursor })
          throwIfWorkAborted(currentSignal)
          if (!page) return { error: 'Conversation not found.' }
          return {
            sessionId: page.record.id,
            name: page.record.name.slice(0, 200),
            messages: page.messages
              .filter((row) => readable(row.message))
              .map((row) => compactMessage(row.message, row.threadId)),
            nextCursor: page.older ? encodeCursor(page.older) : null,
            hasMore: page.older !== null,
          }
        }
        let position: SearchCursor = flags.has('--cursor')
          ? searchCursorSchema.parse(decodeCursor(flags.get('--cursor')!))
          : { version: 1, query: target, archived, sessionIndex: 0, offset: 0 }
        if (position.query !== target || position.archived !== archived) throw new Error('Invalid search cursor')
        const hits: Array<ReturnType<typeof compactMessage> & { sessionId: string; sessionName: string }> = []
        for (let scanned = 0; scanned < 20; scanned++) {
          throwIfWorkAborted(currentSignal)
          const chats = await host.listChats(position.sessionIndex, 1, archived)
          const chat = chats.items[0]
          if (!chat) return { hits, nextCursor: null, hasMore: false, archived }
          if (position.sessionId && position.sessionId !== chat.id) throw new Error('Search list changed')
          const page = await host.readChatPage({
            sessionId: chat.id,
            limit: 50,
            origin: 'head',
            cursor: position.cursor,
            expectedRevision: position.revision,
          })
          throwIfWorkAborted(currentSignal)
          let following: SearchCursor | null = page?.newer
            ? {
                version: 1,
                query: target,
                archived,
                sessionIndex: position.sessionIndex,
                sessionId: chat.id,
                cursor: rowCursorSchema.parse(page.newer),
                revision: page.revision,
                offset: 0,
              }
            : chats.nextCursor === null
              ? null
              : { version: 1, query: target, archived, sessionIndex: chats.nextCursor, offset: 0 }
          for (let index = position.offset; page && index < page.messages.length; index++) {
            const row = page.messages[index]
            if (!readable(row.message)) continue
            const fullText = row.message.contentParts
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n')
            if (!fullText.toLocaleLowerCase().includes(target.toLocaleLowerCase())) continue
            hits.push({
              sessionId: chat.id,
              sessionName: chat.name.slice(0, 200),
              ...compactMessage(row.message, row.threadId),
            })
            if (hits.length === limit) {
              if (index + 1 < page.messages.length)
                following = { ...position, sessionId: chat.id, revision: page.revision, offset: index + 1 }
              return {
                hits,
                nextCursor: following ? encodeCursor(following) : null,
                hasMore: following !== null,
                archived,
              }
            }
          }
          if (!following) return { hits, nextCursor: null, hasMore: false, archived }
          position = following
        }
        return { hits, nextCursor: encodeCursor(position), hasMore: true, archived }
      } catch {
        throwIfWorkAborted(currentSignal)
        return {
          error: 'Command failed. Check capabilities and arguments, or retry when account/storage access is available.',
        }
      }
    },
  })
}
