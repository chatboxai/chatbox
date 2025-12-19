import { Button, Modal, Radio, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserLicense } from '@/packages/remote'

interface LicenseSelectionModalProps {
  opened: boolean
  licenses: UserLicense[]
  onConfirm: (selectedKey: string) => void
  onCancel?: () => void
}

export function LicenseSelectionModal({ opened, licenses, onConfirm, onCancel }: LicenseSelectionModalProps) {
  const { t } = useTranslation()
  const [selectedKey, setSelectedKey] = useState(licenses[0]?.key || '')

  const handleClose = () => {
    // 目前无法阻止ESC关闭，fallback到第一个
    onCancel?.()
  }

  // 格式化数字为 K/M 格式
  const formatTokens = (num: number): string => {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`
    }
    return num.toString()
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      title={t('Select License')}
      centered
      size="md"
    >
      <Stack gap="md">
        <Text size="sm" c="chatbox-secondary">
          {t('You have multiple licenses. Please select one to use:')}
        </Text>

        <Radio.Group value={selectedKey} onChange={setSelectedKey}>
          <Stack gap="xs" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {licenses.map((license) => {
              const remaining = license.unified_token_limit - license.unified_token_usage
              const expiryDate = license.expires_at ? new Date(license.expires_at).toLocaleDateString() : null
              const isExpired = license.expires_at ? new Date(license.expires_at) < new Date() : false

              return (
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
                      {isExpired ? (
                        <Text size="xs" c="chatbox-tertiary">
                          {t('Total Quota')}: {formatTokens(license.unified_token_limit)}
                        </Text>
                      ) : (
                        <Text size="xs" c="chatbox-tertiary">
                          {t('Remaining/Total Quota')}: {formatTokens(remaining)}/
                          {formatTokens(license.unified_token_limit)}
                        </Text>
                      )}
                      {expiryDate && (
                        <Text size="xs" c="chatbox-tertiary">
                          {t('Expires')}: {expiryDate}
                          {isExpired && ` (${t('Expired')})`}
                        </Text>
                      )}
                    </Stack>
                  }
                />
              )
            })}
          </Stack>
        </Radio.Group>

        <Button fullWidth onClick={() => onConfirm(selectedKey)} disabled={!selectedKey}>
          {t('Confirm')}
        </Button>
      </Stack>
    </Modal>
  )
}
