/**
 * OAuth credentials stored in provider settings.
 */
export interface OAuthCredentials {
  accessToken: string
  refreshToken?: string
  /** Expiration timestamp in milliseconds (Date.now() based) */
  expiresAt?: number
  /** Provider-specific extra data */
  extra?: Record<string, unknown>
}

/**
 * IPC channel names for OAuth communication between renderer and main process.
 */
export const OAuthIpcChannels = {
  /** Single-step login for callback-server providers */
  LOGIN: 'oauth:login',
  /** Step 1 for code-paste providers: get auth URL */
  START_LOGIN: 'oauth:start-login',
  /** Step 2 for code-paste providers: exchange pasted code for tokens */
  EXCHANGE_CODE: 'oauth:exchange-code',
  /** Step 1 for device-code providers: start flow, get user code + verification URL */
  START_DEVICE_FLOW: 'oauth:start-device-flow',
  /** Step 2 for device-code providers: poll/wait for token */
  WAIT_DEVICE_TOKEN: 'oauth:wait-device-token',
  /** Cancel an active OAuth flow for a provider */
  CANCEL: 'oauth:cancel',
  REFRESH: 'oauth:refresh',
  GET_SUPPORTED_PROVIDERS: 'oauth:get-supported-providers',
  /** MCP servers: listen on a loopback port and resolve with the authorization redirect parameters */
  MCP_WAIT_CALLBACK: 'oauth:mcp-wait-callback',
} as const

/** Parameters received on the MCP OAuth loopback redirect. */
export interface MCPAuthorizationCallback {
  code: string
  iss?: string
}

/**
 * Result of an OAuth login or refresh operation.
 */
export interface OAuthResult {
  success: boolean
  credentials?: OAuthCredentials
  error?: string
}

/**
 * Result of starting a code-paste login flow.
 */
export interface OAuthStartResult {
  success: boolean
  /** Auth URL to open in the browser */
  authUrl?: string
  /** Instructions for the user */
  instructions?: string
  error?: string
}

/**
 * Result of starting a device-code flow.
 */
export interface DeviceFlowStartResult {
  success: boolean
  /** The user code to display */
  userCode?: string
  /** The verification URL to open */
  verificationUri?: string
  error?: string
}

/**
 * Info about an OAuth-supported provider.
 */
export interface OAuthProviderInfo {
  providerId: string
  name: string
  /** The flow type determines the UI pattern */
  flowType: 'callback' | 'code-paste' | 'device-code'
}
