import { Box, Button, Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconGift, IconPlayerPlay } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { GLASS_FILL_CLASS } from '@/lib/glass-surface'

interface AgentModeRewardQuotaCardProps {
  onAction: () => void
  loading?: boolean
  claimFailed?: boolean
  rewardClaimed?: boolean
  resumeFailed?: boolean
}

export function AgentModeRewardQuotaCard({
  onAction,
  loading = false,
  claimFailed = false,
  rewardClaimed = false,
  resumeFailed = false,
}: AgentModeRewardQuotaCardProps) {
  const { t } = useTranslation()

  return (
    <Paper
      role="status"
      radius={8}
      p={16}
      withBorder
      className={`bg-chatbox-background-primary ${GLASS_FILL_CLASS}`}
      style={{ borderColor: 'rgba(34, 139, 230, 0.35)' }}
    >
      <Group align="flex-start" wrap="nowrap" gap={14}>
        <ThemeIcon
          size={38}
          radius="50%"
          variant="light"
          style={{
            flexShrink: 0,
            color: 'var(--chatbox-tint-brand)',
            background: 'rgba(34, 139, 230, 0.1)',
          }}
        >
          <IconGift size={20} stroke={1.8} />
        </ThemeIcon>

        <Box style={{ flex: 1, minWidth: 0 }}>
          <Stack gap={4}>
            <Text size="sm" fw={600} lh={1.45}>
              {t('Your points are used up. Claim free reward quota to continue.')}
            </Text>
            <Text size="13px" c="var(--chatbox-tint-secondary)" lh={1.6}>
              {t('Work mode uses more points. Claim a one-time free reward to continue this interrupted task.')}
            </Text>
          </Stack>

          <Button
            mt={10}
            h={32}
            px={14}
            radius={6}
            size="xs"
            loading={loading}
            rightSection={!loading ? <IconPlayerPlay size={14} stroke={2} /> : undefined}
            onClick={onAction}
            style={{
              fontWeight: 600,
              color: 'var(--chatbox-tint-white)',
              background: 'var(--chatbox-background-brand-primary)',
            }}
          >
            {rewardClaimed ? t('Continue') : t('Claim reward and continue')}
          </Button>

          {(claimFailed || resumeFailed) && (
            <Text size="xs" c="chatbox-error" lh={1.5} mt={6}>
              {resumeFailed
                ? t('Reward claimed, but the task could not resume automatically. Please retry.')
                : t('Could not claim the reward. Please try again.')}
            </Text>
          )}
        </Box>
      </Group>
    </Paper>
  )
}
