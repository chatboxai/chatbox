import { useCallback, useEffect } from 'react'
import { mcpController } from '@/packages/mcp/controller'
import { MCPServerConfig, MCPServerStatus } from '@/packages/mcp/types'
import { useState } from 'react'
import { useImmerSettings } from './useSettings'
import { BUILTIN_MCP_SERVERS, getBuiltinServerConfig } from '@/packages/mcp/builtin'
import { cloneDeep } from 'lodash'
import { trackEvent } from '@/utils/track'

export function useMCPServerStatus(id: string) {
  const [status, setStatus] = useState<MCPServerStatus | null>(null)
  useEffect(() => {
    return mcpController.subscribeToServerStatus(id, setStatus)
  }, [id])
  return status
}

export function useToggleMCPServer() {
  const [_, setSettings] = useImmerSettings()
  return useCallback(
    (id: string, enabled: boolean) => {
      let effect = null as { action: 'start'; config: MCPServerConfig } | { action: 'stop'; id: string } | null
      const isBuiltin = BUILTIN_MCP_SERVERS.some((s) => s.id === id)
      if (isBuiltin) {
        setSettings((draft) => {
          const enabledBuiltinServers = draft.mcp.enabledBuiltinServers
          if (enabled) {
            if (!enabledBuiltinServers.includes(id)) {
              enabledBuiltinServers.push(id)
            }
            const config = getBuiltinServerConfig(id)
            if (config) {
              effect = { action: 'start', config }
            }
          } else {
            const index = enabledBuiltinServers.indexOf(id)
            if (index !== -1) {
              enabledBuiltinServers.splice(index, 1)
            }
            effect = { action: 'stop', id }
          }
        })
      } else {
        setSettings((draft) => {
          draft.mcp.servers.forEach((s) => {
            if (s.id === id) {
              s.enabled = enabled
              if (enabled) {
                effect = { action: 'start', config: cloneDeep(s) }
              } else {
                effect = { action: 'stop', id }
              }
            }
          })
        })
      }
      if (effect?.action === 'start') {
        mcpController.startServer(effect.config)
      } else if (effect?.action === 'stop') {
        mcpController.stopServer(effect.id)
      }
      trackEvent('toggle_mcp_server', { id, enabled })
    },
    [setSettings]
  )
}
