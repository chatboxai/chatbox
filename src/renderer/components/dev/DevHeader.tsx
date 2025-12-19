import { ActionIcon, Group, Paper, Text, Tooltip } from '@mantine/core'
import { IconArrowLeft, IconHome } from '@tabler/icons-react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { ScalableIcon } from '../ScalableIcon'
import ThemeSwitchButton from './ThemeSwitchButton'

interface DevHeaderProps {
  title?: string
}

export function DevHeader({ title }: DevHeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const isDevIndex = location.pathname === '/dev' || location.pathname === '/dev/'

  return (
    <Paper
      p="md"
      shadow="sm"
      style={{
        borderBottom: '1px solid var(--chatbox-border-primary)',
        backgroundColor: 'var(--chatbox-background-primary)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <Group justify="space-between">
        <Group gap="md">
          {/* Back button - show only if not on dev index */}
          {!isDevIndex && (
            <Tooltip label="Back to Dev Tools">
              <ActionIcon variant="subtle" size="lg" onClick={() => navigate({ to: '/dev' })}>
                <ScalableIcon icon={IconArrowLeft} size={20} />
              </ActionIcon>
            </Tooltip>
          )}

          {/* Home button - always show */}
          <Tooltip label="Home">
            <ActionIcon variant="subtle" size="lg" onClick={() => navigate({ to: '/' })}>
              <ScalableIcon icon={IconHome} size={20} />
            </ActionIcon>
          </Tooltip>

          {/* Page title */}
          {title && (
            <Text fw={600} size="lg">
              {title}
            </Text>
          )}
        </Group>

        <Group gap="xs">
          {/* Quick actions */}
          <ThemeSwitchButton />
        </Group>
      </Group>
    </Paper>
  )
}

export default DevHeader
