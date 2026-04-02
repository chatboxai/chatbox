import type { OAuthProviderInfo } from '@shared/oauth'

// No-op OAuth providers hook for open-source edition
export function useOAuthProviders(): OAuthProviderInfo[] {
  return []
}
