/** biome-ignore-all lint/suspicious/useAwait: In-memory async adapters mirror Promise-based host ports. */

import type { SessionHeaderRead, SettingsStoragePort } from '@chatbox/core/ports'
import { createAuthInfoStore, createChatQueryClient, createLastUsedModelStore, QueryKeys } from '@chatbox/react'
import type { Session } from '@shared/types'
import { InMemorySessionRepository } from '@chatbox/core/testing'
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

class MemorySessionRepository extends InMemorySessionRepository {
  initializeCount = 0
  readonly initialize = async () => {
    this.initializeCount++
  }
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
  expect((await application.sessions.getSessionHeader(session.id))?.header.name).toBe(expectedKind)
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
    await repository.seedSession(original)
    const originalRead = await repository.getSessionHeader(original.id)
    let resolveFirstRead: (read: SessionHeaderRead | null) => void = () => undefined
    const firstRead = new Promise<SessionHeaderRead | null>((resolve) => {
      resolveFirstRead = resolve
    })
    const readHeader = repository.getSessionHeader.bind(repository)
    vi.spyOn(repository, 'getSessionHeader')
      .mockImplementationOnce(() => firstRead)
      .mockImplementation(readHeader)

    const application = createRendererApplication({ ...options, host: createHostDescriptor('desktop') })
    const pendingQuery = application.queryClient.fetchQuery(
      application.sessionQueryBridge.definitions.header(original.id)
    )
    const pendingQueryResult = pendingQuery.catch((error: unknown) => error)
    await vi.waitFor(() => expect(repository.getSessionHeader).toHaveBeenCalledTimes(1))
    const pendingUpdate = application.sessions.updateSessionHeader(original.id, { name: 'After update' })

    try {
      await pendingUpdate
      resolveFirstRead(originalRead)
      await pendingQueryResult
      expect(
        application.queryClient.getQueryData<SessionHeaderRead>(QueryKeys.ChatSessionHeader(original.id))?.header.name
      ).toBe('After update')
    } finally {
      resolveFirstRead(originalRead)
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
