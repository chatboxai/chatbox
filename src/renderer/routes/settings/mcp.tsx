import { BuiltinServersSection } from '@/components/settings/mcp/BuiltinServersSection'
import CustomServersSection from '@/components/settings/mcp/CustomServersSection'
import { Box, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/settings/mcp')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  return (
    <Box p="md">
      <Title order={5}>{t('MCP Settings')}</Title>
      <Box className="mt-8">
        <BuiltinServersSection />
      </Box>
      <Box className="mt-8">
        <CustomServersSection />
      </Box>
    </Box>
  )
}
