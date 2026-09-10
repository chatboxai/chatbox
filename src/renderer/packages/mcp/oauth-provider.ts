import type { MCPOAuthState } from '@chatbox/core/domain/settings'
import type {
  OAuthClientMetadata,
  OAuthClientProvider,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import { OAuthIpcChannels } from '@shared/oauth'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'

// Fixed loopback port: it is part of the redirect_uri registered with every authorization server,
// so changing it invalidates existing dynamic client registrations.
export const MCP_OAUTH_CALLBACK_PORT = 1456
const REDIRECT_URL = `http://127.0.0.1:${MCP_OAUTH_CALLBACK_PORT}/callback`

/**
 * OAuth client for one MCP server. The SDK drives discovery, dynamic client registration,
 * PKCE and token refresh; this class only persists state per server id and bridges the
 * browser round trip (open the authorization URL, receive the code on the loopback port).
 */

export class MCPOAuthProvider implements OAuthClientProvider {
  private pendingCode?: Promise<string>

  /**
   * @param interactive Whether a browser round trip may be started. App bootstrap connects
   * non-interactively so a server whose tokens are missing or revoked reports "authorization
   * required" instead of opening the browser on every launch.
   */
  constructor(
    private readonly serverId: string,
    private readonly interactive = true
  ) {}

  get redirectUrl() {
    return REDIRECT_URL
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Chatbox',
      client_uri: 'https://chatboxai.app',
      redirect_uris: [REDIRECT_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  private get stored(): MCPOAuthState | undefined {
    return settingsStore.getState().mcp.oauth?.[this.serverId]
  }

  private update(patch: Partial<MCPOAuthState>) {
    settingsStore.getState().setSettings((draft) => {
      draft.mcp.oauth ??= {}
      draft.mcp.oauth[this.serverId] = { ...draft.mcp.oauth[this.serverId], ...patch }
    })
  }

  clientInformation() {
    return this.stored?.clientInformation as StoredOAuthClientInformation | undefined
  }

  saveClientInformation(clientInformation: StoredOAuthClientInformation) {
    this.update({ clientInformation })
  }

  tokens() {
    return this.stored?.tokens as StoredOAuthTokens | undefined
  }

  saveTokens(tokens: StoredOAuthTokens) {
    this.update({ tokens })
  }

  codeVerifier() {
    const codeVerifier = this.stored?.codeVerifier
    if (!codeVerifier) {
      throw new Error('No PKCE code verifier saved for this MCP server')
    }
    return codeVerifier
  }

  saveCodeVerifier(codeVerifier: string) {
    this.update({ codeVerifier })
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'discovery') {
      return
    }
    const cleared: Partial<MCPOAuthState> =
      scope === 'all'
        ? { clientInformation: undefined, tokens: undefined, codeVerifier: undefined }
        : scope === 'client'
          ? { clientInformation: undefined }
          : scope === 'tokens'
            ? { tokens: undefined }
            : { codeVerifier: undefined }
    this.update(cleared)
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    if (!this.interactive) {
      throw new Error('Authorization required. Open this server in MCP settings and run Test to sign in.')
    }
    // Start listening before the browser opens so the redirect can never race the server.
    this.pendingCode = window.electronAPI.invoke(OAuthIpcChannels.MCP_WAIT_CALLBACK, MCP_OAUTH_CALLBACK_PORT)
    await platform.openLink(authorizationUrl.toString())
  }

  /** Resolves with the authorization code once the user finishes in the browser; undefined if no redirect was started. */
  waitForAuthorizationCode(): Promise<string> | undefined {
    const pending = this.pendingCode
    this.pendingCode = undefined
    return pending
  }
}
