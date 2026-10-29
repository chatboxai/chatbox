import { Switch } from '@mantine/core'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import MCPStatus from '@/components/mcp/MCPStatus'
import { SettingRow, SettingsSection } from '@/components/settings/SettingsLayout'
import { useMCPServerStatus, useToggleMCPServer } from '@/hooks/mcp'
import { BUILTIN_MCP_SERVERS, type BuildinMCPServerConfig } from '@/packages/mcp/builtin'
import { useAutoValidate } from '@/stores/premiumActions'
import { useMcpSettings } from '@/stores/settingsStore'

const ServerRow: FC<{
  config: BuildinMCPServerConfig
  enabled: boolean
  onEnabledChange: (id: string, checked: boolean) => void
  accessible: boolean
}> = (props) => {
  const status = useMCPServerStatus(props.config.id)
  return (
    <SettingRow
      id={`mcp-builtin-${props.config.id}`}
      label={
        <div className="flex items-center gap-2">
          <MCPStatus status={status} />
          {props.config.name}
        </div>
      }
      description={props.config.description}
      control={
        <Switch
          size="md"
          aria-label={props.config.name}
          checked={props.enabled}
          onChange={(e) => props.onEnabledChange(props.config.id, e.currentTarget.checked)}
          disabled={!props.accessible}
        />
      }
    />
  )
}

export const BuiltinServersSection: FC = () => {
  const { t } = useTranslation()
  const mcp = useMcpSettings()
  const isPremium = useAutoValidate()
  const onEnabledChange = useToggleMCPServer()
  return (
    <SettingsSection
      title={`Chatbox ${t('Builtin MCP Servers')}`}
      description={t('One-click MCP servers for Chatbox AI subscribers')}
    >
      {BUILTIN_MCP_SERVERS.map((config) => (
        <ServerRow
          key={config.id}
          config={config}
          enabled={mcp.enabledBuiltinServers.includes(config.id)}
          onEnabledChange={onEnabledChange}
          accessible={isPremium}
        />
      ))}
    </SettingsSection>
  )
}
