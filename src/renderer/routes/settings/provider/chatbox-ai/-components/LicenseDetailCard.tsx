import { Alert, Box, Flex, Group, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core'
import type { ChatboxAILicenseDetail } from '@shared/types'
import { IconAlertTriangle, IconArrowRight } from '@tabler/icons-react'
import clsx from 'clsx'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { openLinkWithAuth } from '@/packages/openLinkWithAuth'
import { buildChatboxUrl } from '@/packages/remote'
import { formatNumber } from '@/utils/format'

interface LicenseDetailCardProps {
  licenseDetail: ChatboxAILicenseDetail
  language: string
  utmContent: string
}

function ExpansionPackIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="36" height="36" rx="4" fill="#12B886" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.5714 8.95274C17.8353 8.7944 18.165 8.7944 18.4289 8.95274L22.5956 11.4527C22.8466 11.6033 23.0002 11.8746 23.0002 12.1673V16.2788L26.7622 18.5361C27.0132 18.6867 27.1668 18.9579 27.1668 19.2507V23.834C27.1668 24.1267 27.0132 24.398 26.7622 24.5486L22.5956 27.0486C22.3317 27.2069 22.002 27.2069 21.7381 27.0486L18.0002 24.8058L14.2622 27.0486C13.9983 27.2069 13.6687 27.2069 13.4047 27.0486L9.23808 24.5486C8.98708 24.398 8.8335 24.1267 8.8335 23.834V19.2507C8.8335 18.9579 8.98708 18.6867 9.23808 18.5361L13.0002 16.2788V12.1923C13.0002 12.1881 13.0002 12.184 13.0003 12.1798C13.0002 12.1756 13.0002 12.1715 13.0002 12.1673C13.0002 11.8746 13.1537 11.6033 13.4047 11.4527L17.5714 8.95274ZM14.6668 13.6391V16.2788L17.1668 17.7788V15.1391L14.6668 13.6391ZM18.8335 15.1391V17.7788L21.3335 16.2788V13.6391L18.8335 15.1391ZM20.5471 12.1673L18.0002 13.6955L15.4532 12.1673L18.0002 10.6391L20.5471 12.1673ZM22.1668 17.7225L19.6199 19.2507L22.1668 20.7788L24.7138 19.2507L22.1668 17.7225ZM25.5002 20.7225L23.0002 22.2225V24.8622L25.5002 23.3622V20.7225ZM21.3335 24.8622V22.2225L18.8335 20.7225V23.3622L21.3335 24.8622ZM17.1668 23.3622V20.7425L14.6668 22.2575V24.8622L17.1668 23.3622ZM13.0002 24.8622V22.2225L10.5002 20.7225V23.3622L13.0002 24.8622ZM11.2865 19.2507L13.8624 20.7962L16.3967 19.2604L13.8335 17.7225L11.2865 19.2507Z"
        fill="white"
      />
    </svg>
  )
}

function RewardIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="36" height="36" rx="4" fill="#FAB005" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15.891 12.1765C15.341 11.5653 14.7699 11.3241 14.2644 11.3329L14.2498 11.3331C13.9183 11.3331 13.6004 11.4647 13.366 11.6992C13.1315 11.9336 12.9998 12.2515 12.9998 12.5831C12.9998 12.9146 13.1315 13.2325 13.366 13.4669C13.6004 13.7014 13.9183 13.8331 14.2498 13.8331C14.2527 13.8331 14.2555 13.8331 14.2583 13.8331H16.8681C16.6041 13.1569 16.2677 12.595 15.891 12.1765ZM17.1665 15.4998V17.1664H11.3332V15.4998H17.1665ZM12.9998 18.8331H17.1665V24.6664H13.8332C13.6122 24.6664 13.4002 24.5786 13.2439 24.4223C13.0876 24.2661 12.9998 24.0541 12.9998 23.8331V18.8331ZM13.8332 26.3331C13.1701 26.3331 12.5342 26.0697 12.0654 25.6009C11.5966 25.132 11.3332 24.4961 11.3332 23.8331V18.8331C10.4127 18.8331 9.6665 18.0869 9.6665 17.1664V15.4998C9.6665 14.5793 10.4127 13.8331 11.3332 13.8331H11.6146C11.431 13.4461 11.3332 13.0196 11.3332 12.5831C11.3332 11.8095 11.6405 11.0676 12.1874 10.5207C12.7327 9.97541 13.4716 9.66833 14.2425 9.6664C15.3419 9.64965 16.3438 10.1882 17.1299 11.0615C17.4579 11.426 17.7487 11.8479 17.9998 12.3135C18.251 11.8479 18.5418 11.426 18.8698 11.0615C19.6559 10.1882 20.6577 9.64965 21.7572 9.6664C22.5281 9.66833 23.267 9.97541 23.8122 10.5207C24.3592 11.0676 24.6665 11.8095 24.6665 12.5831C24.6665 13.0196 24.5686 13.4461 24.385 13.8331H24.6665C25.587 13.8331 26.3332 14.5793 26.3332 15.4998V17.1664C26.3332 18.0869 25.587 18.8331 24.6665 18.8331V23.8331C24.6665 24.4961 24.4031 25.132 23.9343 25.6009C23.4654 26.0697 22.8295 26.3331 22.1665 26.3331H13.8332ZM22.9998 18.8331V23.8331C22.9998 24.0541 22.912 24.2661 22.7558 24.4223C22.5995 24.5786 22.3875 24.6664 22.1665 24.6664H18.8332V18.8331H22.9998ZM24.6665 17.1664V15.4998H18.8332V17.1664H24.6665ZM21.7413 13.8331C21.7442 13.8331 21.747 13.8331 21.7498 13.8331C22.0814 13.8331 22.3993 13.7014 22.6337 13.4669C22.8681 13.2325 22.9998 12.9146 22.9998 12.5831C22.9998 12.2515 22.8681 11.9336 22.6337 11.6992C22.3993 11.4647 22.0814 11.3331 21.7498 11.3331L21.7353 11.3329C21.2298 11.3241 20.6587 11.5653 20.1086 12.1765C19.7319 12.595 19.3956 13.1569 19.1316 13.8331H21.7413Z"
        fill="white"
      />
    </svg>
  )
}

function MessageDotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M14.0405 4.39453H14.7072V4.39445L14.0405 4.39453ZM14.0405 9.81934L14.7072 9.8194V9.81934H14.0405ZM5.10693 12.0381V11.3714C4.95184 11.3714 4.80161 11.4255 4.68209 11.5243L5.10693 12.0381ZM2.9458 13.8252H2.27913C2.27913 14.0834 2.42825 14.3184 2.66189 14.4284C2.89552 14.5384 3.17165 14.5035 3.37065 14.339L2.9458 13.8252ZM2.9458 11.6631H3.61247C3.61247 11.4407 3.50158 11.233 3.31681 11.1092L2.9458 11.6631ZM1.95947 9.81934H1.29281V9.8194L1.95947 9.81934ZM1.95947 4.39453L1.29281 4.39445V4.39453H1.95947ZM4.17822 2.17578V1.50911H4.17814L4.17822 2.17578ZM11.8218 2.17578V2.84245C12.6789 2.84245 13.3738 3.53725 13.3739 4.39461L14.0405 4.39453L14.7072 4.39445C14.707 2.801 13.4155 1.50911 11.8218 1.50911V2.17578ZM14.0405 4.39453H13.3739V9.81934H14.0405H14.7072V4.39453H14.0405ZM14.0405 9.81934L13.3739 9.81927C13.3738 10.6766 12.679 11.3714 11.8218 11.3714V12.0381V12.7048C13.4155 12.7048 14.707 11.4129 14.7072 9.8194L14.0405 9.81934ZM11.8218 12.0381V11.3714H5.10693V12.0381V12.7048H11.8218V12.0381ZM5.10693 12.0381L4.68209 11.5243L2.52096 13.3114L2.9458 13.8252L3.37065 14.339L5.53178 12.5518L5.10693 12.0381ZM2.9458 13.8252H3.61247V11.6631H2.9458H2.27913V13.8252H2.9458ZM2.9458 11.6631L3.31681 11.1092C2.89874 10.8292 2.62619 10.3559 2.62614 9.81927L1.95947 9.81934L1.29281 9.8194C1.29291 10.8208 1.80423 11.7008 2.57479 12.217L2.9458 11.6631ZM1.95947 9.81934H2.62614V4.39453H1.95947H1.29281V9.81934H1.95947ZM1.95947 4.39453L2.62614 4.39461C2.62624 3.53742 3.32111 2.84255 4.1783 2.84245L4.17822 2.17578L4.17814 1.50911C2.5847 1.50931 1.293 2.80101 1.29281 4.39445L1.95947 4.39453ZM4.17822 2.17578V2.84245H11.8218V2.17578V1.50911H4.17822V2.17578Z"
        fill="#228BE6"
      />
      <path
        d="M6.08936 6.19922C6.55582 6.19925 6.93408 6.57747 6.93408 7.04395C6.93405 7.51039 6.5558 7.88864 6.08936 7.88867C5.62288 7.88867 5.24466 7.51041 5.24463 7.04395C5.24463 6.57745 5.62286 6.19922 6.08936 6.19922ZM9.91064 6.19922C10.3771 6.19922 10.7554 6.57745 10.7554 7.04395C10.7553 7.51041 10.3771 7.88867 9.91064 7.88867C9.44429 7.88853 9.06595 7.51032 9.06592 7.04395C9.06592 6.57754 9.44427 6.19936 9.91064 6.19922Z"
        fill="#228BE6"
      />
    </svg>
  )
}

