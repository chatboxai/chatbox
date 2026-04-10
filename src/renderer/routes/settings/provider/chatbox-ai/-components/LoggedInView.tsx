import { Alert, Button, Flex, Menu, Paper, Select, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { IconArrowRight, IconDots, IconExclamationCircle, IconExternalLink, IconLogout } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { trackingEvent } from '@/packages/event'
import { openLinkWithAuth } from '@/packages/openLinkWithAuth'
import { buildChatboxUrl, getLicenseDetailRealtime, getUserProfile, listLicensesByUser } from '@/packages/remote'
import platform from '@/platform'
import * as premiumActions from '@/stores/premiumActions'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { LicenseDetailCard } from './LicenseDetailCard'

interface LoggedInViewProps {
  onLogout: () => void
  onSwitchToLicenseKey: () => void
  language: string
  onShowLicenseSelectionModal?: (params: {
    licenses: any[]
    onConfirm: (licenseKey: string) => void
    onCancel: () => void
  }) => void
}

export const LoggedInView = forwardRef<HTMLDivElement, LoggedInViewProps>(
  ({ onLogout, language, onShowLicenseSelectionModal, onSwitchToLicenseKey }, ref) => {
    const { t } = useTranslation()
    const settings = useSettingsStore((state) => state)
    const [selectedLicenseKey, setSelectedLicenseKey] = useState<string | null>(null)
    const [displayLicenseKey, setDisplayLicenseKey] = useState<string | null>(null) // 用于显示在Select中的key，即使激活失败也保留
    const [activationError, setActivationError] = useState<string | null>(null)
    const [switchingLicense, setSwitchingLicense] = useState(false)
    const [pendingExternalAction, setPendingExternalAction] = useState<
      'manage-license' | 'get-more' | 'claim-free-plan' | 'view-more-plans' | null
    >(null)
    const pendingExternalActionRef = useRef(false)

    // 使用TanStack Query获取数据，不持久化
    const { data: userProfile, error: profileError } = useQuery({
      queryKey: ['userProfile'],
      queryFn: getUserProfile,
      staleTime: 0, // 数据立即过期，总是刷新
      gcTime: 24 * 60 * 60 * 1000, // 缓存保留24小时
      refetchOnWindowFocus: true,
      placeholderData: (previousData) => previousData, // 使用之前的数据作为占位符
    })

    const { data: licenses = [], error: licensesError } = useQuery({
      queryKey: ['userLicenses'],
      queryFn: listLicensesByUser,
      staleTime: 0, // 数据立即过期，总是刷新
      gcTime: 24 * 60 * 60 * 1000, // 缓存保留24小时
      refetchOnWindowFocus: true,
      placeholderData: (previousData) => previousData, // 使用之前的数据作为占位符
    })

    const {
      data: licenseDetailResponse,
      isLoading: loadingLicenseDetail,
      error: queryError,
    } = useQuery({
      queryKey: ['licenseDetail', selectedLicenseKey],
      queryFn: () => getLicenseDetailRealtime({ licenseKey: selectedLicenseKey! }),
      enabled: !!selectedLicenseKey && !activationError,
      staleTime: 0, // 数据立即过期，总是刷新
      gcTime: 24 * 60 * 60 * 1000, // 缓存保留24小时
      refetchOnWindowFocus: true,
      placeholderData: (previousData) => previousData, // 使用之前的数据作为占位符
    })

    const licenseDetail = licenseDetailResponse?.data
    // 合并两种错误来源：1) API 返回 200 但带有 error 字段  2) API 返回 4xx/5xx 被 ofetch 抛出
    const licenseDetailError =
      licenseDetailResponse?.error || (queryError as any)?.data?.error || (queryError as any)?.error

    const handleOpenAuthLink = useCallback(
      async (action: 'manage-license' | 'get-more' | 'claim-free-plan' | 'view-more-plans', url: string) => {
        if (pendingExternalActionRef.current) return

        pendingExternalActionRef.current = true
        setPendingExternalAction(action)
        try {
          await openLinkWithAuth(url)
        } finally {
          pendingExternalActionRef.current = false
          setPendingExternalAction(null)
        }
      },
      []
    )

    // 自动激活逻辑
    useEffect(() => {
      if (!userProfile || licenses.length === 0) return

      const needActivation =
        !settings.licenseKey ||
        settings.licenseActivationMethod !== 'login' ||
        !settings.licenseInstances?.[settings.licenseKey]

      if (needActivation) {
        // 确定要激活的license
        const lastSelected = settings.lastSelectedLicenseByUser?.[userProfile.email]
        const isLastSelectedValid = lastSelected && licenses.some((l) => l.key === lastSelected)

        if (isLastSelectedValid) {
          // 有有效的历史记录，自动激活
          setDisplayLicenseKey(lastSelected) // 先设置显示的key
          premiumActions
            .activate(lastSelected, 'login')
            .then((result) => {
              if (!result.valid) {
                setActivationError(result.error)
                setSelectedLicenseKey(null)
              } else {
                setSelectedLicenseKey(lastSelected)
              }
            })
            .catch((error) => {
              console.error('Failed to activate license:', error)
              setActivationError(error?.message || 'Failed to activate license. Please try again.')
              setSelectedLicenseKey(null)
            })
        } else if (licenses.length === 1) {
          // 只有1个license，直接激活
          const onlyLicense = licenses[0].key
          settingsStore.setState({
            lastSelectedLicenseByUser: {
              ...settings.lastSelectedLicenseByUser,
              [userProfile.email]: onlyLicense,
            },
          })
          setDisplayLicenseKey(onlyLicense) // 先设置显示的key
          premiumActions
            .activate(onlyLicense, 'login')
            .then((result) => {
              if (!result.valid) {
                setActivationError(result.error)
                setSelectedLicenseKey(null)
              } else {
                setSelectedLicenseKey(onlyLicense)
              }
            })
            .catch((error) => {
              console.error('Failed to activate license:', error)
              setActivationError(error?.message || 'Failed to activate license. Please try again.')
              setSelectedLicenseKey(null)
            })
        } else {
          // 多个licenses 且 无历史记录/历史记录无效 → 弹框让用户选择
          if (onShowLicenseSelectionModal) {
            onShowLicenseSelectionModal({
              licenses,
              onConfirm: (licenseKey: string) => {
                // 保存用户选择
                settingsStore.setState({
                  lastSelectedLicenseByUser: {
                    ...settings.lastSelectedLicenseByUser,
                    [userProfile.email]: licenseKey,
                  },
                })
                // 激活选中的license
                setDisplayLicenseKey(licenseKey) // 先设置显示的key
                premiumActions
                  .activate(licenseKey, 'login')
                  .then((result) => {
                    if (!result.valid) {
                      setActivationError(result.error)
                      setSelectedLicenseKey(null)
                    } else {
                      setSelectedLicenseKey(licenseKey)
                    }
                  })
                  .catch((error) => {
                    console.error('Failed to activate license:', error)
                    setActivationError(error?.message || 'Failed to activate license. Please try again.')
                    setSelectedLicenseKey(null)
                  })
              },
              onCancel: () => {
                // fallback到第一个
                const firstLicense = licenses[0]?.key
                if (firstLicense) {
                  settingsStore.setState({
                    lastSelectedLicenseByUser: {
                      ...settings.lastSelectedLicenseByUser,
                      [userProfile.email]: firstLicense,
                    },
                  })
                  setDisplayLicenseKey(firstLicense) // 先设置显示的key
                  premiumActions
                    .activate(firstLicense, 'login')
                    .then((result) => {
                      if (!result.valid) {
                        setActivationError(result.error)
                        setSelectedLicenseKey(null)
                      } else {
                        setSelectedLicenseKey(firstLicense)
                      }
                    })
                    .catch((error) => {
                      console.error('Failed to activate license:', error)
                      setActivationError(error?.message || 'Failed to activate license. Please try again.')
                      setSelectedLicenseKey(null)
                    })
                }
              },
            })
          } else {
            // fallback：如果没有传入modal回调，直接使用第一个
            const firstLicense = licenses[0]?.key
            if (firstLicense) {
              settingsStore.setState({
                lastSelectedLicenseByUser: {
                  ...settings.lastSelectedLicenseByUser,
                  [userProfile.email]: firstLicense,
                },
              })
              setDisplayLicenseKey(firstLicense) // 先设置显示的key
              premiumActions
                .activate(firstLicense, 'login')
                .then((result) => {
                  if (!result.valid) {
                    setActivationError(result.error)
                    setSelectedLicenseKey(null)
                  } else {
                    setSelectedLicenseKey(firstLicense)
                  }
                })
                .catch((error) => {
                  console.error('Failed to activate license:', error)
                  setActivationError(error?.message || 'Failed to activate license. Please try again.')
                  setSelectedLicenseKey(null)
                })
            }
          }
        }
      } else {
        // 已激活直接显示。如用户在 loggedinview 和 licenseview 切换
        setSelectedLicenseKey(settings.licenseKey || null)
        setDisplayLicenseKey(settings.licenseKey || null)
      }
    }, [
      userProfile,
      licenses,
      settings.licenseKey,
      settings.licenseActivationMethod,
      settings.licenseInstances,
      onShowLicenseSelectionModal,
    ])

    const handleSelectLicense = useCallback(
      async (newKey: string) => {
        if (!userProfile || switchingLicense) return

        setSwitchingLicense(true)
        setActivationError(null)
        setDisplayLicenseKey(newKey) // 先设置显示的key

        try {
          settingsStore.setState({
            lastSelectedLicenseByUser: {
              ...settings.lastSelectedLicenseByUser,
              [userProfile.email]: newKey,
            },
          })

          const result = await premiumActions.activate(newKey, 'login')
          if (!result.valid) {
            setActivationError(result.error)
            setSelectedLicenseKey(null)
          } else {
            setSelectedLicenseKey(newKey)
          }
        } catch (error: unknown) {
          console.error('Failed to switch license:', error)
          const errorMsg = error instanceof Error ? error.message : 'Failed to switch license. Please try again.'
          setActivationError(errorMsg)
          setSelectedLicenseKey(null)
        } finally {
          setSwitchingLicense(false)
        }
      },
      [userProfile, settings.lastSelectedLicenseByUser, switchingLicense]
    )

    if (profileError || licensesError) {
      return (
        <Stack gap="xl" ref={ref}>
          <Alert variant="light" color="red">
            <Stack gap="sm">
              <Text>{t('Failed to load account data. Please try again.')}</Text>
              <Button size="xs" onClick={() => window.location.reload()}>
                {t('Retry')}
              </Button>
            </Stack>
          </Alert>
        </Stack>
      )
    }

    return (
      <Stack gap="xl" ref={ref}>
        <Stack gap="md">
          <Flex gap="xs" align="center" justify="space-between">
            <Flex gap="xs" align="center">
              <Title order={3} c="chatbox-secondary">
                Chatbox AI
              </Title>
              <Button
                variant="transparent"
                c="chatbox-tertiary"
                px={0}
                h={24}
                onClick={() => platform.openLink('https://chatboxai.app')}
              >
                <ScalableIcon icon={IconExternalLink} size={24} />
              </Button>
            </Flex>
            <Flex gap="xs" align="center" justify="flex-end">
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

          <Paper shadow="xs" p="md" withBorder>
            <Stack gap="lg">
              <Flex align="center" justify="space-between">
                <Stack gap="xxs" flex={1}>
                  <Text size="xs" c="dimmed">
                    {t('Email')}
                  </Text>
                  {userProfile ? (
                    <Text fw={600}>{userProfile.email}</Text>
                  ) : (
                    <Text fw={600} c="dimmed">
                      {t('Loading...')}
                    </Text>
                  )}
                </Stack>

                <Menu position="bottom-end" shadow="md">
                  <Menu.Target>
                    <Button variant="subtle" c="chatbox-tertiary" px="xs">
                      <ScalableIcon icon={IconDots} size={20} />
                    </Button>
                  </Menu.Target>

                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<ScalableIcon icon={IconLogout} size={16} />}
                      onClick={onLogout}
                      c="chatbox-error"
                    >
                      {t('Log out')}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Flex>

              {/* License Selector */}
              {licenses.length > 0 && (
                <Stack gap="xxs">
                  <Text size="xs" c="dimmed">
                    {t('Selected Key')}
                  </Text>
                  <Select
                    value={displayLicenseKey}
                    onChange={(value) => value && handleSelectLicense(value)}
                    disabled={switchingLicense}
                    data={licenses.map((license) => ({
                      value: license.key,
                      label: `${license.key.substring(0, 10)}${'*'.repeat(10)}`,
                    }))}
                    placeholder={t('Select a license') as string}
                    renderOption={({ option }) => {
                      const license = licenses.find((l) => l.key === option.value)
                      if (!license) return option.label

                      const expiryDate = license.expires_at
                        ? new Date(license.expires_at).toLocaleDateString()
                        : t('No expiration')
                      const isExpired = license.expires_at ? new Date(license.expires_at) < new Date() : false
                      const expiryText = isExpired ? `${expiryDate} (${t('Expired')})` : expiryDate

                      return (
                        <Stack gap={2}>
                          <Text size="sm">{option.label}</Text>
                          <Text size="xs" c="dimmed">
                            {license.product_name} - {t('Expires')}: {expiryText}
                          </Text>
                        </Stack>
                      )
                    }}
                  />
                  {switchingLicense && (
                    <Text size="sm" c="dimmed">
                      {t('Switching license...')}
                    </Text>
                  )}
                </Stack>
              )}

              {/* License Detail Loading */}
              {!activationError && loadingLicenseDetail && <Text c="dimmed">{t('Loading license details...')}</Text>}

              {/* License Detail Error */}
              {!activationError && !loadingLicenseDetail && licenseDetailError && (
                <Stack gap="sm">
                  <Text fw={600} c="chatbox-error">
                    {(() => {
                      switch (licenseDetailError.code) {
                        case 'not_found':
                          return t('License not found, please check your license key')
                        case 'expired':
                        case 'expired_license':
                          return t('License expired, please check your license key')
                        case 'reached_activation_limit':
                          return t('This license key has reached the activation limit.')
                        case 'quota_exceeded':
                          return t('You have no more Chatbox AI quota left this month.')
                        default:
                          return t('Failed to load license details')
                      }
                    })()}
                  </Text>
                  <Button size="xs" variant="outline" onClick={() => window.location.reload()}>
                    {t('Retry')}
                  </Button>
                </Stack>
              )}

              {/* License Detail Content */}
              {!activationError && !loadingLicenseDetail && !licenseDetailError && licenseDetail && (
                <LicenseDetailCard
                  licenseDetail={licenseDetail}
                  language={language}
                  utmContent="provider_cb_login_quota_details"
                />
              )}

              {/* No licenses found */}
              {!loadingLicenseDetail && !licenseDetailError && !licenseDetail && licenses.length === 0 && (
                <Text c="dimmed">{t('No licenses found. Please purchase a license to continue.')}</Text>
              )}
            </Stack>
          </Paper>

          {/* Activation Error Alert - Outside Paper */}
          {activationError && (
            <Alert variant="light" color="red" p="sm">
              <Flex gap="xs" align="center" c={activationError === 'not_found' ? 'chatbox-error' : 'chatbox-primary'}>
                <ScalableIcon icon={IconExclamationCircle} className="flex-shrink-0" />
                <Text c={activationError === 'not_found' ? 'chatbox-error' : undefined}>
                  {activationError === 'not_found'
                    ? t('License not found, please check your license key')
                    : activationError === 'expired'
                      ? t('Your license has expired.')
                      : activationError === 'reached_activation_limit'
                        ? t('This license key has reached the activation limit.')
                        : t('Failed to activate license, please check your license key and network connection')}
                </Text>

                <UnstyledButton
                  onClick={() =>
                    void handleOpenAuthLink(
                      'manage-license',
                      buildChatboxUrl(
                        `/redirect_app/manage_license/${language}/?utm_source=app&utm_content=provider_cb_login_activate_error`
                      )
                    )
                  }
                  disabled={pendingExternalAction !== null}
                  className={`ml-auto flex flex-row items-center gap-xxs${activationError === 'not_found' ? ' text-chatbox-tint-error underline decoration-chatbox-tint-error' : ''}`}
                  style={{ opacity: pendingExternalAction === 'manage-license' ? 0.6 : 1 }}
                >
                  <Text
                    span
                    fw={600}
                    className="whitespace-nowrap"
                    c={activationError === 'not_found' ? 'chatbox-error' : undefined}
                  >
                    {pendingExternalAction === 'manage-license' ? t('Loading...') : t('Manage License')}
                  </Text>
                  <ScalableIcon
                    icon={IconArrowRight}
                    color={activationError === 'not_found' ? 'var(--chatbox-tint-error)' : undefined}
                  />
                </UnstyledButton>
              </Flex>
            </Alert>
          )}

          {/* Quota Warning Alert - Outside Paper */}
          {!activationError &&
            !loadingLicenseDetail &&
            !licenseDetailError &&
            licenseDetail &&
            licenseDetail.remaining_quota_unified <= 0 &&
            (licenseDetail.expansion_pack_limit || 0) - (licenseDetail.expansion_pack_usage || 0) <= 0 && (
              <Alert variant="light" color="yellow" p="sm">
                <Flex gap="xs" align="center" c="chatbox-primary">
                  <ScalableIcon icon={IconExclamationCircle} className="flex-shrink-0" />
                  <Text>{t('You have no more Chatbox AI quota left this month.')}</Text>

                  <UnstyledButton
                    onClick={() =>
                      void handleOpenAuthLink(
                        'get-more',
                        buildChatboxUrl(
                          `/redirect_app/manage_license/${language}/?utm_source=app&utm_content=provider_cb_login_no_quota`
                        )
                      )
                    }
                    disabled={pendingExternalAction !== null}
                    className="ml-auto flex flex-row items-center gap-xxs"
                    style={{ opacity: pendingExternalAction === 'get-more' ? 0.6 : 1 }}
                  >
                    <Text span fw={600} className="whitespace-nowrap">
                      {pendingExternalAction === 'get-more' ? t('Loading...') : t('get more')}
                    </Text>
                    <ScalableIcon icon={IconArrowRight} />
                  </UnstyledButton>
                </Flex>
              </Alert>
            )}

          {/* Action Buttons */}
          <Flex gap="xs" align="center">
            {licenses.length === 0 && (
              <Button
                variant="filled"
                flex={1}
                onClick={() => {
                  trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
                    pageName: JK_PAGE_NAMES.SETTING_PAGE,
                    content: 'settings_chatboxai',
                  })
                  void handleOpenAuthLink(
                    'claim-free-plan',
                    buildChatboxUrl(
                      `/redirect_app/claim_free_plan/${language}/?utm_source=app&utm_content=provider_cb_login_claim_free`
                    )
                  )
                  trackingEvent('click_claim_free_plan_button', { event_category: 'user' })
                }}
                loading={pendingExternalAction === 'claim-free-plan'}
                disabled={pendingExternalAction !== null}
              >
                {t('Claim Free Plan')}
              </Button>
            )}
            <Button
              variant="outline"
              flex={1}
              onClick={() => {
                void handleOpenAuthLink(
                  'view-more-plans',
                  buildChatboxUrl(
                    `/redirect_app/view_more_plans/${language}/?utm_source=app&utm_content=provider_cb_login_more_plans`
                  )
                )
                trackingEvent('click_view_more_plans_button', { event_category: 'user' })
              }}
              loading={pendingExternalAction === 'view-more-plans'}
              disabled={pendingExternalAction !== null}
            >
              {t('View More Plans')}
            </Button>
          </Flex>
        </Stack>
      </Stack>
    )
  }
)

LoggedInView.displayName = 'LoggedInView'
