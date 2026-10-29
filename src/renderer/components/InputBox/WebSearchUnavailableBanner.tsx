import { ActionIcon, Button, Flex, Text } from '@mantine/core'
import { IconAlertCircle, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { navigateToSettings } from '@/modals/settings-navigation'
import { getWebSearchConfigurationIssue } from '@/packages/web-search/configuration-issue'
import { useSettingsStore } from '@/stores/settingsStore'

const dismissedSessionIds = new Set<string>()

type BannerProps = { sessionId: string; errorCount: number; latestHasError: boolean | undefined }

export function WebSearchUnavailableBanner(props: BannerProps) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const webSearchConfiguration = useSettingsStore((state) => state.extension.webSearch)
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const [, refreshDismissedState] = useState(0)
  const sessionId = props.sessionId
  const dismissed = dismissedSessionIds.has(sessionId)
  const stillRequiresChatboxSignIn =
    getWebSearchConfigurationIssue(webSearchConfiguration, licenseKey) === 'chatbox-ai-sign-in'
  if (!stillRequiresChatboxSignIn || dismissed || props.errorCount === 0 || props.latestHasError !== false) return null

  const dismiss = () => {
    dismissedSessionIds.add(sessionId)
    refreshDismissedState((value) => value + 1)
  }

  return (
    <Flex
      role="status"
      align="center"
      justify="space-between"
      gap="xs"
      px={10}
      py={8}
      className="rounded-2xl border border-solid border-chatbox-border-primary bg-chatbox-background-primary shadow-sm"
      style={{ borderLeft: '3px solid var(--chatbox-tint-warning)' }}
    >
      <Flex align="center" gap={6} className="min-w-0 flex-1">
        <IconAlertCircle size={14} color="var(--chatbox-tint-warning)" className="shrink-0" />
        <Text size="xs" c="chatbox-secondary" truncate>
          {isSmallScreen
            ? t('Web Search was skipped: sign in to Chatbox AI')
            : t(
                'Web Search was skipped because Chatbox AI requires sign-in. Future searches in this chat will fail until you sign in or change providers.'
              )}
        </Text>
      </Flex>
      <Flex align="center" gap={4} className="shrink-0">
        <Button h={24} px={10} radius={12} size="compact-xs" variant="light" onClick={() => navigateToSettings()}>
          {isSmallScreen ? t('Sign in') : t('Sign in to Chatbox AI')}
        </Button>
        {!isSmallScreen && (
          <Button
            h={24}
            px={8}
            radius={12}
            size="compact-xs"
            variant="subtle"
            onClick={() => navigateToSettings('/web-search')}
          >
            {t('Web Search settings')}
          </Button>
        )}
        <ActionIcon variant="subtle" size={22} radius="xl" aria-label={t('Close')} onClick={dismiss}>
          <IconX size={13} />
        </ActionIcon>
      </Flex>
    </Flex>
  )
}
