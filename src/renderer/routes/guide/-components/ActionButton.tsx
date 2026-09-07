/**
 * ActionButton - Reusable button for login and provider settings actions
 */

import { Box, Button, Flex, Group, Modal, Radio, Stack, Text } from '@mantine/core'
import { IconCirclePlus, IconExternalLink, IconId, IconInfoCircle, IconSettings } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { navigateToSettings } from '@/modals/settings-navigation'
import { openLinkWithAuth } from '@/packages/openLinkWithAuth'
import { buildChatboxUrl, getUserProfile, listLicensesByUser, type UserLicense } from '@/packages/remote'
import platform from '@/platform'
import { EmailCodeLoginModal } from '@/routes/settings/provider/chatbox-ai/-components/EmailCodeLoginModal'
import guideRedirectLoadingGif from '@/static/guide/guide-redirect-loading.gif'
import { authInfoStore } from '@/stores/authInfoStore'
import * as premiumActions from '@/stores/premiumActions'
import { settingsStore, useLanguage } from '@/stores/settingsStore'

interface LoginButtonProps {
  onLoginSuccess: () => void
}

const GUIDE_ACTION_BUTTON_MAX_WIDTH = 320
const AUTO_NEW_CHAT_DELAY_SECONDS = 3
const guideActionButtonWidthStyle = {
  width: '100%',
  maxWidth: GUIDE_ACTION_BUTTON_MAX_WIDTH,
} as const

export function LoginButton({ onLoginSuccess }: LoginButtonProps) {
  const { t } = useTranslation()
  const language = useLanguage()
  const [showLicenseModal, setShowLicenseModal] = useState(false)
  const [licenses, setLicenses] = useState<UserLicense[]>([])
  const [selectedLicenseKey, setSelectedLicenseKey] = useState('')
  const [activatingLicense, setActivatingLicense] = useState(false)
  // Remember success state to keep showing success UI even after new messages are added
  const [hasSucceeded, setHasSucceeded] = useState(false)
  const [loginModalOpened, setLoginModalOpened] = useState(false)

  const activateLicense = useCallback(
    async (licenseKey: string) => {
      setActivatingLicense(true)
      try {
        const result = await premiumActions.activate(licenseKey, 'login', { pageName: JK_PAGE_NAMES.HELP_PAGE })
        if (result.valid) {
          setHasSucceeded(true)
          onLoginSuccess()
        } else {
          console.error('License activation failed:', result.error)
          // Still mark as success since they logged in
          setHasSucceeded(true)
          onLoginSuccess()
        }
      } catch (error) {
        console.error('Failed to activate license:', error)
        setHasSucceeded(true)
        onLoginSuccess()
      } finally {
        setActivatingLicense(false)
        setShowLicenseModal(false)
      }
    },
    [onLoginSuccess]
  )

  const handleLoginSuccessInternal = useCallback(
    async (tokens: { accessToken: string; refreshToken: string }) => {
      // Save tokens
      authInfoStore.getState().setTokens(tokens)

      // Try to get and activate licenses
      try {
        const [fetchedLicenses, userProfile] = await Promise.all([listLicensesByUser(), getUserProfile()])

        if (fetchedLicenses.length === 1) {
          // Auto-activate single license
          await activateLicense(fetchedLicenses[0].key)
        } else if (fetchedLicenses.length > 1) {
          // Check for previously selected license
          const lastSelected = settingsStore.getState().lastSelectedLicenseByUser?.[userProfile.email]
          const isLastSelectedValid = lastSelected && fetchedLicenses.some((l: UserLicense) => l.key === lastSelected)

          if (isLastSelectedValid) {
            await activateLicense(lastSelected)
          } else {
            // Multiple licenses - show selection modal
            setLicenses(fetchedLicenses)
            setSelectedLicenseKey(fetchedLicenses[0].key)
            setShowLicenseModal(true)
          }
        } else {
          // No licenses but logged in - still mark as success
          setHasSucceeded(true)
          onLoginSuccess()
        }
      } catch (error) {
        console.error('Failed to get licenses:', error)
        // Still mark as login success even if license fetch fails
        setHasSucceeded(true)
        onLoginSuccess()
      }
    },
    [onLoginSuccess, activateLicense]
  )

  const handleLicenseConfirm = useCallback(() => {
    if (selectedLicenseKey) {
      void activateLicense(selectedLicenseKey)
    }
  }, [selectedLicenseKey, activateLicense])

  const trackLoginButtonClick = useCallback(() => {
    trackJkClickEvent(JK_EVENTS.LOGIN_BUTTON_CLICK, {
      pageName: JK_PAGE_NAMES.HELP_PAGE,
    })
  }, [])

  return (
    <>
      <Stack mt="md" gap="sm" style={guideActionButtonWidthStyle}>
        <Button
          onClick={() => {
            trackLoginButtonClick()
            setLoginModalOpened(true)
          }}
          disabled={hasSucceeded}
          variant="light"
          color={hasSucceeded ? 'green' : undefined}
          fullWidth
          h={42}
        >
          {hasSucceeded ? t('Login Successful') : t('Login to Chatbox AI')}
        </Button>
      </Stack>

      {/* License Selection Modal */}
      <Modal
        opened={showLicenseModal}
        onClose={() => {}}
        title={t('Select License')}
        centered
        closeOnClickOutside={false}
        closeOnEscape={false}
        withCloseButton={false}
      >
        <Stack gap="md">
          <Text size="sm" c="chatbox-secondary">
            {t('You have multiple licenses. Please select one to use:')}
          </Text>

          <Radio.Group value={selectedLicenseKey} onChange={setSelectedLicenseKey}>
            <Stack gap="xs">
              {licenses.map((license) => (
                <Radio
                  key={license.key}
                  value={license.key}
                  label={
                    <Stack gap={2}>
                      <Text fw={500}>{license.product_name}</Text>
                      <Text size="xs" c="chatbox-tertiary" className="font-mono">
                        {license.key.substring(0, 8)}
                        {'*'.repeat(12)}
                      </Text>
                    </Stack>
                  }
                />
              ))}
            </Stack>
          </Radio.Group>

          <Button fullWidth onClick={handleLicenseConfirm} loading={activatingLicense} disabled={!selectedLicenseKey}>
            {t('Confirm')}
          </Button>
        </Stack>
      </Modal>

      <EmailCodeLoginModal
        opened={loginModalOpened}
        onClose={() => setLoginModalOpened(false)}
        language={language}
        onLoginSuccess={handleLoginSuccessInternal}
      />
    </>
  )
}

