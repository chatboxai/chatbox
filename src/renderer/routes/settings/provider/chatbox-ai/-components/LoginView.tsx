import {
  Alert,
  Anchor,
  Button,
  Flex,
  Image,
  Notification,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { IconArrowRight, IconCircleCheckFilled, IconX } from '@tabler/icons-react'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/ScalableIcon'
import { trackingEvent } from '@/packages/event'
import platform from '@/platform'
import icon from '@/static/icon.png'
import * as premiumActions from '@/stores/premiumActions'
import { settingsStore } from '@/stores/settingsStore'
import type { AuthTokens } from './types'
import { useLogin } from './useLogin'

interface LoginViewProps {
  language: string
  saveAuthTokens: (tokens: AuthTokens) => Promise<void>
  onSwitchToLicenseKey: () => void
}

export const LoginView = forwardRef<HTMLDivElement, LoginViewProps>(
  ({ language, saveAuthTokens, onSwitchToLicenseKey }, ref) => {
    const { t } = useTranslation()
    const [showErrorNotification, setShowErrorNotification] = useState(false)

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

    const { handleLogin, loginError, loginUrl, loginState } = useLogin({
      language,
      onLoginSuccess: handleLoginSuccess,
    })

    useEffect(() => {
      if ((loginState === 'error' || loginState === 'timeout') && loginError) {
        setShowErrorNotification(true)
        const timer = setTimeout(() => {
          setShowErrorNotification(false)
        }, 5000)
        return () => clearTimeout(timer)
      } else {
        setShowErrorNotification(false)
      }
    }, [loginState, loginError])

    return (
      <Stack gap="xl" ref={ref} style={{ position: 'relative' }}>
        {showErrorNotification && (
          <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 1000, maxWidth: 400 }}>
            <Notification
              icon={<ScalableIcon icon={IconX} size={20} />}
              color="red"
              title={loginState === 'timeout' ? t('Login Timeout') : t('Login Error')}
              onClose={() => setShowErrorNotification(false)}
            >
              {loginError}
            </Notification>
          </div>
        )}

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
                onClick={handleLogin}
                loading={loginState === 'requesting' || loginState === 'polling'}
                disabled={loginState === 'success'}
              >
                {loginState === 'requesting' && t('Requesting...')}
                {loginState === 'polling' && t('Waiting for login...')}
                {loginState === 'success' && t('Login Successful')}
                {(loginState === 'idle' || loginState === 'error' || loginState === 'timeout') && t('Login')}
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

            {loginState === 'polling' && (
              <Alert variant="light" color="blue" p="sm">
                <Text size="sm">
                  {platform.type === 'web'
                    ? t('Please click the link below to complete login:')
                    : t(
                        'Please complete login in your browser. If you are not redirected, please click the link below:'
                      )}
                </Text>
                <Text size="sm">
                  <Text
                    span
                    className="underline ml-1 break-all cursor-pointer"
                    onClick={() => {
                      if (!loginUrl) return
                      platform.openLink(loginUrl)
                    }}
                  >
                    {loginUrl}
                  </Text>
                </Text>
              </Alert>
            )}
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
              platform.openLink(`https://chatboxai.app/redirect_app/get_license`)
              trackingEvent('click_get_license_button', { event_category: 'user' })
            }}
          >
            {t('Get License')}
          </Button>
          <Button
            variant="outline"
            flex={1}
            onClick={() => {
              platform.openLink(`https://chatboxai.app/redirect_app/manage_license/${language}`)
              trackingEvent('click_retrieve_license_button', { event_category: 'user' })
            }}
          >
            {t('Retrieve License')}
          </Button>
        </Flex>
      </Stack>
    )
  }
)

LoginView.displayName = 'LoginView'
