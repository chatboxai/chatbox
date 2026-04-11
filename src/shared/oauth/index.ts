import type { ProviderSettings } from '../types'

/**
 * In the open-source edition OAuth is not available.
 * These stubs keep the provider pipeline working without it.
 */

export interface OAuthProviderInfo {
  providerId: string
  name: string
  flowType: 'callback' | 'code-paste' | 'device-code'
}

export interface OAuthCredentials {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
}

export interface OAuthResult {
  success: boolean
  error?: string
  credentials?: OAuthCredentials
}

export interface OAuthStartResult {
  success: boolean
  error?: string
  authUrl?: string
}

export interface DeviceFlowStartResult {
  success: boolean
  error?: string
  deviceCode?: string
  userCode?: string
  verificationUri?: string
  expiresIn?: number
  interval?: number
}

// IPC channel names used by the OAuth flow (desktop-only).
//
// OSS DESIGN NOTE: The ipcMain.handle() registrations for these channels exist
// only in the private/commercial edition of the Electron main process.
// In the open-source build this file is a stub: the renderer already gates
// every invocation behind `if (platform.type === 'desktop' && isDesktop())`
// checks (see src/renderer/hooks/useOAuth.ts), so these channels are never
// invoked on web or mobile. The constants are exported here so the renderer
// can compile and reference them without importing from the main process.
export const OAuthIpcChannels = {
  LOGIN: 'oauth:login',
  START_LOGIN: 'oauth:start-login',
  EXCHANGE_CODE: 'oauth:exchange-code',
  START_DEVICE_FLOW: 'oauth:start-device-flow',
  WAIT_DEVICE_TOKEN: 'oauth:wait-device-token',
  REFRESH: 'oauth:refresh',
  CANCEL: 'oauth:cancel',
} as const

export function mergeSharedOAuthProviderSettings(
  providerId: string,
  providers: Record<string, ProviderSettings> | undefined
): ProviderSettings {
  return providers?.[providerId] || {}
}

export function resolveEffectiveApiKey(
  providerSetting: ProviderSettings,
  _platformType: string
): string {
  return providerSetting.apiKey || ''
}

export function isUsingOAuth(
  _providerSetting: ProviderSettings,
  _platformType: string
): boolean {
  return false
}

export function isOAuthExpired(_providerSetting: ProviderSettings): boolean {
  return false
}

export function toOAuthProviderId(_chatboxProviderId: string): string | undefined {
  return undefined
}

export function toOAuthSettingsProviderId(_chatboxProviderId: string): string | undefined {
  return undefined
}

// No-op credential manager stub
export function createOAuthCredentialManager(..._args: unknown[]): undefined {
  return undefined
}

// No-op OAuth fetch stubs — they are only called when `isOAuth && credentialManager` is truthy,
// which never happens in the open-source edition. Returning undefined keeps the type contract.
export function createBearerOAuthFetch(..._args: unknown[]): undefined {
  return undefined
}

export function createOpenAIOAuthFetch(..._args: unknown[]): undefined {
  return undefined
}