function QuotaRingIcon({ remaining, total }: { remaining: number; total: number }) {
  const size = 44
  const strokeWidth = 8
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0
  const offset = circumference * (1 - ratio)

  return (
    <Box className="relative inline-flex items-center justify-center" w={size} h={size}>
      <svg width={size} height={size} className="absolute inset-0" style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--chatbox-background-tertiary)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#2b8ef5"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <MessageDotsIcon />
    </Box>
  )
}

interface QuotaCardProps {
  title: string
  remaining?: number
  total?: number
  helper?: string
  actionLabel?: string
  actionLoading?: boolean
  onAction?: () => void
  mutedValue?: string
  icon: ReactNode
  accent?: 'blue' | 'default'
}

function QuotaCardDes({
  title,
  remaining,
  total,
  helper,
  actionLabel,
  actionLoading,
  onAction,
  mutedValue,
  accent = 'default',
}: Omit<QuotaCardProps, 'icon'>) {
  const { t, i18n } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const isCN = i18n.language.toLowerCase().startsWith('zh')

  return (
    <Stack gap={4}>
      <Text c="chatbox-secondary" style={isSmallScreen ? { whiteSpace: 'pre-line' } : undefined}>
        {title}
      </Text>

      {typeof remaining === 'number' && typeof total === 'number' ? (
        <Flex align="center" gap={6} wrap="nowrap">
          <Text fw={700} fz="1.3rem" lh={1.05} c={accent === 'blue' ? 'chatbox-brand' : 'chatbox-primary'}>
            {formatNumber(remaining, remaining === 0 ? 0 : 2, isCN)}
          </Text>
          <Text c="dimmed" fz="1.1rem" pb={3}>
            /{formatNumber(total, 2, isCN)}
          </Text>
        </Flex>
      ) : (
        <Text fw={600} fz="1.15rem" c="dimmed">
          {mutedValue}
        </Text>
      )}

      {helper && (
        <Text size="sm" c="dimmed">
          {helper}
        </Text>
      )}

      {actionLabel && onAction && (
        <UnstyledButton
          onClick={onAction}
          className="w-fit text-chatbox-tint-brand"
          style={{ opacity: actionLoading ? 0.6 : 1 }}
        >
          <Flex gap={2} align="center">
            <Text span c="chatbox-brand" fw={500}>
              {actionLoading ? t('Loading...') : actionLabel}
            </Text>
            <ScalableIcon icon={IconArrowRight} size={15} />
          </Flex>
        </UnstyledButton>
      )}
    </Stack>
  )
}

