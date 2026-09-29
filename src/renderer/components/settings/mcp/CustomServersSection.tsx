import { Anchor, Badge, Button, Flex, Switch, Text } from '@mantine/core'
import { spotlight } from '@mantine/spotlight'
import { IconPlus } from '@tabler/icons-react'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { v4 as uuid } from 'uuid'
import { bucketPlausibleCount } from '@/analytics/plausible'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import MCPStatus from '@/components/mcp/MCPStatus'
import { SettingRow, SettingsListItem, SettingsSection } from '@/components/settings/SettingsLayout'
import { useMCPServerStatus, useToggleMCPServer } from '@/hooks/mcp'
import { mcpController } from '@/packages/mcp/controller'
import type { MCPServerConfig } from '@/packages/mcp/types'
import { toastError } from '@/packages/toast'
import platform from '@/platform'
import { useMcpSettings, useSettingsStore } from '@/stores/settingsStore'
import { trackEvent } from '@/utils/track'
import { ConfigModal } from './ConfigModal'
import type { MCPRegistryEntry } from './registries'
import ServerRegistrySpotlight from './ServerRegistrySpotlight'
import { parseServersFromJson } from './utils'

const ServerRow: FC<{
  config: MCPServerConfig
  triggerEdit: (serverConfig: MCPServerConfig) => void
  onEnabledChange: (id: string, enabled: boolean) => void
}> = (props) => {
  const { t } = useTranslation()
  const { config, triggerEdit, onEnabledChange } = props
  const status = useMCPServerStatus(config.id)
  const unsupported = platform.type === 'mobile' && config.transport.type === 'stdio'
  return (
    <SettingRow
      id={`mcp-server-${config.id}`}
      label={
        <div className="flex items-center gap-2 min-w-0">
          <MCPStatus status={status} />
          <span className="truncate">{config.name}</span>
        </div>
      }
      status={
        <Flex align="center" gap="xs" wrap="wrap" mt={2}>
          <Badge size="sm" variant="light" color="chatbox-brand">
            {config.transport.type}
          </Badge>
          {unsupported && (
            <Text fz={12} c="chatbox-tertiary">
              {t('Local MCP servers are only available on desktop')}
            </Text>
          )}
          {config.enabled && !unsupported && status?.state !== 'running' && status?.state !== 'starting' && (
            <Anchor component="button" fz={12} onClick={() => onEnabledChange(config.id, true)}>
              {t('Connect')}
            </Anchor>
          )}
        </Flex>
      }
      control={
        <Flex align="center" gap="xs">
          <Button variant="subtle" color="chatbox-gray" size="compact-sm" onClick={() => triggerEdit(config)}>
            {t('Edit')}
          </Button>
          <Switch
            size="md"
            aria-label={config.name}
            checked={config.enabled}
            disabled={unsupported}
            onChange={(e) => onEnabledChange(config.id, e.currentTarget.checked)}
          />
        </Flex>
      }
    />
  )
}

type Props = {
  installConfig?: MCPServerConfig
}

const CustomServersSection: FC<Props> = (props) => {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const mcpSettings = useMcpSettings()
  const onEnabledChange = useToggleMCPServer()
  const [modal, setModal] = useState<{ config: MCPServerConfig; mode: 'add' | 'edit' } | null>(null)

  useEffect(() => {
    if (props.installConfig) {
      setModal({ mode: 'add', config: props.installConfig })
    }
  }, [props.installConfig])

  const handleServerUpdate = (config: MCPServerConfig) => {
    setSettings((draft) => {
      const index = draft.mcp.servers.findIndex((s) => s.id === config.id)
      if (index !== -1) {
        draft.mcp.servers[index] = config
      } else {
        draft.mcp.servers.push(config)
      }
    })
    mcpController.updateServer(config)
    if (modal?.mode === 'add') {
      toast.success(t('MCP server added'))
    }
    setModal(null)
  }

  const handleServerDelete = (id: string) => {
    if (!window.confirm(t('Are you sure you want to delete this server?')!)) {
      return
    }
    setSettings((draft) => {
      draft.mcp.servers = draft.mcp.servers.filter((s) => s.id !== id)
      delete draft.mcp.oauth?.[id]
    })
    mcpController.stopServer(id)
    setModal(null)
  }

  const triggerAddServer = useCallback((entry?: MCPRegistryEntry) => {
    if (entry) {
      setModal({
        mode: 'add',
        config: {
          id: uuid(),
          name: entry.title,
          enabled: true,
          protocolMode: 'auto',
          transport: {
            type: 'stdio',
            command: entry.configuration.command,
            args: entry.configuration.args,
            env: entry.configuration.env,
          },
        },
      })
    } else {
      setModal({
        mode: 'add',
        config: {
          id: uuid(),
          name: '',
          enabled: true,
          protocolMode: 'auto',
          transport: { type: 'http', url: '' },
        },
      })
    }
  }, [])

  const triggerImportJson = async () => {
    let content: string
    try {
      content = await navigator.clipboard.readText()
    } catch {
      toastError(t('Failed to read from clipboard'))
      return
    }
    const servers = parseServersFromJson(content)
    trackEvent('import_mcp_servers_from_json', { count: bucketPlausibleCount(servers.length) })
    if (!servers.length) {
      toastError(t('No MCP servers parsed from clipboard'))
      return
    }
    setSettings((draft) => {
      draft.mcp.servers.push(...servers)
    })
    toast.success(
      t('{{count}} MCP servers imported', { count: servers.length }) + ': ' + servers.map((s) => s.name).join(', ')
    )
  }

  return (
    <>
      <SettingsSection
        title={t('Custom MCP Servers')}
        action={
          <Button
            variant="light"
            size="compact-sm"
            leftSection={<ScalableIcon icon={IconPlus} size={14} />}
            onClick={spotlight.open}
          >
            {t('Add Server')}
          </Button>
        }
      >
        {mcpSettings.servers.length === 0 && (
          <SettingsListItem>
            <Text fz={14} c="chatbox-tertiary">
              {t('No custom servers yet. Add one manually, from the registry, or from JSON in your clipboard.')}
            </Text>
          </SettingsListItem>
        )}
        {mcpSettings.servers.map((server) => (
          <ServerRow
            key={server.id}
            config={server}
            triggerEdit={(config) => setModal({ mode: 'edit', config })}
            onEnabledChange={onEnabledChange}
          />
        ))}
      </SettingsSection>
      <ServerRegistrySpotlight triggerAddServer={triggerAddServer} triggerImportJson={triggerImportJson} />
      <ConfigModal
        mode={modal?.mode}
        config={modal ? modal.config : null}
        onClose={() => setModal(null)}
        onSave={handleServerUpdate}
        onDelete={handleServerDelete}
      />
    </>
  )
}

export default CustomServersSection
