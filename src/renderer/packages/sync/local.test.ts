import type { Session, SessionMetaRecord } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listLocalSyncMetas, listLocalSyncSessions } from './local'

vi.mock('@/stores/chatStore', () => ({
  listAllSessionsMeta: vi.fn(),
}))

vi.mock('@/storage', () => ({
  default: {
    getItem: vi.fn(),
  },
}))

const { listAllSessionsMeta } = await import('@/stores/chatStore')
const { default: storage } = await import('@/storage')

function session(id: string, type?: Session['type']): Session {
  return {
    id,
    type,
    name: id,
    messages: [],
  }
}

function meta(id: string, type?: SessionMetaRecord['type']): SessionMetaRecord {
  return {
    id,
    type,
    name: id,
    sortOrder: 1,
    createdAt: 1,
  }
}

describe('local sync data selection', () => {
  beforeEach(() => {
    vi.mocked(listAllSessionsMeta).mockReset()
    vi.mocked(storage.getItem).mockReset()
  })

  it('lists only chat and legacy chat sessions for sync', async () => {
    vi.mocked(listAllSessionsMeta).mockResolvedValue([
      meta('chat-1', 'chat'),
      meta('legacy-chat'),
      meta('picture-1', 'picture'),
      meta('guide-1', 'guide'),
    ])
    vi.mocked(storage.getItem).mockImplementation((key) => {
      const id = String(key).replace('session:', '')
      return Promise.resolve(session(id, id === 'legacy-chat' ? undefined : 'chat'))
    })

    const sessions = await listLocalSyncSessions()
    const metas = await listLocalSyncMetas()

    expect(sessions.map((item) => item.id)).toEqual(['chat-1', 'legacy-chat'])
    expect(metas.map((item) => item.id)).toEqual(['chat-1', 'legacy-chat'])
    expect(storage.getItem).toHaveBeenCalledTimes(2)
  })

  it('migrates legacy message content before syncing local sessions', async () => {
    vi.mocked(listAllSessionsMeta).mockResolvedValue([meta('legacy-chat')])
    vi.mocked(storage.getItem).mockResolvedValue({
      id: 'legacy-chat',
      name: 'Legacy',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'legacy text',
        },
      ],
    } as unknown as Session)

    const sessions = await listLocalSyncSessions()

    expect(sessions[0].messages[0].contentParts).toEqual([{ type: 'text', text: 'legacy text' }])
  })
})
