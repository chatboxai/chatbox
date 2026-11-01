import { BUILTIN_MCP_SERVERS as definitions, getBuiltinServerConfig as buildConfig } from '@chatbox/core/mcp'
import i18n from '@/i18n'
import { getLicenseKey } from '@/stores/settingActions'
export type { BuildinMCPServerConfig } from '@chatbox/core/mcp'
export const BUILTIN_MCP_SERVERS = definitions.map((server) => ({ ...server, description: i18n.t(server.description) }))
export function getBuiltinServerConfig(id: string, licenseKey?: string) {
  return buildConfig(id, licenseKey || getLicenseKey())
}
