import { prepareRemoteMCPTools } from '@chatbox/core/mcp'
import { mcpController } from './controller'

export function prepareMobileMCPTools(options: Omit<Parameters<typeof prepareRemoteMCPTools>[0], 'controller'>) {
  return prepareRemoteMCPTools({ ...options, controller: mcpController })
}
