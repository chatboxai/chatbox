import { Grid, Stack, Text } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useMyCopilots } from '@/hooks/useCopilots'
import CopilotItem from './-components/CopilotItem'

export const Route = createFileRoute('/copilots/my')({
  component: MyCopilots,
})

function MyCopilots() {
  const { t } = useTranslation()
  const { copilots } = useMyCopilots()

  return (
    <Stack px="sm" py="xl" gap="lg" className="max-w-7xl">
      {copilots.length === 0 ? (
        // Empty State
        <div className="py-12 text-center">
          <Text c="dimmed" size="sm">
            {t('No copilots yet. Create your first one!')}
          </Text>
        </div>
      ) : (
        // Copilots Grid
        <Grid gutter="xs">
          {copilots.map((copilot) => (
            <Grid.Col span={{ base: 12, md: 6, lg: 4, xl: 3 }} key={copilot.id}>
              <CopilotItem copilot={copilot} />
            </Grid.Col>
          ))}
        </Grid>
      )}
    </Stack>
  )
}
