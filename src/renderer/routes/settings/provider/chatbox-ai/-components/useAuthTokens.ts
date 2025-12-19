import { useCallback, useMemo } from 'react'
import { authInfoStore, useAuthInfoStore } from '@/stores/authInfoStore'
import * as premiumActions from '@/stores/premiumActions'
import queryClient from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import type { AuthTokens } from './types'

export function useAuthTokens() {
  const accessToken = useAuthInfoStore((state) => state.accessToken)
  const refreshToken = useAuthInfoStore((state) => state.refreshToken)

  const isLoggedIn = useMemo(() => {
    return !!accessToken && !!refreshToken
  }, [accessToken, refreshToken])

  const saveAuthTokens = useCallback(async (tokens: AuthTokens) => {
    try {
      await authInfoStore.getState().setTokens(tokens)
      console.log('✅ Tokens saved to store')
    } catch (error) {
      console.error('❌ Failed to save tokens:', error)
      throw error
    }
  }, [])

  const clearAuthTokens = useCallback(async () => {
    try {
      const settings = settingsStore.getState()
      if (settings.licenseActivationMethod === 'login') {
        console.log('🔥 Deactivating login-activated license')
        await premiumActions.deactivate()
      }

      authInfoStore.getState().clearTokens()

      queryClient.removeQueries({ queryKey: ['userProfile'] })
      queryClient.removeQueries({ queryKey: ['userLicenses'] })
      queryClient.removeQueries({ queryKey: ['licenseDetail'] })
      queryClient.removeQueries({ queryKey: ['license-detail'] })

      console.log('✅ Auth tokens and user cache cleared')
    } catch (error) {
      console.error('Failed to clear auth tokens:', error)
    }
  }, [])

  return {
    isLoggedIn,
    clearAuthTokens,
    saveAuthTokens,
  }
}
