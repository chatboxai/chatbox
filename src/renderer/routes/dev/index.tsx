import { Badge, Button, Card, Container, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { IconCode, IconExternalLink, IconEye } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ScalableIcon } from '@/components/ScalableIcon'

export const Route = createFileRoute('/dev/')({
  component: DevIndexPage,
})

const devPages = [
  {
    path: '/dev/model-selector',
    name: 'ModelSelector',
    description: 'Model selection component with desktop/mobile responsive views',
    tags: ['Component', 'UI'],
  },
  {
    path: '/dev/storage',
    name: 'Storage Explorer',
    description: 'Inspect key-value and blob storage entries provided by the unified platform layer',
    tags: ['Tool', 'Storage'],
  },
  {
    path: '/dev/css-var',
    name: 'CSS Variables Preview',
    description: 'CSS Variables Preview',
    tags: ['UI'],
  },
  // Add more dev pages here as they are created
]

function DevIndexPage() {
  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        {/* Header */}
        <div>
          <Group justify="space-between" align="center" mb="md">
            <Title order={1}>Dev Tools</Title>
            <Badge size="lg" variant="light" color="blue">
              Development Mode
            </Badge>
          </Group>
          <Text c="dimmed">
            Component previews and development tools. These are available when running in development mode or when the
            dev tools override is enabled.
          </Text>
        </div>

        {/* Available Pages */}
        <Paper shadow="xs" p="lg" radius="md">
          <Title order={3} mb="md">
            <Group gap="xs">
              <ScalableIcon icon={IconEye} size={20} />
              <span>Component Previews</span>
            </Group>
          </Title>

          <Stack gap="md">
            {devPages.map((page) => (
              <Card key={page.path} shadow="xs" p="md" radius="md" withBorder>
                <Group justify="space-between" align="start">
                  <div style={{ flex: 1 }}>
                    <Group gap="xs" mb="xs">
                      <Text fw={600}>{page.name}</Text>
                      {page.tags.map((tag) => (
                        <Badge key={tag} size="sm" variant="light">
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                    <Text size="sm" c="dimmed">
                      {page.description}
                    </Text>
                  </div>
                  <Button
                    component={Link}
                    to={page.path}
                    variant="light"
                    size="sm"
                    rightSection={<ScalableIcon icon={IconExternalLink} />}
                  >
                    Open Preview
                  </Button>
                </Group>
              </Card>
            ))}

            {devPages.length === 0 && (
              <Text c="dimmed" ta="center" py="xl">
                No component previews available yet
              </Text>
            )}
          </Stack>
        </Paper>

        {/* Instructions */}
        <Paper shadow="xs" p="lg" radius="md" className="bg-blue-50 dark:bg-blue-950/20">
          <Title order={4} mb="md">
            <Group gap="xs">
              <ScalableIcon icon={IconCode} size={18} />
              <span>How to Add New Previews</span>
            </Group>
          </Title>
          <Stack gap="xs">
            <Text size="sm">
              1. Create a preview component in <code>/src/renderer/components/[ComponentName]/Preview.tsx</code>
            </Text>
            <Text size="sm">
              2. Create a route file in <code>/src/renderer/routes/dev/[component-name].tsx</code>
            </Text>
            <Text size="sm">
              3. Add the page info to the <code>devPages</code> array in this file
            </Text>
            <Text size="sm">4. The preview will automatically appear in this list</Text>
          </Stack>
        </Paper>

        {/* Note */}
        <Paper shadow="xs" p="md" radius="md" className="bg-yellow-50 dark:bg-yellow-950/20">
          <Group gap="xs">
            <Text size="sm" fw={500}>
              ⚠️ Note:
            </Text>
            <Text size="sm">
              These dev tools are hidden in production builds unless <code>FORCE_ENABLE_DEV_PAGES</code> in{' '}
              <code>src/renderer/dev/devToolsConfig.ts</code> is set to <code>true</code>.
            </Text>
          </Group>
        </Paper>
      </Stack>
    </Container>
  )
}

export default DevIndexPage
