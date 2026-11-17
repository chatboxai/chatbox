import { Badge, Flex, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { UserLicense } from '@/packages/remote'
import { formatNumber } from '@/utils/format'
import { type AccountLicenseStatus, type AccountLicenseStatusKind, maskLicenseKey } from './licenseStatus'

const BADGE_COLORS: Record<AccountLicenseStatusKind, string> = {
  valid: 'chatbox-success',
  expiring_soon: 'chatbox-warning',
  quota_exhausted: 'chatbox-warning',
  refunding: 'chatbox-warning',
  expired: 'chatbox-gray',
  disabled: 'chatbox-error',
  refunded: 'chatbox-error',
  unavailable: 'chatbox-gray',
}

export function LicenseStatusBadge({ status }: { status: AccountLicenseStatus }) {
  const { t } = useTranslation()
  const labels: Record<AccountLicenseStatusKind, string> = {
    valid: t('Valid'),
    expiring_soon: t('Expires in {{count}} day(s)', { count: status.daysUntilExpiry ?? 0 }),
    quota_exhausted: t('Quota used up'),
    refunding: t('Refund in progress'),
    expired: t('Expired'),
    disabled: t('Disabled'),
    refunded: t('Refunded'),
    unavailable: t('Unavailable'),
  }

  return (
    <Badge
      size="sm"
      variant="light"
      color={BADGE_COLORS[status.kind]}
      className="shrink-0 normal-case"
      data-license-status={status.kind}
    >
      {labels[status.kind]}
    </Badge>
  )
}

interface LicenseOptionContentProps {
  license: UserLicense
  status: AccountLicenseStatus
}

export function LicenseOptionContent({ license, status }: LicenseOptionContentProps) {
  const { t, i18n } = useTranslation()
  const isCN = i18n.language.toLowerCase().startsWith('zh')
  const expiryDate = status.expiryDate ? new Date(status.expiryDate).toLocaleDateString(i18n.language) : null

  const formatQuota = (value: number) => formatNumber(value, 1, isCN).replace(/\.0(?=\D*$)/, '')

  const planUnavailable = ['expired', 'disabled', 'refunded', 'unavailable'].includes(status.kind)
  const details: string[] = []
  if (!expiryDate) {
    details.push(t('No expiration'))
  } else if (status.kind === 'expired') {
    details.push(t('Expired on {{date}}', { date: expiryDate }))
  } else if (status.usable && !planUnavailable) {
    details.push(t('Valid until {{date}}', { date: expiryDate }))
  }
  if (status.usable && !planUnavailable && status.quotaLimit > 0) {
    details.push(
      t('Quota left {{remaining}}/{{total}}', {
        remaining: formatQuota(status.quotaRemaining),
        total: formatQuota(status.quotaLimit),
      })
    )
  }
  if (status.expansionPackRemaining > 0) {
    details.push(t('Expansion pack left {{remaining}}', { remaining: formatQuota(status.expansionPackRemaining) }))
  }
  if (status.usable && license.recurring_canceled) {
    details.push(t('Auto-renewal off'))
  }

  return (
    <Stack gap={4} flex={1} miw={0}>
      <Flex align="center" justify="space-between" gap="xs">
        <Text size="sm" fw={600} truncate c={status.usable ? 'chatbox-primary' : 'chatbox-tertiary'}>
          {license.product_name}
        </Text>
        <LicenseStatusBadge status={status} />
      </Flex>
      <Text size="xs" c="chatbox-tertiary">
        <Text span inherit className="font-mono whitespace-nowrap">
          {maskLicenseKey(license.key)}
        </Text>
        {details.map((detail) => (
          <Text span inherit key={detail}>
            {' · '}
            <span className="whitespace-nowrap">{detail}</span>
          </Text>
        ))}
      </Text>
    </Stack>
  )
}

const DOT_COLORS: Record<AccountLicenseStatusKind, string> = {
  valid: 'var(--chatbox-tint-success)',
  expiring_soon: 'var(--chatbox-tint-warning)',
  quota_exhausted: 'var(--chatbox-tint-warning)',
  refunding: 'var(--chatbox-tint-warning)',
  expired: 'var(--chatbox-tint-gray)',
  disabled: 'var(--chatbox-tint-error)',
  refunded: 'var(--chatbox-tint-error)',
  unavailable: 'var(--chatbox-tint-gray)',
}

export function LicenseStatusDot({ status }: { status: AccountLicenseStatus }) {
  return (
    <span
      className="block h-2 w-2 rounded-full"
      style={{ backgroundColor: DOT_COLORS[status.kind] }}
      data-license-status={status.kind}
    />
  )
}
