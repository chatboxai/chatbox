import type { ModelInterface } from '@shared/models/types'
import type { Settings } from '@shared/types'
import type { ToolSet } from 'ai'
import { getBuiltinServerConfig } from './builtin'
import { mcpController } from './controller'

export async function prepareMobileMCPTools({
  enabled,
  model,
  settings,
  signal,
}: {
  enabled: boolean
  model: Pick<ModelInterface, 'isSupportToolUse'>
  settings: Pick<Settings, 'mcp' | 'licenseKey'>
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
      .map((config) => mcpController.startServer(config, { interactive: false, signal }))
  )
  signal.throwIfAborted()
  const ready = new Set(
    configs
      .filter(
        (config) => config.transport.type === 'http' && mcpController.getServer(config.id)?.status.state === 'running'
      )
      .map((config) => config.id)
  )
  return {
    tools: mcpController.getAvailableTools(ready),
    unavailable: configs.filter((config) => !ready.has(config.id)).map((config) => config.name),
  }
}
