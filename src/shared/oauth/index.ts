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
