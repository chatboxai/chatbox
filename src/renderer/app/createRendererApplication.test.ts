/** biome-ignore-all lint/suspicious/useAwait: In-memory async adapters mirror Promise-based host ports. */

import type { SessionRepositoryPort, SettingsStoragePort } from '@chatbox/core/ports'
import { createAuthInfoStore, createChatQueryClient, createLastUsedModelStore, QueryKeys } from '@chatbox/react'
import type { Session, SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { describe, expect, test, vi } from 'vitest'
import type { PersistStorage, StorageValue } from 'zustand/middleware'
import {
  createRendererApplication,
  type RendererApplication,
  type RendererHostDescriptor,
  type RendererHostKind,
} from './createRendererApplication'

class MemoryPersistStorage<T> implements PersistStorage<T> {
  private readonly values = new Map<string, StorageValue<T>>()

  getItem(name: string): StorageValue<T> | null {
    return this.values.get(name) ?? null
  }

  setItem(name: string, value: StorageValue<T>): void {
    this.values.set(name, value)
  }

  removeItem(name: string): void {
    this.values.delete(name)
  }
}

class MemorySettingsStorage implements SettingsStoragePort {
  value: unknown = null
  read = () => Promise.resolve(this.value)
  write = (value: unknown) => {
    this.value = value
    return Promise.resolve()
  }
  remove = () => {
    this.value = null
    return Promise.resolve()
  }
}

class MemorySessionRepository implements SessionRepositoryPort {
  readonly sessions = new Map<string, Session>()
  readonly records = new Map<string, SessionMetaRecord>()
  initializeCount = 0

  readonly meta = {
    initialize: async () => {
      this.initializeCount += 1
    },
    create: async (record: SessionMetaRecord) => {
      this.records.set(record.id, record)
    },
    createMany: async (records: SessionMetaRecord[]) => {
      for (const record of records) this.records.set(record.id, record)
    },
    update: async (id: string, update: Partial<SessionMetaRecord>) => {
      const current = this.records.get(id)
      if (!current) return null
      const next = { ...current, ...update }
      this.records.set(id, next)
      return next
    },
    getById: async (id: string) => this.records.get(id) ?? null,
    delete: async (id: string) => {
      this.records.delete(id)
    },
    deleteMany: async (ids: string[]) => {
      for (const id of ids) this.records.delete(id)
    },
    getAll: async () => [...this.records.values()],
    getAllIncludingHidden: async () => [...this.records.values()],
    getArchived: async () => [],
    getArchivedPage: async (): Promise<SessionMetaPage> => ({ items: [], nextCursor: null, total: 0 }),
    getPage: async (): Promise<SessionMetaPage> => ({
      items: [...this.records.values()],
      nextCursor: null,
      total: this.records.size,
    }),
    getTotal: async () => this.records.size,
    getAllTotal: async () => this.records.size,
    getArchivedTotal: async () => 0,
    clear: async () => {
      this.records.clear()
    },
  }

  initialize = () => this.meta.initialize()
  getSession = async (id: string) => this.sessions.get(id) ?? null
  setSession = async (session: Session) => {
    this.sessions.set(session.id, session)
  }
  deleteSession = async (id: string) => {
    this.sessions.delete(id)
  }
  getAllSessionIds = async () => [...this.sessions.keys()]
}

function createDependencies() {
  const repository = new MemorySessionRepository()
  const settingsStorage = new MemorySettingsStorage()
  const ensureAutoLaunch = vi.fn()
  return {
    repository,
    settingsStorage,
    ensureAutoLaunch,
    options: {
      authInfoStore: createAuthInfoStore({ storage: new MemoryPersistStorage() }),
      lastUsedModelStore: createLastUsedModelStore({ storage: new MemoryPersistStorage() }),
      sessionRepository: repository,
      settingsStorage,
      session: { createId: () => 'renderer-contract-session' },
      settingsEffectsHost: {
        ensureShortcutConfig: vi.fn(),
        ensureProxyConfig: vi.fn(),
        ensureAutoLaunch,
      },
    },
  }
}

function createHostDescriptor(kind: RendererHostKind): RendererHostDescriptor {
  switch (kind) {
    case 'desktop':
      return {
        kind,
        runtime: 'desktop',
        capabilities: { desktopLike: true, nativeMobile: false },
      }
    case 'web':
      return {
        kind,
        runtime: 'web',
        capabilities: { desktopLike: false, nativeMobile: false },
      }
    case 'capacitor':
      return {
        kind,
        runtime: 'mobile',
        capabilities: { desktopLike: false, nativeMobile: true },
      }
  }
}

async function runRendererApplicationContract(application: RendererApplication, expectedKind: RendererHostKind) {
  await Promise.all([application.bootstrap(), application.bootstrap()])
  expect(application.host.kind).toBe(expectedKind)
  expect(application.settingsStore.getState().hydrationStatus).toBe('hydrated')

  const session = await application.sessions.createSession({ name: expectedKind, type: 'chat', messages: [] })
  expect((await application.sessions.getSession(session.id))?.name).toBe(expectedKind)
  application.generationRuntime.start(session.id, 'message')
  application.dispose()
  expect(application.generationRuntime.get(session.id)).toBeUndefined()
  expect(application.queryClient.getQueryCache().getAll()).toHaveLength(0)
}

describe('Renderer Composition Roots', () => {
  test.each(['desktop', 'web', 'capacitor'] as const)(
    '%s host follows the shared application contract',
    async (kind) => {
      const { options, repository } = createDependencies()
      const application = createRendererApplication({ ...options, host: createHostDescriptor(kind) })
      await runRendererApplicationContract(application, kind)
      expect(repository.initializeCount).toBe(1)
    }
  )

  test('a first write cancels an in-flight session query before updating the cache', async () => {
    const { options, repository } = createDependencies()
    const original: Session = {
      id: 'in-flight-session',
      name: 'Before update',
      type: 'chat',
      messages: [],
    }
    repository.sessions.set(original.id, original)

    let resolveFirstRead: (session: Session | null) => void = () => undefined
    const firstRead = new Promise<Session | null>((resolve) => {
      resolveFirstRead = resolve
    })
    let getSessionCalls = 0
    repository.getSession = vi.fn(async () => {
      getSessionCalls += 1
      if (getSessionCalls === 1) return firstRead
      return repository.sessions.get(original.id) ?? null
    })

    const application = createRendererApplication({ ...options, host: createHostDescriptor('desktop') })
    const pendingQuery = application.sessionQueryBridge.getSession(original.id)
    const pendingQueryResult = pendingQuery.catch((error: unknown) => error)
    await vi.waitFor(() => expect(repository.getSession).toHaveBeenCalledTimes(1))
    const pendingUpdate = application.sessions.updateSession(original.id, { name: 'After update' })

    try {
      await vi.waitFor(() => expect(repository.getSession).toHaveBeenCalledTimes(2))

      resolveFirstRead(original)
      await Promise.all([pendingQueryResult, pendingUpdate])
      expect(application.queryClient.getQueryData<Session>(QueryKeys.ChatSession(original.id))?.name).toBe(
        'After update'
      )
    } finally {
      resolveFirstRead(original)
      await Promise.allSettled([pendingQueryResult, pendingUpdate])
      application.dispose()
    }
  })

  test('dispose leaves an injected QueryClient under host ownership', () => {
    const { options } = createDependencies()
    const queryClient = createChatQueryClient()
    const externalQueryKey = ['host-owned-query']
    queryClient.setQueryData(externalQueryKey, 'preserved')
    const application = createRendererApplication({
      ...options,
      queryClient,
      host: createHostDescriptor('desktop'),
    })

    application.dispose()

    expect(queryClient.getQueryData(externalQueryKey)).toBe('preserved')
    queryClient.clear()
  })
})