export function ProviderSettingsButton() {
  const { t } = useTranslation()

  return (
    <Flex mt="md" style={guideActionButtonWidthStyle}>
      <Button
        leftSection={<ScalableIcon icon={IconSettings} size={18} />}
        onClick={() => navigateToSettings('/provider')}
        variant="light"
        fullWidth
        h={42}
      >
        {t('Set up API')}
      </Button>
    </Flex>
  )
}

/**
 * 普通"新对话"按钮，用于引导完成后的正常跳转场景（登录成功、对话轮次上限等）
 * 对应 tool: show_new_chat_button（客户端本地生成）
 */
interface NewChatButtonProps {
  label?: string
}

export function NewChatButton({ label }: NewChatButtonProps = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <Flex mt="md" style={guideActionButtonWidthStyle}>
      <Button variant="light" fullWidth h={42} onClick={() => navigate({ to: '/' })}>
        <ScalableIcon icon={IconCirclePlus} className="mr-2" />
        {label ?? t('New Chat')}
      </Button>
    </Flex>
  )
}

interface AutoNewChatLoadingProps {
  waitForWindowFocusBeforeAutoNavigate?: boolean
}

export function AutoNewChatLoading({ waitForWindowFocusBeforeAutoNavigate }: AutoNewChatLoadingProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [remainingSeconds, setRemainingSeconds] = useState(AUTO_NEW_CHAT_DELAY_SECONDS)

  useEffect(() => {
    let cancelled = false
    let countdownTimer: ReturnType<typeof setInterval> | undefined
    let completeTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimers = () => {
      if (countdownTimer) {
        clearInterval(countdownTimer)
        countdownTimer = undefined
      }
      if (completeTimer) {
        clearTimeout(completeTimer)
        completeTimer = undefined
      }
    }

    const startCountdown = () => {
      if (cancelled || countdownTimer || completeTimer || document.visibilityState !== 'visible') return

      setRemainingSeconds(AUTO_NEW_CHAT_DELAY_SECONDS)
      countdownTimer = setInterval(() => {
        setRemainingSeconds((current) => Math.max(0, current - 1))
      }, 1000)
      completeTimer = setTimeout(() => {
        clearTimers()
        setRemainingSeconds(0)
        void navigate({ to: '/' })
      }, AUTO_NEW_CHAT_DELAY_SECONDS * 1000)
    }

    const cancelWindowFocusListener = waitForWindowFocusBeforeAutoNavigate
      ? platform.onWindowFocused(startCountdown)
      : undefined

    const handleVisibilityChange = () => {
      if (!waitForWindowFocusBeforeAutoNavigate && document.visibilityState === 'visible') {
        startCountdown()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    const runInitialCheck = async () => {
      if (waitForWindowFocusBeforeAutoNavigate) {
        const isFocused = await platform.isWindowFocused().catch(() => false)
        if (!cancelled && isFocused) {
          startCountdown()
        }
        return
      }

      startCountdown()
    }
    void runInitialCheck()

    return () => {
      cancelled = true
      clearTimers()
      cancelWindowFocusListener?.()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [navigate, waitForWindowFocusBeforeAutoNavigate])

  return (
    <Group
      mt="xs"
      gap="sm"
      align="center"
      wrap="nowrap"
      style={{
        ...guideActionButtonWidthStyle,
        maxWidth: 520,
      }}
    >
      <Box
        component="img"
        src={guideRedirectLoadingGif}
        alt=""
        aria-hidden="true"
        style={{
          width: 72,
          height: 72,
          objectFit: 'contain',
          flex: '0 0 auto',
        }}
      />
      <Stack gap={2} flex={1}>
        <Text
          fw={700}
          c="chatbox-brand"
          style={{
            fontSize: 16,
            lineHeight: 1.25,
          }}
        >
          {t('Opening a new chat...')}
        </Text>
        <Text
          c="chatbox-brand"
          style={{
            fontSize: 14,
            lineHeight: 1.35,
          }}
        >
          {t('Sit back, relax. Chatbox will start a new chat in {{count}}s...', { count: remainingSeconds })}
        </Text>
      </Stack>
    </Group>
  )
}

/**
 * 提示 block，用于用户误将引导助手当作普通对话时的引导提醒
 * 对应 tool: show_new_chat_tip（后端 AI 判断用户偏离话题时返回）
 */
export function NewChatTip() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <Box
      mt="md"
      p="md"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--mantine-color-yellow-light)',
        border: '1px solid var(--mantine-color-yellow-light-color)',
      }}
    >
      <Flex align="center" gap="xs" mb={4}>
        <IconInfoCircle size={18} style={{ color: 'var(--mantine-color-yellow-8)', flexShrink: 0 }} />
        <Text size="sm" fw={600} style={{ color: 'var(--mantine-color-yellow-8)' }}>
          {t('This is the onboarding assistant')}
        </Text>
      </Flex>
      <Flex align="center" gap={6} wrap="wrap">
        <Text size="sm" c="dimmed">
          {t('For general conversations, please click')}
        </Text>
        <Button variant="light" size="compact-sm" onClick={() => navigate({ to: '/' })}>
          <ScalableIcon icon={IconCirclePlus} className="mr-1" />
          {t('New Chat')}
        </Button>
        <Text size="sm" c="dimmed">
          {t('on the side bar to start a new conversation.')}
        </Text>
      </Flex>
    </Box>
  )
}

