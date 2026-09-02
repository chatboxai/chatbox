import { type PersistStorage, persist, subscribeWithSelector } from 'zustand/middleware'
import { useStore } from 'zustand/react'
import { createStore } from 'zustand/vanilla'

export const AUTH_INFO_PERSIST_KEY = 'chatbox-ai-auth-info'
export const AUTH_INFO_PERSIST_VERSION = 0

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface AuthInfoState {
  accessToken: string | null
  refreshToken: string | null
}

export interface AuthInfoActions {
  setTokens(tokens: AuthTokens): void
  clearTokens(): void
  getTokens(): AuthTokens | null
}

export type AuthInfoStoreState = AuthInfoState & AuthInfoActions
export type AuthInfoPersistedState = AuthInfoState

export interface CreateAuthInfoStoreOptions {
  storage: PersistStorage<AuthInfoPersistedState>
  skipHydration?: boolean
}

export function createAuthInfoStore(options: CreateAuthInfoStoreOptions) {
  return createStore<AuthInfoStoreState>()(
    subscribeWithSelector(
      persist(
        (set, get) => ({
          accessToken: null,
          refreshToken: null,
          setTokens(tokens) {
            set(tokens)
          },
          clearTokens() {
            set({ accessToken: null, refreshToken: null })
          },
          getTokens() {
            const { accessToken, refreshToken } = get()
            return accessToken && refreshToken ? { accessToken, refreshToken } : null
          },
        }),
        {
          name: AUTH_INFO_PERSIST_KEY,
          version: AUTH_INFO_PERSIST_VERSION,
          storage: options.storage,
          skipHydration: options.skipHydration,
          partialize: ({ accessToken, refreshToken }) => ({ accessToken, refreshToken }),
        }
      )
    )
  )
}

export type AuthInfoStore = ReturnType<typeof createAuthInfoStore>

export function useAuthInfoStore<T>(store: AuthInfoStore, selector: (state: AuthInfoStoreState) => T): T {
  return useStore(store, selector)
}
