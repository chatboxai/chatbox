import { describe, expect, test } from 'vitest'
import type { PersistStorage, StorageValue } from 'zustand/middleware'
import {
  AUTH_INFO_PERSIST_KEY,
  type AuthInfoPersistedState,
  createAuthInfoStore,
  createLastUsedModelStore,
  LAST_USED_MODEL_PERSIST_KEY,
  type LastUsedModelState,
} from '.'

class MemoryPersistStorage<T> implements PersistStorage<T> {
  readonly values = new Map<string, StorageValue<T>>()

  async getItem(name: string): Promise<StorageValue<T> | null> {
    return this.values.get(name) ?? null
  }

  async setItem(name: string, value: StorageValue<T>): Promise<void> {
    this.values.set(name, value)
  }

  async removeItem(name: string): Promise<void> {
    this.values.delete(name)
  }
}

describe('cross-platform Zustand stores', () => {
  test('auth store preserves the existing key, version, hydration, and actions', async () => {
    const storage = new MemoryPersistStorage<AuthInfoPersistedState>()
    storage.values.set(AUTH_INFO_PERSIST_KEY, {
      state: { accessToken: 'access', refreshToken: 'refresh' },
      version: 0,
    })
    const store = createAuthInfoStore({ storage, skipHydration: true })

    await store.persist.rehydrate()

    expect(store.getState().getTokens()).toEqual({ accessToken: 'access', refreshToken: 'refresh' })
    store.getState().clearTokens()
    expect(store.getState().getTokens()).toBeNull()
  })

  test('last-used-model store hydrates through an injected async storage', async () => {
    const storage = new MemoryPersistStorage<LastUsedModelState>()
    storage.values.set(LAST_USED_MODEL_PERSIST_KEY, {
      state: { chat: { provider: 'openai', modelId: 'gpt-5' } },
      version: 0,
    })
    const store = createLastUsedModelStore({ storage, skipHydration: true })

    await store.persist.rehydrate()

    expect(store.getState().chat).toEqual({ provider: 'openai', modelId: 'gpt-5' })
    store.getState().setTaskModel('openai', 'gpt-5-codex')
    expect(store.getState().task).toEqual({ provider: 'openai', modelId: 'gpt-5-codex' })
  })
})
