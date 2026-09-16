import { Theme, type Message, type Session, type SessionMetaPage, type Settings } from '@chatbox/core'
import { tool } from 'ai'
import { z } from 'zod'
import { throwIfWorkAborted } from './abort'

export interface MobileProductInfoHost {
  getSettings(): Settings
  refreshAccount(): Promise<boolean>
  getVersion(): Promise<{ installedVersion: string; platform: string }>
  listChats(cursor: number, limit: number, archived: boolean): Promise<SessionMetaPage>
  getChat(id: string): Promise<Session | null>
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
  'chats read <id> [--limit 20] [--cursor 0]',
  'chats search <query> [--limit 10] [--cursor 0:0] [--archived]',
]
const inputSchema = z.object({ argv: z.array(z.string().max(1000)).min(1).max(16) }).strict()

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

function messages(session: Session) {
  const compact = (message: Message, threadId?: string) => ({
    messageId: message.id,
    role: message.role,
    timestamp: message.timestamp,
    threadId,
    text: message.contentParts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n'),
  })
  return [
    ...session.messages.filter(readable).map((message) => compact(message)),
    ...(session.threads ?? []).flatMap((thread) =>
      thread.messages.filter(readable).map((message) => compact(message, thread.id))
    ),
  ]
}
function readable(message: Message) {
  return !message.backgroundTask && (message.role === 'user' || message.role === 'assistant')
}
function boundedMessage(message: ReturnType<typeof messages>[number]) {
  return { ...message, text: message.text.slice(0, 1000), truncated: message.text.length > 1000 }
}
function integer(value: string, max = 10_000_000) {
  if (!/^\d+$/.test(value) || Number(value) > max) throw new Error('Invalid pagination argument')
  return Number(value)
}

export function buildMobileProductInfoTool(host: MobileProductInfoHost, signal: AbortSignal) {
  return tool({
    description:
      'Read Chatbox account/quota, allowlisted settings and local conversation history. Controlled virtual CLI, not a shell. Use argv ["capabilities"] for commands. Read-only; image generation and settings writes are unsupported.',
    inputSchema,
    execute: async (input, options) => {
      const currentSignal = options.abortSignal ?? signal
      throwIfWorkAborted(currentSignal)
      const { argv } = inputSchema.parse(input)
      const [domain, action, ...args] = argv
      try {
        if (domain === 'capabilities' || domain === 'help') return { commands, readOnly: true, imageGeneration: false }
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
          const cursor = integer(flags.get('--cursor') ?? '0')
          const session = await host.getChat(target)
          throwIfWorkAborted(currentSignal)
          if (!session) return { error: 'Conversation not found.' }
          const items = messages(session)
          return {
            sessionId: session.id,
            name: session.name.slice(0, 200),
            messages: items.slice(cursor, cursor + limit).map(boundedMessage),
            nextCursor: cursor + limit < items.length ? cursor + limit : null,
            total: items.length,
          }
        }
        const cursor = flags.get('--cursor') ?? '0:0'
        if (!/^\d+:\d+$/.test(cursor)) throw new Error('Invalid search cursor')
        let [sessionIndex, messageIndex] = cursor.split(':').map((value) => integer(value))
        const hits: Array<ReturnType<typeof boundedMessage> & { sessionId: string; sessionName: string }> = []
        for (let scanned = 0; scanned < 20; scanned++) {
          throwIfWorkAborted(currentSignal)
          const page = await host.listChats(sessionIndex, 1, archived)
          if (!page.items.length) return { hits, nextCursor: null, archived }
          const session = await host.getChat(page.items[0].id)
          throwIfWorkAborted(currentSignal)
          const items = session ? messages(session) : []
          for (; session && messageIndex < items.length; messageIndex++) {
            if (!items[messageIndex].text.toLocaleLowerCase().includes(target.toLocaleLowerCase())) continue
            hits.push({
              sessionId: session.id,
              sessionName: session.name.slice(0, 200),
              ...boundedMessage(items[messageIndex]),
            })
            if (hits.length === limit) return { hits, nextCursor: `${sessionIndex}:${messageIndex + 1}`, archived }
          }
          if (page.nextCursor === null) return { hits, nextCursor: null, archived }
          sessionIndex = page.nextCursor
          messageIndex = 0
        }
        return { hits, nextCursor: `${sessionIndex}:0`, archived }
      } catch {
        throwIfWorkAborted(currentSignal)
        return {
          error: 'Command failed. Check capabilities and arguments, or retry when account/storage access is available.',
        }
      }
    },
  })
}
