import type { OAuthClientProvider } from '@modelcontextprotocol/client'
import type { MCPAuthorizationCallback } from '@shared/oauth'
import { nativeFetch } from '@/native/native-fetch'
import platform from '@/platform'
import { MCPOAuthProvider } from './oauth-provider'
import type { MCPServerConfig } from './types'

/** The platform owns browser/callback handling, PKCE, cold-start recovery and secure token storage.
 * Authorization must be bound to the server identity, endpoint and issuer.
 */
export interface MCPAuthorizationProvider extends OAuthClientProvider {
  waitForAuthorizationCallback(): Promise<MCPAuthorizationCallback> | undefined
}

export interface MCPPlatformDependencies {
  mobile: boolean
  fetch?: typeof fetch
  createOAuthProvider?: (config: MCPServerConfig, interactive: boolean) => MCPAuthorizationProvider
}

export function getMCPPlatformDependencies(): MCPPlatformDependencies {
  if (platform.type === 'mobile') return { mobile: true, fetch: nativeFetch }
  return { mobile: false, createOAuthProvider: (config, interactive) => new MCPOAuthProvider(config.id, interactive) }
}

/** Restricts SSE-discovered endpoints and redirects before forwarding configured credentials. */
export function createMCPFetch(serverUrl: string, fetchImpl: typeof fetch): typeof fetch {
  const origin = new URL(serverUrl).origin
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (new URL(url).origin !== origin)
      return Promise.reject(new Error('MCP endpoint must use the configured server origin'))
    return fetchImpl(input, { ...init, redirect: 'error', credentials: 'include' })
  }
}
