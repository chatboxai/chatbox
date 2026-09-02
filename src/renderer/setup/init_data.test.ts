import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionMetaStorage } from '@/storage/SessionMetaStorage'
import { initData } from './init_data'

const metaStorage = vi.hoisted(() => ({
  getAllTotal: vi.fn(),
  createMany: vi.fn(),
}))

const storageMock = vi.hoisted(() => ({
  setItemNow: vi.fn(),
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

vi.mock('@/storage', () => ({
  default: storageMock,
}))

vi.mock('@/storage/StoreStorage', () => ({
  StorageKeyGenerator: {
    session: (id: string) => `session:${id}`,
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
    storageMock.setItemNow.mockResolvedValue(undefined)
  })

  it('uses all session meta records to decide whether default sessions are needed', async () => {
    metaStorage.getAllTotal.mockResolvedValue(1)

    await initData()

    expect(metaStorage.getAllTotal).toHaveBeenCalledTimes(1)
    expect(storageMock.setItemNow).not.toHaveBeenCalled()
    expect(metaStorage.createMany).not.toHaveBeenCalled()
  })

  it('creates default sessions when session meta storage is empty', async () => {
    metaStorage.getAllTotal.mockResolvedValue(0)

    await initData()

    expect(storageMock.setItemNow).toHaveBeenCalled()
    expect(metaStorage.createMany).toHaveBeenCalled()
  })
})

metaStorage satisfies Pick<SessionMetaStorage, 'getAllTotal' | 'createMany'>
