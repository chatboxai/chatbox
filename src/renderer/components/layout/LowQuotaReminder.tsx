import { Box, Button, Flex, Progress, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  formatComputePointsRemainingRatio,
  getComputePointsRemainingRatio,
} from '@/packages/chatbox-cli/compute-points'
import { buildChatboxUrl, getLicenseDetailRealtime } from '@/packages/remote'
import platform from '@/platform'
import { useLanguage, useSettingsStore } from '@/stores/settingsStore'
import { uiStore, useUIStore } from '@/stores/uiStore'

const LOW_QUOTA_RATIO = 0.1

/** Sidebar card shown while the active Chatbox AI license has 10% or less of its points left. */
export function SidebarLowQuotaReminder() {
  const { t, i18n } = useTranslation()
  const language = useLanguage()
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const dismissedPeriod = useUIStore((state) => state.lowQuotaReminderDismissedPeriod)

  const { data: detail } = useQuery({
    queryKey: ['sidebar-low-quota', licenseKey],
    queryFn: async () => (await getLicenseDetailRealtime({ licenseKey: licenseKey ?? '' })).data,
    enabled: !!licenseKey,
    staleTime: 30_000,
    // Poll fast once points get close to the threshold so the bar moves while a reply is generating.
    refetchInterval: (query) =>
      query.state.data && getComputePointsRemainingRatio(query.state.data) <= LOW_QUOTA_RATIO * 2 ? 30_000 : 5 * 60_000,
    refetchOnWindowFocus: true,
  })

  if (!detail) return null
  const ratio = getComputePointsRemainingRatio(detail)
  // A new quota period gets a fresh reminder.
  const period = `${licenseKey}:${detail.token_refreshed_time}`
  if (ratio > LOW_QUOTA_RATIO || dismissedPeriod === period) return null

  const percent = formatComputePointsRemainingRatio(ratio, i18n.language)

  return (
    <Box
      role="status"
      px="sm"
      py={10}
      className="rounded-md bg-chatbox-background-primary shadow-md dark:bg-chatbox-background-secondary dark:shadow-lg"
    >
      <Flex justify="space-between" align="baseline" gap="xs">
        <Text size="sm" fw={500} c="chatbox-error" truncate>
          {t('Points running low')}
        </Text>
        <Text size="xs" c="chatbox-tertiary" className="tabular-nums shrink-0">
          {percent}
        </Text>
      </Flex>
      <Progress
        value={ratio * 100}
        size={4}
        mt={8}
        color="chatbox-warning"
        aria-label={percent}
        styles={{ root: { background: 'var(--chatbox-border-primary)' } }}
      />
      <Flex justify="flex-end" gap={4} mt={6} mr={-8} mb={-4}>
        <Button
          size="compact-xs"
          variant="subtle"
          color="chatbox-tertiary"
          onClick={() => uiStore.setState({ lowQuotaReminderDismissedPeriod: period })}
        >
          {t('Close')}
        </Button>
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() =>
            platform.openLink(
              buildChatboxUrl(`/redirect_app/view_more_plans/${language}?utm_source=app&utm_content=sidebar_low_quota`)
            )
          }
        >
          {detail.plan === 'pro_plus' ? t('Buy expansion pack') : t('Upgrade plan')}
        </Button>
      </Flex>
    </Box>
  )
}
