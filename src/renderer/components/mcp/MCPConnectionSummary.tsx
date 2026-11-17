import { Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mcpController } from '@/packages/mcp/controller'
import { useMcpSettings } from '@/stores/settingsStore'

export function MCPConnectionSummary() {
  const { t } = useTranslation()
  const settings = useMcpSettings()
  const [, refresh] = useState(0)
  const ids = [
    ...settings.enabledBuiltinServers,
    ...settings.servers.filter((server) => server.enabled).map((server) => server.id),
  ]
  const signature = JSON.stringify(ids)
  useEffect(() => {
    const serverIds = JSON.parse(signature) as string[]
    const unsubscribers = serverIds.map((id) =>
      mcpController.subscribeToServerStatus(id, () => refresh((value) => value + 1))
    )
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [signature])
  const connected = ids.filter((id) => mcpController.getServer(id)?.status.state === 'running').length
  return (
    <Text size="xs" c="dimmed">
      {t('{{connected}} / {{total}} servers connected', { connected, total: ids.length })}
    </Text>
  )
}
