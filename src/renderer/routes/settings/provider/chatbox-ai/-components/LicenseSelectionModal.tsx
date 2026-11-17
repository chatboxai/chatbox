import { Button, Flex, Modal, Radio, Stack, Text } from '@mantine/core'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserLicense } from '@/packages/remote'
import { LicenseOptionContent } from './LicenseOptionContent'
import { getAccountLicenseStatus, sortAccountLicensesByStatus } from './licenseStatus'

interface LicenseSelectionModalProps {
  opened: boolean
  licenses: UserLicense[]
  onConfirm: (selectedKey: string) => void
  onCancel?: () => void
}

export function LicenseSelectionModal({ opened, licenses, onConfirm, onCancel }: LicenseSelectionModalProps) {
  const { t } = useTranslation()
  const options = useMemo(() => {
    const now = Date.now()
    return sortAccountLicensesByStatus(licenses, now).map((license) => ({
      license,
      status: getAccountLicenseStatus(license, now),
    }))
  }, [licenses])
  const defaultKey = (options.find((option) => option.status.usable) ?? options[0])?.license.key ?? ''
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const selectedKey = pickedKey && options.some((option) => option.license.key === pickedKey) ? pickedKey : defaultKey

  return (
    <Modal
      opened={opened}
      onClose={() => onCancel?.()}
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

        <Radio.Group value={selectedKey} onChange={setPickedKey}>
          <Stack gap="xs" p={2} style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {options.map(({ license, status }) => {
              const checked = license.key === selectedKey
              return (
                <Radio.Card
                  key={license.key}
                  value={license.key}
                  radius="md"
                  p="sm"
                  data-license-key={license.key}
                  className="transition-colors"
                  style={{
                    borderColor: checked ? 'var(--chatbox-border-brand)' : undefined,
                    backgroundColor: checked ? 'var(--chatbox-background-brand-secondary)' : undefined,
                  }}
                >
                  <Flex gap="sm" align="flex-start">
                    <Radio.Indicator mt={2} />
                    <LicenseOptionContent license={license} status={status} />
                  </Flex>
                </Radio.Card>
              )
            })}
          </Stack>
        </Radio.Group>

        <Button fullWidth data-autofocus onClick={() => onConfirm(selectedKey)} disabled={!selectedKey}>
          {t('Confirm')}
        </Button>
      </Stack>
    </Modal>
  )
}
