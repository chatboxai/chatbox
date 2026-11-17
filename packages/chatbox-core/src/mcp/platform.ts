import type { OAuthClientProvider, StreamableHTTPClientTransportOptions, Transport } from '@modelcontextprotocol/client'
import type { MCPServerConfig, MCPTransportConfig } from './types'

/** The platform owns browser/callback handling, PKCE, cold-start recovery and secure token storage.
 * Authorization must be bound to the server identity, endpoint and issuer.
 */
export interface MCPAuthorizationProvider extends OAuthClientProvider {
  waitForAuthorizationCallback(): Promise<{ code: string; iss?: string }> | undefined
}

export interface MCPPlatformDependencies {
  mobile: boolean
  createStdioTransport?: (config: Extract<MCPTransportConfig, { type: 'stdio' }>) => Promise<Transport>
  reportSchemaWarning?: (message: string) => void
  fetch?: typeof fetch
  createOAuthProvider?: (config: MCPServerConfig, interactive: boolean) => MCPAuthorizationProvider
}

/** Restricts SSE-discovered endpoints and redirects before forwarding configured credentials. */
export function createMCPFetch(
  serverUrl: string,
  fetchImpl: typeof fetch
): NonNullable<StreamableHTTPClientTransportOptions['fetch']> {
  const origin = new URL(serverUrl).origin
  return (input, init) => {
    const url = String(input)
    if (new URL(url).origin !== origin)
      return Promise.reject(new Error('MCP endpoint must use the configured server origin'))
    const requestInit = { ...init, redirect: 'error' as const, credentials: 'include' as const }
    return fetchImpl(url, requestInit)
  }
}
