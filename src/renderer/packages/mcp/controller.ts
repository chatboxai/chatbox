import { createMCPController, MCPServer as CoreMCPServer, type MCPPlatformDependencies } from '@chatbox/core/mcp'
import { getMCPPlatformDependencies } from './platform'
import type { MCPServerConfig } from './types'

export type { MCPServerStartOptions } from '@chatbox/core/mcp'
export class MCPServer extends CoreMCPServer {
  constructor(config: MCPServerConfig, dependencies: MCPPlatformDependencies = getMCPPlatformDependencies()) {
    super(config, dependencies)
  }
}
export const mcpController = createMCPController(getMCPPlatformDependencies())
