import type { DeviceFlowStartResult, OAuthProviderInfo, OAuthResult, OAuthStartResult } from '@shared/oauth'
import { isOAuthExpired, OAuthIpcChannels } from '@shared/oauth'
import { useCallback, useEffect, useRef } from 'react'
import platform from '@/platform'
import { useProviderSettings } from '@/stores/settingsStore'

/**
 * Hook to manage OAuth for a specific provider.
 * Handles all three flow types: callback, code-paste, and device-code.
 * Only functional on desktop platform.
 * Automatically cancels active flows on unmount.
 */
export function useOAuth(
  oauthProviderId: string,
  providerInfo?: OAuthProviderInfo,
  settingsProviderId = oauthProviderId,
  authModeProviderId = settingsProviderId
) {
  const { providerSettings: tokenProviderSettings, setProviderSettings: setTokenProviderSettings } =
    useProviderSettings(settingsProviderId)
  const { providerSettings: authModeProviderSettings, setProviderSettings: setAuthModeProviderSettings } =
    useProviderSettings(authModeProviderId)
  const refreshingRef = useRef(false)
  const mountedRef = useRef(true)

  const isDesktop = platform.type === 'desktop'
  const hasOAuth = !!tokenProviderSettings?.oauth?.accessToken
  const isOAuthActive = authModeProviderSettings?.activeAuthMode === 'oauth' && hasOAuth
  const flowType = providerInfo?.flowType ?? 'callback'

  // Cancel active flow on unmount (navigating away)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (isDesktop) {
        ;(platform as any).ipc.invoke(OAuthIpcChannels.CANCEL, oauthProviderId).catch(() => {})
      }
    }
  }, [isDesktop, oauthProviderId])

  // --- Cancel flow ---
  const cancel = useCallback(async () => {
    if (!isDesktop) return
    try {
      await (platform as any).ipc.invoke(OAuthIpcChannels.CANCEL, oauthProviderId)
    } catch {
      // ignore
    }
  }, [isDesktop, oauthProviderId])

  // --- Callback flow (OpenAI) ---
  const loginCallback = useCallback(async (): Promise<OAuthResult> => {
    if (!isDesktop) return { success: false, error: 'Not desktop' }
    try {
      const resultJson: string = await (platform as any).ipc.invoke(OAuthIpcChannels.LOGIN, oauthProviderId)
      const result: OAuthResult = JSON.parse(resultJson)
      if (result.success && result.credentials && mountedRef.current) {
        setTokenProviderSettings({ oauth: result.credentials })
        setAuthModeProviderSettings({ activeAuthMode: 'oauth' })
      }
      return result
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, [isDesktop, oauthProviderId, setAuthModeProviderSettings, setTokenProviderSettings])

  // --- Code-paste flow (Anthropic) ---
  const startLogin = useCallback(async (): Promise<OAuthStartResult> => {
    if (!isDesktop) return { success: false, error: 'Not desktop' }
    try {
      const resultJson: string = await (platform as any).ipc.invoke(OAuthIpcChannels.START_LOGIN, oauthProviderId)
      return JSON.parse(resultJson)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, [isDesktop, oauthProviderId])

  const exchangeCode = useCallback(
    async (code: string): Promise<OAuthResult> => {
      if (!isDesktop) return { success: false, error: 'Not desktop' }
      try {
        const resultJson: string = await (platform as any).ipc.invoke(
          OAuthIpcChannels.EXCHANGE_CODE,
          oauthProviderId,
          code
        )
        const result: OAuthResult = JSON.parse(resultJson)
        if (result.success && result.credentials && mountedRef.current) {
          setTokenProviderSettings({ oauth: result.credentials })
          setAuthModeProviderSettings({ activeAuthMode: 'oauth' })
        }
        return result
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    [isDesktop, oauthProviderId, setAuthModeProviderSettings, setTokenProviderSettings]
  )

  // --- Device-code flow (GitHub Copilot) ---
  const startDeviceFlow = useCallback(async (): Promise<DeviceFlowStartResult> => {
    if (!isDesktop) return { success: false, error: 'Not desktop' }
    try {
      const resultJson: string = await (platform as any).ipc.invoke(OAuthIpcChannels.START_DEVICE_FLOW, oauthProviderId)
      return JSON.parse(resultJson)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, [isDesktop, oauthProviderId])

  const waitForDeviceToken = useCallback(async (): Promise<OAuthResult> => {
    if (!isDesktop) return { success: false, error: 'Not desktop' }
    try {
      const resultJson: string = await (platform as any).ipc.invoke(OAuthIpcChannels.WAIT_DEVICE_TOKEN, oauthProviderId)
      const result: OAuthResult = JSON.parse(resultJson)
      if (result.success && result.credentials && mountedRef.current) {
        setTokenProviderSettings({ oauth: result.credentials })
        setAuthModeProviderSettings({ activeAuthMode: 'oauth' })
      }
      return result
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, [isDesktop, oauthProviderId, setAuthModeProviderSettings, setTokenProviderSettings])

  // --- Common ---
  const logout = useCallback(() => {
    setTokenProviderSettings({
      oauth: undefined,
    })
    setAuthModeProviderSettings({
      activeAuthMode: authModeProviderSettings?.apiKey ? 'apikey' : undefined,
    })
  }, [authModeProviderSettings?.apiKey, setAuthModeProviderSettings, setTokenProviderSettings])

  const refreshToken = useCallback(async () => {
    if (!isDesktop || !tokenProviderSettings?.oauth || refreshingRef.current) return
    refreshingRef.current = true
    try {
      const resultJson: string = await (platform as any).ipc.invoke(
        OAuthIpcChannels.REFRESH,
        oauthProviderId,
        JSON.stringify(tokenProviderSettings.oauth)
      )
      const result: OAuthResult = JSON.parse(resultJson)
      if (result.success && result.credentials) {
        setTokenProviderSettings({ oauth: result.credentials })
      } else {
        console.error(`[OAuth] Token refresh failed for ${oauthProviderId}:`, result.error)
        setTokenProviderSettings({
          oauth: undefined,
        })
        setAuthModeProviderSettings({
          activeAuthMode: authModeProviderSettings?.apiKey ? 'apikey' : undefined,
        })
      }
    } catch (error) {
      console.error(`[OAuth] Token refresh error for ${oauthProviderId}:`, error)
    } finally {
      refreshingRef.current = false
    }
  }, [
    authModeProviderSettings?.apiKey,
    isDesktop,
    oauthProviderId,
    setAuthModeProviderSettings,
    setTokenProviderSettings,
    tokenProviderSettings?.oauth,
  ])

  // Auto-refresh expired tokens
  useEffect(() => {
    if (!isDesktop || !isOAuthActive || !tokenProviderSettings?.oauth) return

    if (isOAuthExpired(tokenProviderSettings)) {
      refreshToken()
      return
    }

    const expiresAt = tokenProviderSettings.oauth.expiresAt
    if (!expiresAt) return

    const timeUntilExpiry = expiresAt - Date.now()
    if (timeUntilExpiry <= 0) {
      refreshToken()
      return
    }

    const refreshIn = Math.max(timeUntilExpiry - 2 * 60 * 1000, 0)
    const timer = setTimeout(refreshToken, refreshIn)
    return () => clearTimeout(timer)
  }, [isDesktop, isOAuthActive, refreshToken, tokenProviderSettings?.oauth?.expiresAt])

  return {
    isDesktop,
    hasOAuth,
    isOAuthActive,
    flowType,
    loginCallback,
    startLogin,
    exchangeCode,
    startDeviceFlow,
    waitForDeviceToken,
    cancel,
    logout,
    refreshToken,
  }
}
