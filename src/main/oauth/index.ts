import type {
  DeviceFlowStartResult,
  OAuthCredentials,
  OAuthProviderInfo,
  OAuthResult,
  OAuthStartResult,
} from '@shared/oauth'
import { OAuthIpcChannels } from '@shared/oauth'
import { ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import { createCallbackServer } from './callback-server'
import { anthropicOAuthProvider } from './providers/anthropic'
import { githubCopilotOAuthProvider } from './providers/github-copilot'
import { minimaxCnOAuthProvider, minimaxOAuthProvider } from './providers/minimax'
import { openaiOAuthProvider } from './providers/openai'
import { qwenPortalOAuthProvider } from './providers/qwen'
import { getOAuthProvider, getRegisteredOAuthProviders, registerOAuthProvider } from './registry'

// Register built-in OAuth providers
registerOAuthProvider(anthropicOAuthProvider)
registerOAuthProvider(githubCopilotOAuthProvider)
registerOAuthProvider(minimaxOAuthProvider)
registerOAuthProvider(minimaxCnOAuthProvider)
registerOAuthProvider(openaiOAuthProvider)
registerOAuthProvider(qwenPortalOAuthProvider)

// Track active OAuth flows so they can be cancelled
const activeFlows = new Map<string, AbortController>()

function startFlow(providerId: string): AbortSignal {
  // Cancel any existing flow for this provider
  cancelFlow(providerId)
  const controller = new AbortController()
  activeFlows.set(providerId, controller)
  return controller.signal
}

function cancelFlow(providerId: string): void {
  const existing = activeFlows.get(providerId)
  if (existing) {
    existing.abort()
    activeFlows.delete(providerId)
  }
}

function finishFlow(providerId: string): void {
  activeFlows.delete(providerId)
}

function parseRefreshCredentials(credentialsJson: string): OAuthCredentials {
  const parsed: unknown = JSON.parse(credentialsJson)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid OAuth credentials payload')
  }

  const credentials = parsed as Record<string, unknown>
  if (typeof credentials.accessToken !== 'string' || credentials.accessToken.length === 0) {
    throw new Error('OAuth credentials must include a non-empty accessToken')
  }

  if (credentials.refreshToken !== undefined && typeof credentials.refreshToken !== 'string') {
    throw new Error('OAuth refreshToken must be a string when provided')
  }

  if (credentials.expiresAt !== undefined && typeof credentials.expiresAt !== 'number') {
    throw new Error('OAuth expiresAt must be a number when provided')
  }

  if (
    credentials.extra !== undefined &&
    (!credentials.extra || typeof credentials.extra !== 'object' || Array.isArray(credentials.extra))
  ) {
    throw new Error('OAuth extra must be an object when provided')
  }

  return {
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    expiresAt: credentials.expiresAt,
    extra: credentials.extra as Record<string, unknown> | undefined,
  }
}

/**
 * Register all OAuth IPC handlers.
 * Call this once during app startup in main.ts.
 */
