import { createStore, useStore } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { AuthTokens } from '../routes/settings/provider/chatbox-ai/-components/types'

interface AuthTokensState {
  accessToken: string | null
  refreshToken: string | null
}

interface AuthTokensActions {
  setTokens: (tokens: AuthTokens) => void
  clearTokens: () => void
  getTokens: () => AuthTokens | null
}

const initialState: AuthTokensState = {
  accessToken: null,
  refreshToken: null,
}

export const authInfoStore = createStore<AuthTokensState & AuthTokensActions>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        ...initialState,

        setTokens: (tokens: AuthTokens) => {
          set((state) => {
            state.accessToken = tokens.accessToken
            state.refreshToken = tokens.refreshToken
          })
        },

        clearTokens: () => {
          set((state) => {
            state.accessToken = null
            state.refreshToken = null
          })
        },

        getTokens: () => {
          const state = get()
          if (state.accessToken && state.refreshToken) {
            return {
              accessToken: state.accessToken,
              refreshToken: state.refreshToken,
            }
          }
          return null
        },
      })),
      {
        name: 'chatbox-ai-auth-info',
        version: 0,
        partialize: (state) => ({
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
        }),
      }
    )
  )
)

export function useAuthInfoStore<U>(selector: Parameters<typeof useStore<typeof authInfoStore, U>>[1]) {
  return useStore<typeof authInfoStore, U>(authInfoStore, selector)
}

export const useAuthTokens = () => {
  return useAuthInfoStore((state) => ({
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    setTokens: state.setTokens,
    clearTokens: state.clearTokens,
    getTokens: state.getTokens,
  }))
}
