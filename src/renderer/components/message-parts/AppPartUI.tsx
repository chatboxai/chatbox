import { Group, Paper, Stack, Text } from '@mantine/core'
import type { MessageAppLifecycle, MessageAppPart } from '@shared/types'
import {
  IconAlertTriangle,
  IconApps,
  IconCircleCheckFilled,
  IconClockHour4,
  IconPlayerPlayFilled,
  IconPlugConnected,
} from '@tabler/icons-react'
import type { FC } from 'react'
import { getMessageAppPartText } from '@shared/utils/message'
import { ScalableIcon } from '../common/ScalableIcon'

const APP_LIFECYCLE_LABELS: Record<MessageAppLifecycle, string> = {
  launching: 'Launching',
  ready: 'Ready',
  active: 'Active',
  complete: 'Complete',
  error: 'Error',
  stale: 'Stale',
}

const getLifecycleIcon = (lifecycle: MessageAppLifecycle) => {
  switch (lifecycle) {
    case 'launching':
      return IconPlayerPlayFilled
    case 'ready':
      return IconPlugConnected
    case 'active':
      return IconApps
    case 'complete':
      return IconCircleCheckFilled
    case 'error':
      return IconAlertTriangle
    case 'stale':
      return IconClockHour4
  }
}

const getLifecycleColor = (lifecycle: MessageAppLifecycle): string => {
  switch (lifecycle) {
    case 'complete':
      return 'var(--chatbox-tint-success)'
    case 'error':
      return 'var(--chatbox-tint-error)'
    case 'stale':
      return 'var(--chatbox-tint-warning)'
    default:
      return 'var(--chatbox-tint-brand)'
  }
}

export const AppPartUI: FC<{ part: MessageAppPart }> = ({ part }) => {
  const appLabel = part.appName || part.appId
  const summary = getMessageAppPartText(part)
  const lifecycleLabel = APP_LIFECYCLE_LABELS[part.lifecycle]
  const lifecycleColor = getLifecycleColor(part.lifecycle)
  const LifecycleIcon = getLifecycleIcon(part.lifecycle)

  return (
    <Paper
      withBorder
      radius="md"
      p="sm"
      mb="xs"
      role="status"
      aria-label={`${appLabel} ${lifecycleLabel}`}
      bg="var(--chatbox-background-brand-secondary)"
    >
      <Stack gap={4}>
        <Group gap="xs">
          <ScalableIcon icon={LifecycleIcon} color={lifecycleColor} />
          <Text fw={600} size="sm">
            {appLabel}
          </Text>
          <Text size="xs" c={part.lifecycle === 'error' ? 'chatbox-error' : 'chatbox-tertiary'}>
            {lifecycleLabel}
          </Text>
        </Group>
        <Text size="sm">{summary}</Text>
        {part.error && part.lifecycle === 'error' && (
          <Text size="xs" c="chatbox-error">
            {part.error}
          </Text>
        )}
      </Stack>
    </Paper>
  )
}
