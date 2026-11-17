import type { MCPPlatformDependencies } from '@chatbox/core/mcp'
import { getLogger } from '@/lib/utils'
import { nativeFetch } from '@/native/native-fetch'
import platform from '@/platform'
import { IPCStdioTransport } from './ipc-stdio-transport'
import { MCPOAuthProvider } from './oauth-provider'
export { createMCPFetch } from '@chatbox/core/mcp'
export type { MCPAuthorizationProvider, MCPPlatformDependencies } from '@chatbox/core/mcp'

export function getMCPPlatformDependencies(): MCPPlatformDependencies {
  const reportSchemaWarning = (message: string) => getLogger('mcp:tool-schema').warn(message)
  if (platform.type === 'mobile') return { mobile: true, fetch: nativeFetch, reportSchemaWarning }
  return {
    mobile: false,
    reportSchemaWarning,
    createStdioTransport: (config) => IPCStdioTransport.create(config),
    createOAuthProvider: (config, interactive) => new MCPOAuthProvider(config.id, interactive),
  }
}
