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
    // Streamable HTTP servers (the MCP spec and, e.g., mcp.jina.ai) reject a request that does not
    // advertise both content types with 406 Not Acceptable, which the SDK surfaces as a cancelled
    // stream. Normalize Accept so every MCP request asks for JSON *and* an event stream.
    const headers = new Headers(init?.headers)
    const accept = headers.get('accept') ?? ''
    if (!accept.includes('text/event-stream')) {
      headers.set('accept', accept ? `${accept}, text/event-stream` : 'application/json, text/event-stream')
    }
    const requestInit = { ...init, headers, redirect: 'error' as const, credentials: 'include' as const }
    return fetchImpl(url, requestInit)
  }
}