export function ViewLicenseButton() {
  const { t } = useTranslation()

  return (
    <Flex mt="xs" style={guideActionButtonWidthStyle}>
      <Button variant="light" fullWidth h={42} onClick={() => navigateToSettings('chatbox-ai')}>
        <ScalableIcon icon={IconId} className="mr-2" />
        {t('View License Details')}
      </Button>
    </Flex>
  )
}

interface FreeTrialLinkProps {
  /** Optional hook that fires after the link successfully opens — used by the guide flow to start polling. */
  onAfterClick?: () => void
}

export function FreeTrialLink({ onAfterClick }: FreeTrialLinkProps = {}) {
  const { t } = useTranslation()
  const language = settingsStore.getState().language || 'en'
  const [pendingExternalAction, setPendingExternalAction] = useState(false)
  const pendingExternalActionRef = useRef(false)

  const handleClaimFreePlan = useCallback(async () => {
    if (pendingExternalActionRef.current) return

    pendingExternalActionRef.current = true
    setPendingExternalAction(true)
    trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
      pageName: JK_PAGE_NAMES.HELP_PAGE,
      content: 'onboarding_guide',
    })
    try {
      await openLinkWithAuth(
        buildChatboxUrl(
          `/redirect_app/claim_free_plan/${language}/?utm_source=app&utm_content=guide_session_free_trial`
        )
      )
      onAfterClick?.()
    } finally {
      pendingExternalActionRef.current = false
      setPendingExternalAction(false)
    }
  }, [language, onAfterClick])

  return (
    <Flex mt="md">
      <Button
        leftSection={<ScalableIcon icon={IconExternalLink} size={18} />}
        onClick={() => void handleClaimFreePlan()}
        variant="light"
        style={guideActionButtonWidthStyle}
        h={42}
        loading={pendingExternalAction}
        disabled={pendingExternalAction}
      >
        {t('Claim Free Plan')}
      </Button>
    </Flex>
  )
}