function QuotaCard({ icon, ...rest }: QuotaCardProps) {
  const isSmallScreen = useIsSmallScreen()

  return (
    <div
      className="h-full rounded-lg p-lg"
      style={{
        backgroundColor:
          'color-mix(in srgb, var(--chatbox-background-secondary) 68%, var(--chatbox-background-primary))',
      }}
    >
      {isSmallScreen ? (
        <Group gap="md" h="100%" justify="flex-start">
          <Box className="self-start">{icon}</Box>
          <QuotaCardDes {...rest} />
        </Group>
      ) : (
        <Stack gap="sm" h="100%" justify="flex-start">
          {icon}
          <QuotaCardDes {...rest} />
        </Stack>
      )}
    </div>
  )
}

interface InfoPanelProps {
  title: string
  value: string
  valueColor?: string
}

function InfoPanel({ title, value, valueColor }: InfoPanelProps) {
  return (
    <div
      className="rounded-lg p-lg"
      style={{
        backgroundColor:
          'color-mix(in srgb, var(--chatbox-background-secondary) 68%, var(--chatbox-background-primary))',
      }}
    >
      <Stack gap={6}>
        <Text c="chatbox-secondary">{title}</Text>
        <Text fw={700} fz="1.05rem" c={valueColor}>
          {value}
        </Text>
      </Stack>
    </div>
  )
}

