import { Flex, Paper, SimpleGrid, Switch, Text } from '@mantine/core'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useToggleMCPServer } from '@/hooks/mcp'
import { BUILTIN_MCP_SERVERS, type BuildinMCPServerConfig } from '@/packages/mcp/builtin'
import { useMcpSettings } from '@/stores/settingsStore'

const ServerCard: FC<{
  config: BuildinMCPServerConfig
  enabled: boolean
  onEnabledChange: (id: string, checked: boolean) => void
  accessible: boolean
}> = (props) => {
  return (
    <Paper shadow="xs" radius="md" withBorder p="sm">
      <Flex justify="space-between" align="center">
        <Text size="sm" fw={600}>
          {props.config.name}
        </Text>
        <Switch
          size="xs"
          checked={props.enabled}
          onChange={(e) => props.onEnabledChange(props.config.id, e.currentTarget.checked)}
          disabled={!props.accessible}
        />
      </Flex>
      <Text size="xs" mt="sm" c="chatbox-tertiary">
        {props.config.description}
      </Text>
    </Paper>
  )
}

export const BuiltinServersSection: FC = () => {
  const { t } = useTranslation()
  const mcp = useMcpSettings()
  const onEnabledChange = useToggleMCPServer()
  if (BUILTIN_MCP_SERVERS.length === 0) {
    return null
  }
  return (
    <>
      <Text size="sm" fw={600} mb={4}>
        {t('Builtin MCP Servers')}
      </Text>
      <Text size="xs" c="chatbox-tertiary" mb={12}>
        {t('One-click MCP servers')}
      </Text>
      <SimpleGrid type="container" cols={{ base: 1, '450px': 2, '800px': 3, '1200px': 4 }}>
        {BUILTIN_MCP_SERVERS.map((config) => (
          <ServerCard
            key={config.id}
            config={config}
            enabled={mcp.enabledBuiltinServers.includes(config.id)}
            onEnabledChange={onEnabledChange}
            accessible={true}
          />
        ))}
      </SimpleGrid>
    </>
  )
}
