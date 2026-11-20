import { Switch } from '@mantine/core'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { CHATBOX_AI_ENABLED } from '@shared/open-build'
import MCPStatus from '@/components/mcp/MCPStatus'
import { SettingRow, SettingsSection } from '@/components/settings/SettingsLayout'
import { useMCPServerStatus, useToggleMCPServer } from '@/hooks/mcp'
import { BUILTIN_MCP_SERVERS, type BuildinMCPServerConfig } from '@/packages/mcp/builtin'
import { useMcpSettings, useSettingsStore } from '@/stores/settingsStore'

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
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const onEnabledChange = useToggleMCPServer()
  return (
    <SettingsSection
      title={CHATBOX_AI_ENABLED ? `Chatbox ${t('Builtin MCP Servers')}` : t('Builtin MCP Servers')}
      description={
        CHATBOX_AI_ENABLED
          ? t('One-click MCP servers for Chatbox AI subscribers')
          : t(
              'One-click MCP servers. Fetch and Context7 use public endpoints; arXiv needs a Chatbox AI license.'
            )
      }
    >
      {BUILTIN_MCP_SERVERS.map((config) => (
        <ServerRow
          key={config.id}
          config={config}
          enabled={mcp.enabledBuiltinServers.includes(config.id)}
          onEnabledChange={onEnabledChange}
          accessible={!config.requiresLicense || !!licenseKey}
        />
      ))}
    </SettingsSection>
  )
}
