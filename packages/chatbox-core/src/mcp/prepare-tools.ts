import type { ToolSet } from 'ai'
import type { MCPController } from './controller'
import { getBuiltinServerConfig } from './builtin'
import type { MCPServerConfig } from './types'

export async function prepareRemoteMCPTools({
  controller,
  enabled,
  model,
  settings,
  signal,
}: {
  controller: MCPController
  enabled: boolean
  model: { isSupportToolUse(mode: 'agent'): boolean }
  settings: { mcp: { enabledBuiltinServers: string[]; servers: MCPServerConfig[] }; licenseKey?: string }
  signal: AbortSignal
}): Promise<{ tools: ToolSet; unavailable: string[] }> {
  if (!enabled || !model.isSupportToolUse('agent')) return { tools: {}, unavailable: [] }
  signal.throwIfAborted()
  const configs = [
    ...settings.mcp.enabledBuiltinServers
      .map((id) => getBuiltinServerConfig(id, settings.licenseKey))
      .filter((config) => config !== null),
    ...settings.mcp.servers.filter((config) => config.enabled),
  ]
  await Promise.all(
    configs
      .filter((config) => config.transport.type === 'http')
      .map((config) => controller.startServer(config, { interactive: false, signal }))
  )
  signal.throwIfAborted()
  const ready = new Set(
    configs
      .filter(
        (config) => config.transport.type === 'http' && controller.getServer(config.id)?.status.state === 'running'
      )
      .map((config) => config.id)
  )
  return {
    tools: controller.getAvailableTools(ready),
    unavailable: configs.filter((config) => !ready.has(config.id)).map((config) => config.name),
  }
}