export function registerOAuthHandlers(): void {
  // Return list of providers with their flow type info
  ipcMain.handle(OAuthIpcChannels.GET_SUPPORTED_PROVIDERS, (): string => {
    const providers: OAuthProviderInfo[] = getRegisteredOAuthProviders().map((p) => ({
      providerId: p.providerId,
      name: p.name,
      flowType: p.kind,
    }))
    return JSON.stringify(providers)
  })

  // Cancel an active OAuth flow
  ipcMain.handle(OAuthIpcChannels.CANCEL, (_event, providerId: string): string => {
    log.info(`[OAuth] Cancelling flow for provider: ${providerId}`)
    cancelFlow(providerId)
    return JSON.stringify({ success: true } satisfies OAuthResult)
  })

  // Single-step login for callback-server providers (OpenAI)
  ipcMain.handle(OAuthIpcChannels.LOGIN, async (_event, providerId: string): Promise<string> => {
    const provider = getOAuthProvider(providerId)
    if (!provider || provider.kind !== 'callback') {
      return JSON.stringify({
        success: false,
        error: `No callback OAuth provider found for: ${providerId}`,
      } satisfies OAuthResult)
    }

    const signal = startFlow(providerId)

    try {
      log.info(`[OAuth] Starting callback login for provider: ${providerId}`)
      const credentials = await provider.login({
        openUrl: async (url) => {
          await shell.openExternal(url)
        },
        signal,
      })
      log.info(`[OAuth] Login successful for provider: ${providerId}`)
      return JSON.stringify({ success: true, credentials } satisfies OAuthResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (signal.aborted) {
        log.info(`[OAuth] Login cancelled for provider: ${providerId}`)
        return JSON.stringify({ success: false, error: 'Login cancelled' } satisfies OAuthResult)
      }
      log.error(`[OAuth] Login failed for provider: ${providerId}`, error)
      return JSON.stringify({ success: false, error: message } satisfies OAuthResult)
    } finally {
      finishFlow(providerId)
    }
  })

  // Step 1 for code-paste providers (Anthropic): get auth URL
  ipcMain.handle(OAuthIpcChannels.START_LOGIN, async (_event, providerId: string): Promise<string> => {
    const provider = getOAuthProvider(providerId)
    if (!provider || provider.kind !== 'code-paste') {
      return JSON.stringify({
        success: false,
        error: `No code-paste OAuth provider found for: ${providerId}`,
      } satisfies OAuthStartResult)
    }

    try {
      log.info(`[OAuth] Starting code-paste login for provider: ${providerId}`)
      const { authUrl } = await provider.startLogin()
      return JSON.stringify({
        success: true,
        authUrl,
        instructions: provider.codeInputMessage,
      } satisfies OAuthStartResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[OAuth] Start login failed for provider: ${providerId}`, error)
      return JSON.stringify({ success: false, error: message } satisfies OAuthStartResult)
    }
  })

  // Step 2 for code-paste providers (Anthropic): exchange code for tokens
  ipcMain.handle(OAuthIpcChannels.EXCHANGE_CODE, async (_event, providerId: string, code: string): Promise<string> => {
    const provider = getOAuthProvider(providerId)
    if (!provider || provider.kind !== 'code-paste') {
      return JSON.stringify({
        success: false,
        error: `No code-paste OAuth provider found for: ${providerId}`,
      } satisfies OAuthResult)
    }

    try {
      log.info(`[OAuth] Exchanging code for provider: ${providerId}`)
      const credentials = await provider.exchangeCode(code)
      log.info(`[OAuth] Code exchange successful for provider: ${providerId}`)
      return JSON.stringify({ success: true, credentials } satisfies OAuthResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[OAuth] Code exchange failed for provider: ${providerId}`, error)
      return JSON.stringify({ success: false, error: message } satisfies OAuthResult)
    }
  })

  // Step 1 for device-code providers (GitHub Copilot): start flow
  ipcMain.handle(OAuthIpcChannels.START_DEVICE_FLOW, async (_event, providerId: string): Promise<string> => {
    const provider = getOAuthProvider(providerId)
    if (!provider || provider.kind !== 'device-code') {
      return JSON.stringify({
        success: false,
        error: `No device-code OAuth provider found for: ${providerId}`,
      } satisfies DeviceFlowStartResult)
    }

    try {
      log.info(`[OAuth] Starting device flow for provider: ${providerId}`)
      const { userCode, verificationUri } = await provider.startDeviceFlow()
      // Prepare abort signal for the wait phase
      startFlow(providerId)
      return JSON.stringify({ success: true, userCode, verificationUri } satisfies DeviceFlowStartResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[OAuth] Device flow start failed for provider: ${providerId}`, error)
      return JSON.stringify({ success: false, error: message } satisfies DeviceFlowStartResult)
    }
  })

  // Step 2 for device-code providers (GitHub Copilot): wait for token
  ipcMain.handle(OAuthIpcChannels.WAIT_DEVICE_TOKEN, async (_event, providerId: string): Promise<string> => {
    const provider = getOAuthProvider(providerId)
    if (!provider || provider.kind !== 'device-code') {
      return JSON.stringify({
        success: false,
        error: `No device-code OAuth provider found for: ${providerId}`,
      } satisfies OAuthResult)
    }

    const controller = activeFlows.get(providerId)
    if (!controller) {
      log.info(`[OAuth] Device flow already cancelled for provider: ${providerId}`)
      return JSON.stringify({ success: false, error: 'Login cancelled' } satisfies OAuthResult)
    }

    const signal = controller.signal

    try {
      log.info(`[OAuth] Waiting for device token for provider: ${providerId}`)
      const credentials = await provider.waitForToken(signal)
      log.info(`[OAuth] Device token obtained for provider: ${providerId}`)
      return JSON.stringify({ success: true, credentials } satisfies OAuthResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (signal?.aborted) {
        log.info(`[OAuth] Device flow cancelled for provider: ${providerId}`)
        return JSON.stringify({ success: false, error: 'Login cancelled' } satisfies OAuthResult)
      }
      log.error(`[OAuth] Device token wait failed for provider: ${providerId}`, error)
      return JSON.stringify({ success: false, error: message } satisfies OAuthResult)
    } finally {
      finishFlow(providerId)
    }
  })

  // Refresh token (works for all flow types)
  ipcMain.handle(
    OAuthIpcChannels.REFRESH,
    async (_event, providerId: string, credentialsJson: string): Promise<string> => {
      const provider = getOAuthProvider(providerId)
      if (!provider) {
        return JSON.stringify({
          success: false,
          error: `No OAuth provider found for: ${providerId}`,
        } satisfies OAuthResult)
      }

      try {
        const credentials = parseRefreshCredentials(credentialsJson)
        log.info(`[OAuth] Refreshing token for provider: ${providerId}`)
        const newCredentials = await provider.refreshToken(credentials)
        log.info(`[OAuth] Token refreshed for provider: ${providerId}`)
        return JSON.stringify({ success: true, credentials: newCredentials } satisfies OAuthResult)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error(`[OAuth] Token refresh failed for provider: ${providerId}`, error)
        return JSON.stringify({ success: false, error: message } satisfies OAuthResult)
      }
    }
  )

  // MCP servers run their OAuth flow in the renderer; main only owns the loopback port that
  // receives the browser redirect. A new wait replaces any pending one so retries never hit EADDRINUSE.
  let mcpCallbackFlow: AbortController | null = null
  ipcMain.handle(OAuthIpcChannels.MCP_WAIT_CALLBACK, async (_event, port: number): Promise<string> => {
    mcpCallbackFlow?.abort()
    await new Promise((resolve) => setImmediate(resolve))
    const controller = new AbortController()
    mcpCallbackFlow = controller
    try {
      log.info(`[OAuth] Waiting for MCP authorization callback on port ${port}`)
      const { code } = await createCallbackServer(port, controller.signal).promise
      return code
    } finally {
      if (mcpCallbackFlow === controller) {
        mcpCallbackFlow = null
      }
    }
  })

  log.info('[OAuth] IPC handlers registered')
}
