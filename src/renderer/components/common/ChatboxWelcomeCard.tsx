import { Button, Flex, Paper, Stack, Text } from '@mantine/core'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS } from '@/analytics/jk-events'
import { navigateToSettings } from '@/modals/settings-navigation'
import { openLinkWithAuth } from '@/packages/openLinkWithAuth'
import * as remote from '@/packages/remote'
import { useLanguage } from '@/stores/settingsStore'
import type { HomeWelcomeCardMode } from '@/utils/homeWelcomeCard'

export function ChatboxWelcomeCard(props: { mode: HomeWelcomeCardMode; pageName: string; className?: string }) {
  const { mode, pageName, className } = props
  const { t } = useTranslation()
  const language = useLanguage()
  const [pendingAction, setPendingAction] = useState<'claim-free-plan' | 'purchase-plan' | 'view-more-plans' | null>(
    null
  )
  const pendingActionRef = useRef(false)

  if (mode === 'none') {
    return null
  }

  return (
    <Paper
      radius="lg"
      withBorder
      py="md"
      px="sm"
      className={`bg-white/40 dark:bg-zinc-900/40 backdrop-blur-md ${className || ''}`}
    >
      <Stack gap="sm">
        <Stack gap="xxs" align="center">
          <Text fw={600} className="text-center">
            {t('Welcome to Chatbox!')}
          </Text>

          <Text size="xs" c="chatbox-tertiary" className="text-center">
            {mode === 'login' ? t('Login to start chatting with AI') : t('No licenses found')}
          </Text>
        </Stack>

        <Flex gap="xs" justify="center" align="center" wrap="wrap">
          {mode === 'expired-license' ? (
            <>
              <Button
                size="xs"
                variant="filled"
                h={32}
                miw={160}
                fw={600}
                flex="0 1 auto"
                onClick={() => {
                  if (pendingActionRef.current) return

                  pendingActionRef.current = true
                  trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
                    pageName,
                    content: 'welcome_card_expired',
                  })
                  setPendingAction('purchase-plan')
                  openLinkWithAuth(
                    remote.buildChatboxUrl(
                      `/redirect_app/view_more_plans/${language}/?utm_source=app&utm_content=provider_cb_login_purchase`
                    )
                  )
                    .catch((err) => {
                      console.error('Failed to open purchase plan link:', err)
                    })
                    .finally(() => {
                      pendingActionRef.current = false
                      setPendingAction(null)
                    })
                }}
                loading={pendingAction === 'purchase-plan'}
                disabled={pendingAction !== null}
              >
                {t('Purchase Plan')}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                c="chatbox-tertiary"
                h={32}
                fw={400}
                flex="0 1 auto"
                onClick={() => navigateToSettings('chatbox-ai')}
              >
                {t('View License Details')}
              </Button>
            </>
          ) : mode === 'no-license' ? (
            <>
              <Button
                size="xs"
                variant="filled"
                h={32}
                miw={160}
                fw={600}
                flex="0 1 auto"
                onClick={() => {
                  if (pendingActionRef.current) return

                  pendingActionRef.current = true
                  trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
                    pageName,
                    content: 'welcome_card',
                  })
                  setPendingAction('claim-free-plan')
                  openLinkWithAuth(
                    remote.buildChatboxUrl(
                      `/redirect_app/claim_free_plan/${language}/?utm_source=app&utm_content=provider_cb_login_claim_free`
                    )
                  )
                    .catch((err) => {
                      console.error('Failed to open claim free plan link:', err)
                    })
                    .finally(() => {
                      pendingActionRef.current = false
                      setPendingAction(null)
                    })
                }}
                loading={pendingAction === 'claim-free-plan'}
                disabled={pendingAction !== null}
              >
                {t('Claim Free Plan')}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                c="chatbox-tertiary"
                h={32}
                fw={400}
                flex="0 1 auto"
                onClick={() => {
                  if (pendingActionRef.current) return

                  pendingActionRef.current = true
                  setPendingAction('view-more-plans')
                  openLinkWithAuth(
                    remote.buildChatboxUrl(
                      `/redirect_app/view_more_plans/${language}/?utm_source=app&utm_content=provider_cb_login_more_plans`
                    )
                  )
                    .catch((err) => {
                      console.error('Failed to open view more plans link:', err)
                    })
                    .finally(() => {
                      pendingActionRef.current = false
                      setPendingAction(null)
                    })
                }}
                loading={pendingAction === 'view-more-plans'}
                disabled={pendingAction !== null}
              >
                {t('View More Plans')}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="xs"
                variant="filled"
                h={32}
                miw={160}
                fw={600}
                flex="0 1 auto"
                onClick={() => {
                  trackJkClickEvent(JK_EVENTS.LOGIN_BUTTON_CLICK, {
                    pageName,
                  })
                  navigateToSettings('chatbox-ai')
                }}
              >
                {t('Login Chatbox AI')}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                c="chatbox-tertiary"
                h={32}
                fw={400}
                flex="0 1 auto"
                onClick={() => navigateToSettings('provider')}
              >
                {t('Other options')}
              </Button>
            </>
          )}
        </Flex>
      </Stack>
    </Paper>
  )
}
