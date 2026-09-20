import { Alert, Button, Flex, Paper, Select, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import {
  accountLicenseFromApi,
  getAccountLicenseStatus as getSharedLicenseStatus,
  isAccountLicenseOptionDisabled,
  selectAccountLicense,
  selectAccountLicenseForInspection,
} from '@shared/utils/account-license'
import { IconArrowRight, IconCheck, IconExclamationCircle, IconExternalLink, IconLogout } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useRefreshChatboxAIModelsOnLicenseChange } from '@/hooks/useChatboxAIModels'
import { trackingEvent } from '@/packages/event'
import { openLinkWithAuth } from '@/packages/openLinkWithAuth'
import {
  buildChatboxUrl,
  getLicenseDetailForInspection,
  type getLicenseDetailRealtime,
  getUserProfile,
  type LicenseDetailError,
  listLicensesByUser,
  type UserLicense,
} from '@/packages/remote'
import platform from '@/platform'
import { isChatboxAIPlanFree } from '@/stores/licensePlan'
import * as premiumActions from '@/stores/premiumActions'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { LicenseDetailCard } from './LicenseDetailCard'
import { LicenseOptionContent, LicenseStatusDot } from './LicenseOptionContent'
import { getAccountLicenseStatus, maskLicenseKey, sortAccountLicensesByStatus } from './licenseStatus'
import type { UserProfile } from './types'

interface LicenseDetailQueryError {
  data?: {
    error?: LicenseDetailError
  }
  error?: LicenseDetailError
}

interface LoggedInViewProps {
  afterLogin?: boolean
  onLoginSelectionHandled?: () => void
  onLogout: () => void
  onSwitchToLicenseKey: () => void
  language: string
  initialAccountData?: {
    userProfile: UserProfile
    licenses: UserLicense[]
    licenseDetailResponse?: Awaited<ReturnType<typeof getLicenseDetailRealtime>>
  }
  onShowLicenseSelectionModal?: (params: {
    licenses: UserLicense[]
    onConfirm: (licenseKey: string) => void
    onCancel: () => void
  }) => void
}

