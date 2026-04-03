import { CHATBRIDGE_LIVE_SEED_PREFIX } from '@shared/chatbridge/live-seeds'
import type { Session, SessionMeta } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'

const CHAT_SESSIONS_LIST_KEY = 'chat-sessions-list'

vi.mock('@/storage/StoreStorage', () => ({
  StorageKey: {
    ChatSessionsList: CHAT_SESSIONS_LIST_KEY,
  },
  StorageKeyGenerator: {
    session: (id: string) => `session:${id}`,
  },
}))

vi.mock('@/stores/sessionHelpers', () => ({
  getSessionMeta: (session: Session): SessionMeta => ({
    id: session.id,
    name: session.name,
    type: session.type,
    starred: session.starred,
    hidden: session.hidden,
    assistantAvatarKey: session.assistantAvatarKey,
    picUrl: session.picUrl,
  }),
}))

const { backfillPresetSessions, getPresetSessionBundlesForLocale } = await import('./preset_sessions')

function getSessionMeta(session: Session): SessionMeta {
  return {
    id: session.id,
    name: session.name,
    type: session.type,
    starred: session.starred,
    hidden: session.hidden,
    assistantAvatarKey: session.assistantAvatarKey,
    picUrl: session.picUrl,
  }
}

function createPresetSessionStore() {
  const data = new Map<string, unknown>()
  const blobs = new Map<string, string>()

  return {
    data,
    blobs,
    getData: async <T>(key: string, defaultValue: T): Promise<T> => {
      const normalizedKey = String(key)
      return data.has(normalizedKey) ? (data.get(normalizedKey) as T) : defaultValue
    },
    setData: vi.fn(async <T>(key: string, value: T) => {
      data.set(String(key), value)
    }),
    setBlob: vi.fn(async (key: string, value: string) => {
      blobs.set(key, value)
    }),
  }
}

function getChatBridgePresetSessionBundles(locale: string) {
  return getPresetSessionBundlesForLocale(locale).filter(({ session }) => session.name.startsWith(CHATBRIDGE_LIVE_SEED_PREFIX))
}

describe('preset session backfill', () => {
  it('includes the shared ChatBridge live fixtures in the preset bootstrap list', () => {
    expect(getChatBridgePresetSessionBundles('en').map(({ session }) => session.name)).toEqual([
      `${CHATBRIDGE_LIVE_SEED_PREFIX} Lifecycle tour`,
      `${CHATBRIDGE_LIVE_SEED_PREFIX} Degraded completion recovery`,
      `${CHATBRIDGE_LIVE_SEED_PREFIX} Platform recovery`,
      `${CHATBRIDGE_LIVE_SEED_PREFIX} Chess mid-game board context`,
      `${CHATBRIDGE_LIVE_SEED_PREFIX} Drawing Kit doodle dare`,
      `${CHATBRIDGE_LIVE_SEED_PREFIX} Chess runtime`,
      `${CHATBRIDGE_LIVE_SEED_PREFIX} History + preview`,
    ])
  })

  it('writes blob-backed ChatBridge preset fixtures during backfill', async () => {
    const store = createPresetSessionStore()
    const sessionList = await backfillPresetSessions(store, 'en', [])
    const historyBundle = getPresetSessionBundlesForLocale('en').find(
      ({ session }) => session.id === 'chatbox-chat-demo-chatbridge-history-and-preview'
    )

    expect(historyBundle).toBeTruthy()
    expect(sessionList.some((sessionMeta) => sessionMeta.id === historyBundle?.session.id)).toBe(true)
    expect(store.blobs.get('fixture:msg-current-assistant:attachment')).toContain('seeded-story-draft-001')

    const storedSession = store.data.get(`session:${historyBundle!.session.id}`) as Session | undefined
    expect(storedSession?.threadName).toBe('Story Builder Review')
    expect(storedSession?.messages.at(-1)?.contentParts.some((part) => part.type === 'text' && part.text.includes('```html'))).toBe(
      true
    )
  })

  it('repairs preset blobs without overwriting an existing preset session record', async () => {
    const store = createPresetSessionStore()
    const historyBundle = getPresetSessionBundlesForLocale('en').find(
      ({ session }) => session.id === 'chatbox-chat-demo-chatbridge-history-and-preview'
    )
    const historySession = historyBundle!.session
    const sessionStorageKey = `session:${historySession.id}`
    const existingSession = {
      ...historySession,
      threadName: 'Already customized locally',
    }
    const existingSessionList: SessionMeta[] = [getSessionMeta(existingSession)]

    store.data.set(sessionStorageKey, existingSession)
    store.data.set(CHAT_SESSIONS_LIST_KEY, existingSessionList)

    await backfillPresetSessions(store, 'en', existingSessionList)

    expect(store.blobs.get('fixture:msg-current-assistant:attachment')).toContain('seeded-story-draft-001')
    expect(store.data.get(sessionStorageKey)).toEqual(existingSession)
    expect(
      store.setData.mock.calls.some(([key]) => String(key) === sessionStorageKey)
    ).toBe(false)
  })
})
