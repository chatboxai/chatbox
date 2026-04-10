import { Alert, Flex, Progress, Stack, Text, UnstyledButton } from '@mantine/core'
import type { ChatboxAILicenseDetail } from '@shared/types'
import { IconAlertTriangle, IconArrowRight, IconExternalLink } from '@tabler/icons-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { openLinkWithAuth } from '@/packages/openLinkWithAuth'
import { buildChatboxUrl } from '@/packages/remote'
import { formatUsage } from '@/utils/format'

interface LicenseDetailCardProps {
  licenseDetail: ChatboxAILicenseDetail
  language: string
  utmContent: string
}

export function LicenseDetailCard({ licenseDetail, language, utmContent }: LicenseDetailCardProps) {
  const { t } = useTranslation()
  const [pendingAction, setPendingAction] = useState<'renew-license' | 'view-details' | null>(null)
  const pendingActionRef = useRef(false)

  // Check if user is trial-only (plan token_limit is 0, but trial has token_limit)
  const planDetail = licenseDetail.unified_token_usage_details?.find((detail) => detail.type === 'plan')
  const trialDetail = licenseDetail.unified_token_usage_details?.find((detail) => detail.type === 'trial')
  const isTrialOnly = (planDetail?.token_limit || 0) === 0 && (trialDetail?.token_limit || 0) > 0
  const quotaLimit = isTrialOnly ? trialDetail?.token_limit || 0 : planDetail?.token_limit || 0

  const isExpired = licenseDetail.token_expire_time ? new Date(licenseDetail.token_expire_time) < new Date() : false
  const handleOpenAuthLink = useCallback(async (action: 'renew-license' | 'view-details', url: string) => {
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

  return (
    <Stack gap="lg">
      {isExpired && (
        <Alert variant="light" color="orange" p="sm">
          <Flex gap="xs" align="center" c="chatbox-primary">
            <ScalableIcon icon={IconAlertTriangle} className="flex-shrink-0" />
            <Text>{t('Your license has expired. You can continue using your quota pack.')}</Text>
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
      {/* Plan Quota */}
      <Stack gap="xxs">
        <Flex align="center" justify="space-between">
          <Text>{t('Plan Quota')}</Text>
          <Flex gap="xxs" align="center">
            <Text fw="600" size="md">
              {formatUsage(
                (licenseDetail.unified_token_limit || 0) - (licenseDetail.unified_token_usage || 0),
                quotaLimit || 0,
                2
              )}
            </Text>
            <UnstyledButton
              onClick={() =>
                void handleOpenAuthLink(
                  'view-details',
                  buildChatboxUrl(`/redirect_app/manage_license/${language}/?utm_source=app&utm_content=${utmContent}`)
                )
              }
              disabled={pendingAction !== null}
              className="whitespace-nowrap"
              style={{ opacity: pendingAction === 'view-details' ? 0.6 : 1 }}
            >
              <Text size="xs" c="chatbox-brand" fw="400" span>
                {pendingAction === 'view-details' ? t('Loading...') : t('View Details')}
                <ScalableIcon icon={IconExternalLink} size={12} />
              </Text>
            </UnstyledButton>
          </Flex>
        </Flex>
        <Progress value={licenseDetail.remaining_quota_unified * 100} />
      </Stack>

      {/* Expansion Pack Quota & Image Quota */}
      <Flex gap="lg">
        <Stack flex={1} gap="xxs">
          <Text size="xs" c="dimmed">
            {t('Expansion Pack Quota')}
          </Text>
          <Text size="md" fw="600">
            {licenseDetail.expansion_pack_limit && licenseDetail.expansion_pack_limit > 0
              ? formatUsage(
                  licenseDetail.expansion_pack_limit - (licenseDetail.expansion_pack_usage || 0),
                  licenseDetail.expansion_pack_limit,
                  2
                )
              : t('No Expansion Pack')}
          </Text>
        </Stack>
        <Stack flex={1} gap="xxs">
          <Text size="xs" c="dimmed">
            {t('Image Quota')}
          </Text>
          <Text size="md" fw="600">
            {`${licenseDetail.image_total_quota - licenseDetail.image_used_count}/${isTrialOnly ? licenseDetail.image_total_quota : licenseDetail.plan_image_limit}`}
          </Text>
        </Stack>
      </Flex>

      {/* Quota Reset & License Expiry */}
      <Flex gap="lg">
        {!isTrialOnly && (
          <Stack flex={1} gap="xxs">
            <Text size="xs" c="dimmed">
              {t('Quota Reset')}
            </Text>
            <Text size="md" fw="600">
              {new Date(licenseDetail.token_next_refresh_time!).toLocaleDateString()}
            </Text>
          </Stack>
        )}
        <Stack flex={1} gap="xxs">
          <Text size="xs" c="dimmed">
            {t('License Expiry')}
          </Text>
          <Text size="md" fw="600" c={isExpired ? 'red' : undefined}>
            {licenseDetail.token_expire_time ? new Date(licenseDetail.token_expire_time).toLocaleDateString() : ''}
            {isExpired && ` (${t('Expired')})`}
          </Text>
        </Stack>
      </Flex>

      {/* License Plan Overview */}
      <Stack flex={1} gap="xxs">
        <Text size="xs" c="dimmed">
          {t('License Plan Overview')}
        </Text>
        <Text size="md" fw="600">
          {licenseDetail.name} {isTrialOnly ? t('(Trial)') : null}
        </Text>
      </Stack>
    </Stack>
  )
}
