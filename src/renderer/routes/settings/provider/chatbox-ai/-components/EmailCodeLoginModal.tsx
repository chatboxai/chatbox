import { Alert, Anchor, Button, Flex, Stack, Text, TextInput } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/layout/Overlay'
import { useLogin } from './useLogin'

interface EmailCodeLoginModalProps {
  opened: boolean
  onClose: () => void
  language: string
  onLoginSuccess: (tokens: { accessToken: string; refreshToken: string }) => Promise<void>
}

export function EmailCodeLoginModal({ opened, onClose, language, onLoginSuccess }: EmailCodeLoginModalProps) {
  const { t } = useTranslation()
  const lastAutoSubmittedCodeRef = useRef('')
  const {
    email,
    setEmail,
    code,
    setCode,
    loginError,
    loginState,
    countdown,
    hasEnteredCodeStep,
    canSendCode,
    canVerifyCode,
    sendCode,
    verifyCode,
    reset,
  } = useLogin({
    language,
    onLoginSuccess,
  })

  const isSendingCode = loginState === 'sending_code'
  const isVerifyingCode = loginState === 'verifying_code'

  const handleClose = useCallback(() => {
    lastAutoSubmittedCodeRef.current = ''
    reset()
    onClose()
  }, [onClose, reset])

  const handleVerify = useCallback(async () => {
    const success = await verifyCode()
    if (success) {
      handleClose()
    }
  }, [handleClose, verifyCode])

  useEffect(() => {
    if (code.length < 6) {
      lastAutoSubmittedCodeRef.current = ''
      return
    }

    if (!hasEnteredCodeStep || isVerifyingCode || code === lastAutoSubmittedCodeRef.current) {
      return
    }

    lastAutoSubmittedCodeRef.current = code
    void handleVerify()
  }, [code, handleVerify, hasEnteredCodeStep, isVerifyingCode])

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      centered
      size="md"
      title={t('Login to Chatbox AI')}
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      <Stack gap="md">
        <Text size="sm" c="chatbox-secondary">
          {hasEnteredCodeStep
            ? t('Enter the 6-digit verification code we sent to your email.')
            : t('If no account exists, it will automatically create one.')}
        </Text>

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            {t('Email')}
          </Text>

          <TextInput
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            disabled={(hasEnteredCodeStep && countdown > 0) || isSendingCode || isVerifyingCode}
          />

          <Flex justify="flex-end" align="center" gap="sm">
            <Button
              variant="light"
              onClick={() => void sendCode()}
              loading={isSendingCode}
              disabled={!canSendCode}
              leftSection={hasEnteredCodeStep ? <IconRefresh size={14} /> : undefined}
              style={{ flexShrink: 0 }}
            >
              {countdown > 0 ? t('Resend in {{count}}s', { count: countdown }) : t('Send Code')}
            </Button>
          </Flex>
        </Stack>

        <Stack gap="xs" style={{ opacity: hasEnteredCodeStep ? 1 : 0.65 }}>
          <Flex align="center" justify="space-between" gap="sm">
            <Text size="sm" fw={500}>
              {t('Verification Code')}
            </Text>
          </Flex>

          <TextInput
            value={code}
            onChange={(event) => {
              const nextValue = event.currentTarget.value.replace(/\D/g, '').slice(0, 6)
              setCode(nextValue)
            }}
            disabled={!hasEnteredCodeStep || isVerifyingCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            styles={{
              input: {
                letterSpacing: '0.45em',
                fontVariantNumeric: 'tabular-nums',
              },
            }}
          />
        </Stack>

        {loginError && (
          <Alert color="red" variant="light" title={t('Verification failed')}>
            {loginError}
          </Alert>
        )}

        <Text size="xs" c="chatbox-tertiary">
          {t('By continuing, you agree to our')}{' '}
          <Anchor size="xs" href="https://chatboxai.app/terms" target="_blank" underline="hover">
            {t('Terms of Service')}
          </Anchor>
          . {t('Read our')}{' '}
          <Anchor size="xs" href="https://chatboxai.app/privacy" target="_blank" underline="hover">
            {t('Privacy Policy')}
          </Anchor>
          .
        </Text>

        <Flex gap="sm" justify="flex-end" align="center">
          <Button color="chatbox-gray" variant="light" onClick={handleClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void handleVerify()} loading={isVerifyingCode} disabled={!canVerifyCode}>
            {t('Verify and Log in')}
          </Button>
        </Flex>
      </Stack>
    </Modal>
  )
}
