import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionMetaStorage } from '@/storage/SessionMetaStorage'
import { initData } from './init_data'

const metaStorage = vi.hoisted(() => ({
  getAllTotal: vi.fn(),
  createMany: vi.fn(),
}))

const sessionRepositoryMock = vi.hoisted(() => ({
  createSessionRows: vi.fn(),
}))

vi.mock('@/adapters/CurrentSessionRepository', () => ({
  CurrentSessionRepository: class {
    createSessionRows = sessionRepositoryMock.createSessionRows
  },
}))

vi.mock('@/packages/initial_data', () => ({
  defaultSessionsForCN: [],
  defaultSessionsForEN: [
    {
      id: 'default-session',
      name: 'Default Session',
      messages: [],
      type: 'chat',
    },
  ],
}))

vi.mock('@/platform', () => ({
  default: {
    getLocale: vi.fn(() => Promise.resolve('en')),
  },
}))

vi.mock('@/stores/sessionHelpers', () => ({
  getMetaStorage: vi.fn(() => Promise.resolve(metaStorage)),
  getSessionMeta: (session: { id: string; name: string; type: 'chat' | 'picture' }) => ({
    id: session.id,
    name: session.name,
    type: session.type,
  }),
}))

describe('initData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    metaStorage.createMany.mockResolvedValue(undefined)
    sessionRepositoryMock.createSessionRows.mockResolvedValue(undefined)
  })

  it('uses all session meta records to decide whether default sessions are needed', async () => {
    metaStorage.getAllTotal.mockResolvedValue(1)

    await initData()

    expect(metaStorage.getAllTotal).toHaveBeenCalledTimes(1)
    expect(sessionRepositoryMock.createSessionRows).not.toHaveBeenCalled()
    expect(metaStorage.createMany).not.toHaveBeenCalled()
  })

  it('creates default sessions when session meta storage is empty', async () => {
    metaStorage.getAllTotal.mockResolvedValue(0)

    await initData()

    expect(sessionRepositoryMock.createSessionRows).toHaveBeenCalledWith(
      {
        id: 'default-session',
        name: 'Default Session',
        type: 'chat',
      },
      []
    )
    expect(metaStorage.createMany).toHaveBeenCalled()
  })

  it('does not publish metadata when creating default rows fails', async () => {
    metaStorage.getAllTotal.mockResolvedValue(0)
    sessionRepositoryMock.createSessionRows.mockRejectedValueOnce(new Error('session write failed'))

    await expect(initData()).rejects.toThrow('session write failed')

    expect(metaStorage.createMany).not.toHaveBeenCalled()
  })
})

metaStorage satisfies Pick<SessionMetaStorage, 'getAllTotal' | 'createMany'>
