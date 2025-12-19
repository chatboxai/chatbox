import { ActionIcon, Anchor, Badge, Flex, Paper, SimpleGrid, Switch, Text } from '@mantine/core'
import { spotlight } from '@mantine/spotlight'
import { IconPlus } from '@tabler/icons-react'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { v4 as uuid } from 'uuid'
import { ScalableIcon } from '@/components/ScalableIcon'
import { useToggleMCPServer } from '@/hooks/mcp'
import { mcpController } from '@/packages/mcp/controller'
import type { MCPServerConfig } from '@/packages/mcp/types'
import { useMcpSettings, useSettingsStore } from '@/stores/settingsStore'
import { trackEvent } from '@/utils/track'
import { ConfigModal } from './ConfigModal'
import type { MCPRegistryEntry } from './registries'
import ServerRegistrySpotlight from './ServerRegistrySpotlight'
import { parseServersFromJson } from './utils'

const ServerCard: FC<{
  config: MCPServerConfig
  triggerEdit: (serverConfig: MCPServerConfig) => void
  onEnabledChange: (id: string, enabled: boolean) => void
}> = (props) => {
  const { t } = useTranslation()
  const { config, triggerEdit, onEnabledChange } = props
  return (
    <Paper shadow="xs" radius="md" withBorder p="sm">
      <Flex justify="space-between" align="center">
        <Text size="sm" fw={600}>
          {config.name}
        </Text>
        <Switch
          size="xs"
          checked={config.enabled}
          onChange={(e) => onEnabledChange(config.id, e.currentTarget.checked)}
        />
      </Flex>
      <Flex justify="space-between" align="center" mt="lg">
        <Badge size="sm" variant="light" color="chatbox-brand">
          {config.transport.type}
        </Badge>
        <Anchor size="xs" c="chatbox-brand" onClick={() => triggerEdit(config)}>
          {t('Edit')}
        </Anchor>
      </Flex>
    </Paper>
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
          transport: { type: 'http', url: '' },
        },
      })
    }
  }, [])

  const triggerImportJson = async () => {
    const content = await navigator.clipboard.readText()
    const servers = parseServersFromJson(content)
    trackEvent('import_mcp_servers_from_json', { count: servers.length })
    if (!servers.length) {
      toast.error(t('No MCP servers parsed from clipboard'))
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
      <Text size="sm" fw={600} mb={12}>
        {t('Custom MCP Servers')}
      </Text>
      <SimpleGrid type="container" cols={{ base: 1, '450px': 2, '800px': 3, '1200px': 4 }}>
        <Paper
          tabIndex={-1}
          shadow="xs"
          radius="md"
          withBorder
          bd="1px dashed var(--chatbox-border-primary)"
          p="sm"
          className="cursor-pointer"
          onClick={spotlight.open}
        >
          <Flex direction="column" justify="center" align="center" h="100%" gap={4}>
            <ActionIcon variant="filled" size="sm">
              <ScalableIcon icon={IconPlus} />
            </ActionIcon>
            <Text size="xs" c="chatbox-brand">
              {t('Add Server')}
            </Text>
          </Flex>
        </Paper>
        {mcpSettings.servers.map((server) => {
          return (
            <ServerCard
              key={server.id}
              config={server}
              triggerEdit={(config) => setModal({ mode: 'edit', config })}
              onEnabledChange={onEnabledChange}
            />
          )
        })}
      </SimpleGrid>
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
