import type { MCPServerConfig } from './types'

export interface BuildinMCPServerConfig {
  id: string
  name: string
  description: string
  url: string
}

// Chatbox-hosted builtin MCP servers are disabled in this build.
export const BUILTIN_MCP_SERVERS: BuildinMCPServerConfig[] = []

export function getBuiltinServerConfig(_id: string, _licenseKey?: string): MCPServerConfig | null {
  return null
}
