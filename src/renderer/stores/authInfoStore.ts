import {
  type AuthInfoStoreState,
  type AuthTokens,
  createAuthInfoStore,
  useAuthInfoStore as useSharedAuthInfoStore,
} from '@chatbox/react/stores'
import { getSafeStorage } from './safeStorage'

export type { AuthTokens }

// This low-level host adapter is imported while Platform is initialized.
// Keep it independent from the Renderer Composition Root to avoid an ESM cycle.
export const authInfoStore = createAuthInfoStore({
  storage: getSafeStorage(),
})

export function useAuthInfoStore<T>(selector: (state: AuthInfoStoreState) => T): T {
  return useSharedAuthInfoStore(authInfoStore, selector)
}

export function useAuthTokens() {
  return useAuthInfoStore(({ accessToken, refreshToken, setTokens, clearTokens, getTokens }) => ({
    accessToken,
    refreshToken,
    setTokens,
    clearTokens,
    getTokens,
  }))
}