export function LicenseDetailCard({ licenseDetail, language, utmContent }: LicenseDetailCardProps) {
  const { t, i18n } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const isCN = i18n.language.toLowerCase().startsWith('zh')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const pendingActionRef = useRef(false)

  const planDetail = licenseDetail.unified_token_usage_details?.find((detail) => detail.type === 'plan')
  const rewardDetail = licenseDetail.aggregated_reward_details
  const isExpired = licenseDetail.token_expire_time ? new Date(licenseDetail.token_expire_time) < new Date() : false

  const imageRemaining = Math.max(licenseDetail.image_total_quota - licenseDetail.image_used_count, 0)
  const expansionRemaining = Math.max(
    (licenseDetail.expansion_pack_limit || 0) - (licenseDetail.expansion_pack_usage || 0),
    0
  )

  const rewardRemaining = rewardDetail
    ? Math.max((rewardDetail.token_limit || 0) - (rewardDetail.token_usage || 0), 0)
    : 0

  const handleOpenAuthLink = useCallback(async (action: string, url: string) => {
    if (pendingActionRef.current) return

    pendingActionRef.current = true
    setPendingAction(action)
    try {
      await openLinkWithAuth(url)
    } finally {
      pendingActionRef.current = false
      setPendingAction(null)
    }
  }, [])

  const expiryText = licenseDetail.token_expire_time
    ? `${new Date(licenseDetail.token_expire_time).toLocaleDateString(i18n.language)}${isExpired ? ` (${t('Expired')})` : ''}`
    : '-'

  const refreshText = licenseDetail.token_next_refresh_time
    ? `${t('Quota Reset Time')} ${new Date(licenseDetail.token_next_refresh_time).toLocaleString(i18n.language, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : undefined

  return (
    <Stack gap="lg">
      {isExpired && (
        <Alert variant="light" color="orange" p="sm">
          <Flex gap="xs" align="center" c="chatbox-primary">
            <ScalableIcon icon={IconAlertTriangle} className="flex-shrink-0" />
            <Text>{t('Your license has expired. You can continue using your expansion pack.')}</Text>
            <UnstyledButton
              onClick={() =>
                void handleOpenAuthLink(
                  'renew-license',
                  buildChatboxUrl(
                    `/redirect_app/manage_license/${language}/?utm_source=app&utm_content=${utmContent}_expired`
                  )
                )
              }
              disabled={pendingAction !== null}
              className="ml-auto flex flex-row items-center gap-xxs"
              style={{ opacity: pendingAction === 'renew-license' ? 0.6 : 1 }}
            >
              <Text span fw={600} className="whitespace-nowrap">
                {pendingAction === 'renew-license' ? t('Loading...') : t('Renew License')}
              </Text>
              <ScalableIcon icon={IconArrowRight} />
            </UnstyledButton>
          </Flex>
        </Alert>
      )}

      <Text fw={700} fz="1.05rem">
        {t('Quota Details')}
      </Text>

      <div className={clsx('grid gap-md md:grid-cols-3')}>
        {planDetail && planDetail.token_limit > 0 && (
          <QuotaCard
            title={`${licenseDetail.name}${t('Quota')}\n${t('(Remaining/Total)')}`}
            remaining={Math.max(planDetail.token_limit - planDetail.token_usage, 0)}
            total={planDetail.token_limit}
            helper={refreshText}
            actionLabel={t('View Details') as string}
            actionLoading={pendingAction === 'view-plan-details'}
            onAction={() =>
              void handleOpenAuthLink(
                'view-plan-details',
                buildChatboxUrl(
                  `/redirect_app/manage_license/${language}/?utm_source=app&utm_content=${utmContent}_plan`
                )
              )
            }
            accent="blue"
            icon={
              <QuotaRingIcon
                remaining={Math.max(planDetail.token_limit - planDetail.token_usage, 0)}
                total={planDetail.token_limit}
              />
            }
          />
        )}

        <QuotaCard
          title={`${t('Expansion Pack Quota')}\n${t('(Remaining/Total)')}`}
          remaining={licenseDetail.expansion_pack_limit > 0 ? expansionRemaining : undefined}
          total={licenseDetail.expansion_pack_limit > 0 ? licenseDetail.expansion_pack_limit : undefined}
          mutedValue={licenseDetail.expansion_pack_limit > 0 ? undefined : (t('No Expansion Pack') as string)}
          actionLabel={(licenseDetail.expansion_pack_limit > 0 ? t('View Details') : t('Buy')) as string}
          actionLoading={pendingAction === 'view-expansion-pack'}
          onAction={() =>
            void handleOpenAuthLink(
              'view-expansion-pack',
              buildChatboxUrl(
                licenseDetail.expansion_pack_limit > 0
                  ? `/redirect_app/manage_license/${language}/?utm_source=app&utm_content=${utmContent}_expansion`
                  : `/redirect_app/view_more_plans/${language}/?utm_source=app&utm_content=${utmContent}_expansion`
              )
            )
          }
          icon={<ExpansionPackIcon />}
        />

        <QuotaCard
          title={`${t('Reward Quota')}\n${t('(Remaining/Total)')}`}
          remaining={rewardDetail && rewardDetail.token_limit > 0 ? rewardRemaining : undefined}
          total={rewardDetail && rewardDetail.token_limit > 0 ? rewardDetail.token_limit : undefined}
          mutedValue={rewardDetail && rewardDetail.token_limit > 0 ? undefined : (t('No rewards yet') as string)}
          actionLabel={t('View Details') as string}
          actionLoading={pendingAction === 'view-reward-details'}
          onAction={() =>
            void handleOpenAuthLink(
              'view-reward-details',
              buildChatboxUrl('/redirect_app/reward?utm_source=app&utm_content=provider_cb_login_bonus_details')
            )
          }
          icon={<RewardIcon />}
        />
      </div>

      <Text size="sm" c="dimmed">
        {'*'}
        {t('Bonus points are used first, then plan quota, and expansion packs are used last.')}
      </Text>

      <SimpleGrid cols={isSmallScreen ? 2 : { base: 1, sm: 2 }} spacing="md">
        <InfoPanel title={t('License Plan Overview')} value={licenseDetail.name} />
        <InfoPanel
          title={t('Image Quota (Remaining/Total)')}
          value={`${formatNumber(imageRemaining, 0, isCN)}/${formatNumber(licenseDetail.plan_image_limit || 0, 0, isCN)}`}
        />
      </SimpleGrid>

      <InfoPanel title={t('License Expiry')} value={expiryText} valueColor={isExpired ? 'red' : undefined} />
    </Stack>
  )
}
