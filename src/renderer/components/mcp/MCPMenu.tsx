import { useMCPServerStatus, useToggleMCPServer } from '@/hooks/mcp'
import { useSettings } from '@/hooks/useSettings'
import { BUILTIN_MCP_SERVERS } from '@/packages/mcp/builtin'
import { Button, Flex, Group, Menu, Switch, Text } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { IconSettings2 } from '@tabler/icons-react'
import { FC, ReactNode } from 'react'
import MCPStatus from './MCPStatus'
import { useAutoValidate } from '@/stores/premiumActions'
import { useTranslation } from 'react-i18next'

interface ServerItem {
  id: string
  name: string
  enabled: boolean
}

const ServerItem: FC<{
  item: ServerItem
  onEnabledChange: (id: string, enabled: boolean) => void
}> = ({ item, onEnabledChange }) => {
  const status = useMCPServerStatus(item.id)
  return (
    <Menu.Item
      c="chatbox-primary"
      leftSection={<MCPStatus status={status} />}
      rightSection={
        <Switch
          checked={item.enabled}
          size="xs"
          disabled={status?.state === 'starting' || status?.state === 'stopping'}
          onChange={(e) => onEnabledChange(item.id, e.currentTarget.checked)}
        />
      }
    >
      {item.name}
    </Menu.Item>
  )
}

const MCPMenu: FC<{ children: (enabledTools: number) => ReactNode }> = ({ children }) => {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const isPremium = useAutoValidate()
  const onEnabledChange = useToggleMCPServer()
  const enabledToolsCount =
    settings.mcp.servers.filter((s) => s.enabled).length + settings.mcp.enabledBuiltinServers.length
  return (
    <Menu shadow="md" withArrow width={240} closeOnItemClick={false} position="top">
      <Menu.Target>{children(enabledToolsCount)}</Menu.Target>
      <Menu.Dropdown>
        <Flex justify="space-between">
          <Menu.Label fw={600}>MCP</Menu.Label>
          <Menu.Label>
            <Link to="/settings/mcp">
              <IconSettings2 size={16} color="var(--mantine-color-chatbox-tertiary-text)" />
            </Link>
          </Menu.Label>
        </Flex>
        {isPremium && (
          <>
            {BUILTIN_MCP_SERVERS.map((server) => (
              <ServerItem
                key={server.id}
                item={{
                  id: server.id,
                  name: server.name,
                  enabled: settings.mcp.enabledBuiltinServers.includes(server.id),
                }}
                onEnabledChange={onEnabledChange}
              />
            ))}
            <Menu.Divider />
          </>
        )}
        {settings.mcp.servers.map((server) => (
          <ServerItem key={server.id} item={server} onEnabledChange={onEnabledChange} />
        ))}
        {!settings.mcp.servers.length && !settings.mcp.enabledBuiltinServers.length && (
          <Group justify="center">
            <Link to="/settings/mcp">
              <Button size="xs" my={12} variant="outline">
                {t('Add your first MCP server')}
              </Button>
            </Link>
          </Group>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}

export default MCPMenu
