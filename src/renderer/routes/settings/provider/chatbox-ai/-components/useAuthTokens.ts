import { useCallback, useMemo, useState } from 'react'
import { authInfoStore, useAuthInfoStore } from '@/stores/authInfoStore'
import * as premiumActions from '@/stores/premiumActions'
import queryClient from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import type { AuthTokens } from './types'

export function useAuthTokens() {
  const [afterLogin, setAfterLogin] = useState(false)
  const consumeLogin = useCallback(() => setAfterLogin(false), [])
  const accessToken = useAuthInfoStore((state) => state.accessToken)
  const refreshToken = useAuthInfoStore((state) => state.refreshToken)

  const isLoggedIn = useMemo(() => {
    return !!accessToken && !!refreshToken
  }, [accessToken, refreshToken])

  const saveAuthTokens = useCallback(async (tokens: AuthTokens) => {
    try {
      setAfterLogin(true)
      await authInfoStore.getState().setTokens(tokens)
    } catch (error) {
      setAfterLogin(false)
      console.error('❌ Failed to save tokens:', error)
      throw error
    }
  }, [])

  const clearAuthTokens = useCallback(async () => {
    try {
      const settings = settingsStore.getState()
      if (settings.licenseActivationMethod === 'login') {
        await premiumActions.deactivate()
      }

      settingsStore.setState({ hasExpiredLicense: false })

      // VibeDrop publish key, per-artifact slug map, and session publication
      // history belong to the logged-in account; drop them on logout so the
      // next account starts clean. (The key is also email-bound at read time as
      // defense-in-depth.)
      settingsStore.setState({
        vibedropPublishKey: undefined,
        vibedropSlugs: undefined,
        vibedropSessionPublications: undefined,
      })

      authInfoStore.getState().clearTokens()

      queryClient.removeQueries({ queryKey: ['userProfile'] })
      queryClient.removeQueries({ queryKey: ['userLicenses'] })
      queryClient.removeQueries({ queryKey: ['licenseDetail'] })
      queryClient.removeQueries({ queryKey: ['licenseInspection'] })
      queryClient.removeQueries({ queryKey: ['license-detail'] })
    } catch (error) {
      console.error('Failed to clear auth tokens:', error)
    }
  }, [])

  return {
    isLoggedIn,
    afterLogin,
    consumeLogin,
    clearAuthTokens,
    saveAuthTokens,
  }
}
