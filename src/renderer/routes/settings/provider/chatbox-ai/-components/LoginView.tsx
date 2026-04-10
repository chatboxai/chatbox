import { Anchor, Button, Flex, Image, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { IconArrowRight, IconCircleCheckFilled } from '@tabler/icons-react'
import { forwardRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { trackingEvent } from '@/packages/event'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import icon from '@/static/icon.png'
import * as premiumActions from '@/stores/premiumActions'
import { settingsStore } from '@/stores/settingsStore'
import { EmailCodeLoginModal } from './EmailCodeLoginModal'
import type { AuthTokens } from './types'

interface LoginViewProps {
  language: string
  saveAuthTokens: (tokens: AuthTokens) => Promise<void>
  onSwitchToLicenseKey: () => void
}

export const LoginView = forwardRef<HTMLDivElement, LoginViewProps>(
  ({ language, saveAuthTokens, onSwitchToLicenseKey }, ref) => {
    const { t } = useTranslation()
    const [loginModalOpened, setLoginModalOpened] = useState(false)

    // 登录成功时，先清理 manual license，再保存 tokens
    const handleLoginSuccess = useCallback(
      async (tokens: AuthTokens) => {
        const settings = settingsStore.getState()
        if (settings.licenseKey && settings.licenseActivationMethod === 'manual') {
          await premiumActions.deactivate(false) // false = 不清除 login tokens
        }
        await saveAuthTokens(tokens)
      },
      [saveAuthTokens]
    )

    return (
      <Stack gap="xl" ref={ref} style={{ position: 'relative' }}>
        <Stack gap="xs">
          <Flex align="center" justify="space-between">
            <Flex gap="md" align="center">
              <Image src={icon} w={48} h={48} />
            </Flex>
            <Flex gap="xs" align="center">
              <Text c="chatbox-tertiary" className="text-right">
                {t('Continue with')}{' '}
                <UnstyledButton onClick={onSwitchToLicenseKey}>
                  <Flex gap="xxs" align="center">
                    <Text span className="!text-chatbox-tint-brand">
                      {t('license key')}
                    </Text>
                    <ScalableIcon icon={IconArrowRight} size={16} className="!text-chatbox-tint-brand" />
                  </Flex>
                </UnstyledButton>
              </Text>
            </Flex>
          </Flex>
          <Stack gap="0">
            <Title order={3} c="chatbox-primary">
              {t('Welcome to Chatbox')}
            </Title>
            <Text c="chatbox-tertiary">{t('Log in to your Chatbox account')}</Text>
          </Stack>
        </Stack>
        <Stack gap="md">
          <Flex align="stretch" justify="center" direction="column" gap="sm">
            <Stack gap="xs">
              <Button
                fullWidth
                onClick={() => {
                  trackJkClickEvent(JK_EVENTS.LOGIN_BUTTON_CLICK, {
                    pageName: JK_PAGE_NAMES.SETTING_PAGE,
                  })
                  setLoginModalOpened(true)
                }}
              >
                {t('Login')}
              </Button>
              <Text c="chatbox-tertiary">
                {t('By continuing, you agree to our')}{' '}
                <Anchor
                  size="sm"
                  href="https://chatboxai.app/terms"
                  target="_blank"
                  underline="hover"
                  c="chatbox-tertiary"
                >
                  {t('Terms of Service')}
                </Anchor>
                . {t('Read our')}{' '}
                <Anchor
                  size="sm"
                  href="https://chatboxai.app/privacy"
                  target="_blank"
                  underline="hover"
                  c="chatbox-tertiary"
                >
                  {t('Privacy Policy')}
                </Anchor>
                .
              </Text>
            </Stack>
          </Flex>
        </Stack>
        {/* promote card */}
        <Paper shadow="xs" p="sm" withBorder>
          <Stack gap="sm">
            <Text fw="600" c="chatbox-brand">
              {t('Chatbox AI offers a user-friendly AI solution to help you enhance productivity')}
            </Text>
            <Stack>
              {[
                t('Smartest AI-Powered Services for Rapid Access'),
                t('Vision, Drawing, File Understanding and more'),
                t('Hassle-free setup'),
                t('Ideal for work and study'),
              ].map((item) => (
                <Flex key={item} gap="xs" align="center">
                  <ScalableIcon
                    icon={IconCircleCheckFilled}
                    className=" flex-shrink-0 flex-grow-0 text-chatbox-tint-brand"
                  />
                  <Text>{item}</Text>
                </Flex>
              ))}
            </Stack>
          </Stack>
        </Paper>

        <Flex gap="xs" align="center">
          <Button
            variant="outline"
            flex={1}
            onClick={() => {
              platform.openLink(
                buildChatboxUrl(
                  `/redirect_app/get_license/${language}?utm_source=app&utm_content=provider_cb_login_get_license`
                )
              )
              trackingEvent('click_get_license_button', { event_category: 'user' })
            }}
          >
            {t('Get License')}
          </Button>
          <Button
            variant="outline"
            flex={1}
            onClick={() => {
              platform.openLink(buildChatboxUrl(`/redirect_app/manage_license/${language}`))
              trackingEvent('click_retrieve_license_button', { event_category: 'user' })
            }}
          >
            {t('Retrieve License')}
          </Button>
        </Flex>

        <EmailCodeLoginModal
          opened={loginModalOpened}
          onClose={() => setLoginModalOpened(false)}
          language={language}
          onLoginSuccess={handleLoginSuccess}
        />
      </Stack>
    )
  }
)

LoginView.displayName = 'LoginView'