export const LoggedInView = forwardRef<HTMLDivElement, LoggedInViewProps>(
  (
    {
      onLogout,
      language,
      initialAccountData,
      onShowLicenseSelectionModal,
      onSwitchToLicenseKey,
      afterLogin = false,
      onLoginSelectionHandled,
    },
    ref
  ) => {
    const { t } = useTranslation()
    const licenseKey = useSettingsStore((state) => state.licenseKey)
    const licenseActivationMethod = useSettingsStore((state) => state.licenseActivationMethod)
    const licenseInstances = useSettingsStore((state) => state.licenseInstances)
    const lastSelectedLicenseByUser = useSettingsStore((state) => state.lastSelectedLicenseByUser)
    const [selectedLicenseKey, setSelectedLicenseKey] = useState<string | null>(null)
    const [displayLicenseKey, setDisplayLicenseKey] = useState<string | null>(null) // 用于显示在Select中的key，即使激活失败也保留
    const [activationError, setActivationError] = useState<string | null>(null)
    const [switchingLicense, setSwitchingLicense] = useState(false)
    const [pendingExternalAction, setPendingExternalAction] = useState<
      'manage-license' | 'get-more' | 'claim-free-plan' | 'view-more-plans' | 'view-bonus-details' | null
    >(null)
    const pendingExternalActionRef = useRef(false)

    // 使用TanStack Query获取数据，不持久化
    const { data: userProfile, error: profileError } = useQuery({
      queryKey: ['userProfile'],
      queryFn: initialAccountData ? () => Promise.resolve(initialAccountData.userProfile) : getUserProfile,
      staleTime: 0, // 数据立即过期，总是刷新
      gcTime: 24 * 60 * 60 * 1000, // 缓存保留24小时
      refetchOnWindowFocus: true,
      placeholderData: (previousData) => previousData, // 使用之前的数据作为占位符
      enabled: !initialAccountData,
      initialData: initialAccountData?.userProfile,
    })

    const { data: licenses = [], error: licensesError } = useQuery({
      queryKey: ['userLicenses'],
      queryFn: initialAccountData ? () => Promise.resolve(initialAccountData.licenses) : listLicensesByUser,
      staleTime: 0, // 数据立即过期，总是刷新
      gcTime: 24 * 60 * 60 * 1000, // 缓存保留24小时
      refetchOnWindowFocus: true,
      placeholderData: (previousData) => previousData, // 使用之前的数据作为占位符
      enabled: !initialAccountData,
      initialData: initialAccountData?.licenses,
    })

    const {
      data: queriedLicenseDetailResponse,
      isLoading: loadingLicenseDetail,
      error: queryError,
    } = useQuery({
      queryKey: ['licenseInspection', userProfile?.email, selectedLicenseKey],
      queryFn: () => {
        if (initialAccountData?.licenseDetailResponse) {
          return initialAccountData.licenseDetailResponse
        }
        if (!selectedLicenseKey) {
          throw new Error('Missing license key')
        }
        return getLicenseDetailForInspection({ licenseKey: selectedLicenseKey })
      },
      enabled: !!selectedLicenseKey && !activationError && !initialAccountData,
      staleTime: 0, // 数据立即过期，总是刷新
      gcTime: 24 * 60 * 60 * 1000, // 缓存保留24小时
      refetchOnWindowFocus: true,
      initialData: initialAccountData?.licenseDetailResponse,
    })

    const licenseDetailResponse = initialAccountData?.licenseDetailResponse ?? queriedLicenseDetailResponse
    const licenseDetail = licenseDetailResponse?.data
    const normalizedQueryError = initialAccountData ? null : (queryError as LicenseDetailQueryError | null)
    const viewedLicense = licenses.find((item) => item.key === selectedLicenseKey)
    const inspectionOnly =
      !!viewedLicense &&
      (selectedLicenseKey !== licenseKey ||
        licenseActivationMethod !== 'login' ||
        !licenseInstances?.[selectedLicenseKey!] ||
        !getSharedLicenseStatus(accountLicenseFromApi(viewedLicense)).usable)
    const lastSelectedLicenseKey = userProfile ? lastSelectedLicenseByUser?.[userProfile.email] : undefined
    // 合并两种错误来源：1) API 返回 200 但带有 error 字段  2) API 返回 4xx/5xx 被 ofetch 抛出
    const licenseDetailError =
      licenseDetailResponse?.error || normalizedQueryError?.data?.error || normalizedQueryError?.error

    useRefreshChatboxAIModelsOnLicenseChange(selectedLicenseKey, licenseDetailError ? undefined : licenseDetail)

    const licenseOptions = useMemo(() => {
      const now = Date.now()
      return sortAccountLicensesByStatus(licenses, now).map((license) => ({
        license,
        status: getAccountLicenseStatus(license, now),
      }))
    }, [licenses])
    const displayLicenseStatus = licenseOptions.find(({ license }) => license.key === displayLicenseKey)?.status

    const handleOpenAuthLink = useCallback(
      async (
        action: 'manage-license' | 'get-more' | 'claim-free-plan' | 'view-more-plans' | 'view-bonus-details',
        url: string
      ) => {
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

    const activatingLicenseRef = useRef(false)

    useEffect(() => {
      if (!userProfile || licenses.length === 0 || activatingLicenseRef.current) return
      const selection = selectAccountLicense(
        licenses.map(accountLicenseFromApi),
        settingsStore.getState(),
        userProfile.email,
        afterLogin
      )
      if (selection.preserveManual) return
      if (afterLogin) onLoginSelectionHandled?.()
      const usableLicenses = selection.eligible.map(
        (candidate) => licenses.find((license) => license.key === candidate.key)!
      )
      const currentLicense = selection.eligible.find((license) => license.key === licenseKey)
      if (currentLicense && licenseActivationMethod === 'login' && licenseInstances?.[currentLicense.key]) {
        setSelectedLicenseKey(currentLicense.key)
        setDisplayLicenseKey(currentLicense.key)
        return
      }
      if (usableLicenses.length === 0) {
        const accountLicense = selectAccountLicenseForInspection(licenses.map(accountLicenseFromApi), [
          selectedLicenseKey,
          licenseKey,
          lastSelectedLicenseKey,
        ])
        if (accountLicense) {
          setSelectedLicenseKey(accountLicense.key)
          setDisplayLicenseKey(accountLicense.key)
        }
        return
      }

      const activate = async (key: string) => {
        activatingLicenseRef.current = true
        setSwitchingLicense(true)
        setDisplayLicenseKey(key)
        setActivationError(null)
        try {
          const result = await premiumActions.activate(key, 'login', { accountEmail: userProfile.email })
          if (!result.valid) {
            setActivationError(result.error)
            setSelectedLicenseKey(null)
          } else {
            setSelectedLicenseKey(key)
          }
        } catch (error) {
          setActivationError(error instanceof Error ? error.message : 'Failed to activate license. Please try again.')
          setSelectedLicenseKey(null)
        } finally {
          activatingLicenseRef.current = false
          setSwitchingLicense(false)
        }
      }
      const preferred = selection.preferred
      if (preferred || usableLicenses.length === 1 || !onShowLicenseSelectionModal) {
        void activate((preferred ?? usableLicenses[0]).key)
      } else {
        activatingLicenseRef.current = true
        onShowLicenseSelectionModal({
          licenses: usableLicenses,
          onConfirm: (key) => {
            void activate(key)
          },
          onCancel: () => {
            void activate(usableLicenses[0].key)
          },
        })
      }
    }, [
      afterLogin,
      onLoginSelectionHandled,
      userProfile,
      licenses,
      licenseKey,
      licenseActivationMethod,
      licenseInstances,
      lastSelectedLicenseKey,
      onShowLicenseSelectionModal,
    ])

    const handleSelectLicense = useCallback(
      async (newKey: string) => {
        if (!userProfile || switchingLicense || activatingLicenseRef.current) return

        const target = licenses.find((item) => item.key === newKey)
        if (!target) return
        if (!getSharedLicenseStatus(accountLicenseFromApi(target)).usable) {
          setSelectedLicenseKey(newKey)
          setDisplayLicenseKey(newKey)
          setActivationError(null)
          return
        }
        activatingLicenseRef.current = true
        setSwitchingLicense(true)
        setActivationError(null)
        setDisplayLicenseKey(newKey) // 先设置显示的key

        try {
          const result = await premiumActions.activate(newKey, 'login', { accountEmail: userProfile.email })
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
          activatingLicenseRef.current = false
          setSwitchingLicense(false)
        }
      },
      [userProfile, licenses, switchingLicense]
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
              <Flex align="center" justify="space-between" gap="md">
                <Stack gap="xxs" flex={1} style={{ minWidth: 0 }}>
                  <Text size="xs" c="dimmed">
                    {t('Email')}
                  </Text>
                  {userProfile ? (
                    <Text fw={600} className="truncate">
                      {userProfile.email}
                    </Text>
                  ) : (
                    <Text fw={600} c="dimmed">
                      {t('Loading...')}
                    </Text>
                  )}
                </Stack>

                <Button
                  variant="subtle"
                  size="compact-sm"
                  px="xs"
                  c="chatbox-tertiary"
                  leftSection={<ScalableIcon icon={IconLogout} size={14} />}
                  onClick={onLogout}
                  className="shrink-0"
                >
                  {t('Log out')}
                </Button>
              </Flex>

              {licenses.length > 0 && (
                <Stack gap="xxs">
                  <Text size="xs" c="dimmed">
                    {t('Selected Key')}
                  </Text>
                  <Select
                    value={displayLicenseKey}
                    onChange={(value) => value && handleSelectLicense(value)}
                    disabled={switchingLicense}
                    data={licenseOptions.map(({ license }) => ({
                      value: license.key,
                      label: `${license.product_name} · ${maskLicenseKey(license.key)}`,
                      disabled: isAccountLicenseOptionDisabled(
                        accountLicenseFromApi(license),
                        licenses.map(accountLicenseFromApi)
                      ),
                    }))}
                    placeholder={t('Select a license') as string}
                    leftSection={displayLicenseStatus ? <LicenseStatusDot status={displayLicenseStatus} /> : undefined}
                    maxDropdownHeight={360}
                    renderOption={({ option, checked }) => {
                      const item = licenseOptions.find(({ license }) => license.key === option.value)
                      if (!item) return option.label
                      return (
                        <Flex gap="xs" align="flex-start" w="100%" data-license-key={item.license.key}>
                          <LicenseOptionContent license={item.license} status={item.status} />
                          <ScalableIcon
                            icon={IconCheck}
                            size={16}
                            className={
                              checked ? 'mt-0.5 shrink-0 text-chatbox-tint-brand' : 'mt-0.5 shrink-0 invisible'
                            }
                          />
                        </Flex>
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

              {inspectionOnly && (
                <Alert variant="light" color="yellow">
                  <Text>{t('This license is not active. You can still view its details.')}</Text>
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={pendingExternalAction !== null}
                    onClick={() =>
                      void handleOpenAuthLink(
                        'manage-license',
                        buildChatboxUrl(
                          `/redirect_app/manage_license/${language}/?utm_source=app&utm_content=license_inspection`
                        )
                      )
                    }
                  >
                    {t('Manage License')}
                  </Button>
                </Alert>
              )}
              {!activationError && loadingLicenseDetail && <Text c="dimmed">{t('Loading license details...')}</Text>}

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
                        case 'quota_exceeded': {
                          const selectedLicense = licenses.find((l) => l.key === selectedLicenseKey)
                          return selectedLicense?.plan === 'free' ||
                            (!selectedLicense?.plan && selectedLicense?.product_name === 'Chatbox AI Free')
                            ? t('You have no more Chatbox AI quota left today.')
                            : t('You have no more Chatbox AI quota left this month.')
                        }
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

              {!activationError && !loadingLicenseDetail && !licenseDetailError && licenseDetail && (
                <LicenseDetailCard
                  inspectionOnly={inspectionOnly}
                  licenseDetail={licenseDetail}
                  language={language}
                  utmContent="provider_cb_login_quota_details"
                />
              )}

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
                  <Text>
                    {isChatboxAIPlanFree(licenseDetail)
                      ? t('You have no more Chatbox AI quota left today.')
                      : t('You have no more Chatbox AI quota left this month.')}
                  </Text>

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
