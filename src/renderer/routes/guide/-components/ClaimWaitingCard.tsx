/**
 * ClaimWaitingCard — shown after the user clicks "Claim Free Plan" and lands on the website.
 *
 * Owns the polling lifecycle (via useClaimPolling), renders a minimal waiting indicator,
 * and surfaces two escape hatches: re-open the page and skip.
 */

import { Anchor, Flex, Group, Loader, Stack, Text } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openLinkWithAuth } from '@/packages/openLinkWithAuth'
import { buildChatboxUrl, type UserLicense } from '@/packages/remote'
import { useSettingsStore } from '@/stores/settingsStore'
import { useClaimPolling } from '../-hooks/useClaimPolling'

interface ClaimWaitingCardProps {
  onClaimDetected: (license: UserLicense, email: string) => void
}

function buildClaimUrl(language: string) {
  return buildChatboxUrl(
    `/redirect_app/claim_free_plan/${language}/?utm_source=app&utm_content=guide_session_free_trial`
  )
}

export function ClaimWaitingCard({ onClaimDetected }: ClaimWaitingCardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const language = useSettingsStore((s) => s.language) || 'en'
  const hasLicense = useSettingsStore((s) => Boolean(s.licenseKey))
  const [timedOut, setTimedOut] = useState(false)

  useClaimPolling({
    enabled: !hasLicense && !timedOut,
    onClaimed: onClaimDetected,
    onTimeout: () => setTimedOut(true),
  })

  const handleSkip = () => {
    void navigate({ to: '/' })
  }

  const handleReopenPage = () => {
    void openLinkWithAuth(buildClaimUrl(language)).catch((err) => {
      console.warn('[guide] reopen claim page failed:', err)
    })
  }

  if (timedOut) {
    return (
      <Stack gap="xs" mt="md">
        <Text size="sm" c="chatbox-text-secondary">
          {t("Looks like it's taking a while. You can open Settings to log in again, or close and reopen the app.")}
        </Text>
        <Group gap="md">
          <Anchor size="sm" component="button" type="button" onClick={handleSkip}>
            {t('Skip for now')}
          </Anchor>
        </Group>
      </Stack>
    )
  }

  return (
    <Stack gap="sm" mt="md">
      <Flex align="center" gap="xs">
        <Loader size="xs" type="dots" />
        <Text size="sm" c="chatbox-text-secondary">
          {t("We're waiting for you to finish on chatboxai.app...")}
        </Text>
      </Flex>
      <Group gap="md">
        <Anchor size="sm" component="button" type="button" onClick={handleReopenPage}>
          {t('Open page again')}
        </Anchor>
        <Anchor size="sm" component="button" type="button" onClick={handleSkip}>
          {t('Skip for now')}
        </Anchor>
      </Group>
    </Stack>
  )
}
