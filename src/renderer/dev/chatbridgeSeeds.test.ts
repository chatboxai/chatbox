import type { SessionMeta } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(async (sessionInput: { name: string }) => ({
    id: `seeded-${sessionInput.name}`,
    ...sessionInput,
  })),
  deleteSession: vi.fn(async () => undefined),
  listSessionsMeta: vi.fn(async (): Promise<SessionMeta[]> => []),
  setBlob: vi.fn(async () => undefined),
  delBlob: vi.fn(async () => undefined),
}))

vi.mock('@/stores/chatStore', () => ({
  createSession: mocks.createSession,
  deleteSession: mocks.deleteSession,
  listSessionsMeta: mocks.listSessionsMeta,
}))

vi.mock('@/storage', () => ({
  default: {
    setBlob: mocks.setBlob,
    delBlob: mocks.delBlob,
  },
}))

import {
  getChatBridgeLiveSeedCatalog,
  getExistingChatBridgeSeedSessions,
  isChatBridgeLiveSeedSession,
  reseedChatBridgeLiveSeedSessions,
} from './chatbridgeSeeds'

describe('chatbridge seed helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recognizes seeded session names from the live seed catalog', () => {
    const lifecycleFixture = getChatBridgeLiveSeedCatalog()[0]

    expect(isChatBridgeLiveSeedSession(lifecycleFixture.name)).toBe(true)
    expect(isChatBridgeLiveSeedSession('Untitled chat')).toBe(false)
  })

  it('maps existing seeded sessions back onto the fixture catalog', () => {
    const fixtures = getChatBridgeLiveSeedCatalog()
    const rows = getExistingChatBridgeSeedSessions([
      {
        id: 'session-1',
        name: fixtures.find((fixture) => fixture.id === 'history-and-preview')?.name || '',
        type: 'chat',
      },
    ])

    expect(rows.find((row) => row.fixture.id === 'lifecycle-tour')?.existing).toBeUndefined()
    expect(rows.find((row) => row.fixture.id === 'history-and-preview')?.existing?.id).toBe('session-1')
  })

  it('reseeds selected fixtures by clearing previous sessions and writing fixture blobs', async () => {
    const previewFixture = getChatBridgeLiveSeedCatalog().find((fixture) => fixture.id === 'history-and-preview')
    mocks.listSessionsMeta.mockResolvedValue([
      {
        id: 'old-history-preview',
        name: previewFixture?.name || '',
        type: 'chat',
      },
    ])

    const seededSessions = await reseedChatBridgeLiveSeedSessions(['history-and-preview'])

    expect(mocks.deleteSession).toHaveBeenCalledWith('old-history-preview')
    expect(mocks.setBlob).toHaveBeenCalledTimes(1)
    expect(mocks.createSession).toHaveBeenCalledTimes(1)
    expect(seededSessions).toHaveLength(1)
    expect(seededSessions[0].fixture.id).toBe('history-and-preview')
  })
})
