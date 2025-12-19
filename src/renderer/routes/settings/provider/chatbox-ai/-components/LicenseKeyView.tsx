import { Alert, Button, Flex, Paper, PasswordInput, Progress, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCircleCheckFilled,
  IconExclamationCircle,
  IconExternalLink,
  IconHelp,
} from '@tabler/icons-react'
import { forwardRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/ScalableIcon'
import { trackingEvent } from '@/packages/event'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import { formatUsage } from '@/utils/format'
import { useLicenseActivation } from './useLicenseActivation'

interface LicenseKeyViewProps {
  language: string
  onSwitchToLogin: () => void
}

export const LicenseKeyView = forwardRef<HTMLDivElement, LicenseKeyViewProps>(({ language, onSwitchToLogin }, ref) => {
  const { t } = useTranslation()

  const settings = useSettingsStore((state) => state)

  const {
    memorizedManualLicenseKey,
    setMemorizedManualLicenseKey,
    licenseDetail,
    activated,
    activating,
    activateError,
    activate,
    deactivate,
    setIsDeactivating,
  } = useLicenseActivation({ settings })

  const handleDeactivate = async () => {
    setIsDeactivating(true)
    await deactivate()
    trackingEvent('click_deactivate_license_button', { event_category: 'user' })
    setIsDeactivating(false)
  }

  return (
    <Stack gap="xl" ref={ref}>
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
          <Flex gap="xxs" align="center" c="chatbox-brand" className="mr-4 hidden md:flex">
            <ScalableIcon icon={IconHelp} />
            <Text
              component="a"
              c="chatbox-brand"
              className="!underline"
              href={`https://chatboxai.app/redirect_app/how_to_use_license/${language}`}
              target="_blank"
            >
              {t('How to use?')}
            </Text>
          </Flex>
          <Flex gap="xs" align="center">
            <UnstyledButton onClick={onSwitchToLogin}>
              <Flex gap="xxs" align="center">
                <ScalableIcon icon={IconArrowLeft} size={16} className="!text-chatbox-tint-brand" />
                <Text span className="!text-chatbox-tint-brand">
                  {t('Back to Login')}
                </Text>
              </Flex>
            </UnstyledButton>
          </Flex>
        </Flex>
      </Flex>
      <Flex gap="xs" align="center" justify="flex-start" className="md:hidden">
        <Flex gap="xxs" align="center" c="chatbox-brand" className="mr-4">
          <ScalableIcon icon={IconHelp} />
          <Text
            component="a"
            c="chatbox-brand"
            className="!underline"
            href={`https://chatboxai.app/redirect_app/how_to_use_license/${language}`}
            target="_blank"
          >
            {t('How to use?')}
          </Text>
        </Flex>
        <Flex gap="xs" align="center" className="hidden md:flex">
          <UnstyledButton onClick={onSwitchToLogin}>
            <Flex gap="xxs" align="center">
              <ScalableIcon icon={IconArrowLeft} size={16} className="!text-chatbox-tint-brand" />
              <Text span className="!text-chatbox-tint-brand">
                {t('Back to Login')}
              </Text>
            </Flex>
          </UnstyledButton>
        </Flex>
      </Flex>

      <Stack gap="md">
        {/* Chatbox AI License */}
        <Stack gap="xxs">
          <Flex align="center" justify="space-between">
            <Text fw="600">{t('Chatbox AI License')}</Text>
          </Flex>
          <Flex gap="xs" align="center">
            <PasswordInput
              flex={1}
              value={memorizedManualLicenseKey}
              onChange={(e) => setMemorizedManualLicenseKey(e.currentTarget.value)}
              readOnly={activated}
            />

            {!activated ? (
              <Button onClick={activate} loading={activating}>
                {t('Activate License')}
              </Button>
            ) : (
              <Button color="chatbox-success" variant="subtle" onClick={handleDeactivate}>
                {t('Deactivate')}
              </Button>
            )}
          </Flex>
          {activated && <Text c="chatbox-success">{t('License Activated')}</Text>}
        </Stack>

        {activateError && (
          <Alert variant="light" color="red" p="sm">
            <Flex gap="xs" align="center" c="chatbox-primary">
              <ScalableIcon icon={IconExclamationCircle} className="flex-shrink-0" />
              <Text>
                {activateError === 'not_found'
                  ? t('License not found, please check your license key')
                  : activateError === 'expired'
                    ? t('License expired, please check your license key')
                    : activateError === 'reached_activation_limit'
                      ? t('This license key has reached the activation limit.')
                      : t('Failed to activate license, please check your license key and network connection')}
              </Text>

              <a
                href={`https://chatboxai.app/redirect_app/manage_license/${language}`}
                target="_blank"
                className="ml-auto flex flex-row items-center gap-xxs"
              >
                <Text span fw={600} className="whitespace-nowrap">
                  {t('Manage License')}
                </Text>
                <ScalableIcon icon={IconArrowRight} />
              </a>
            </Flex>
          </Alert>
        )}

        {activated && licenseDetail ? (
          <>
            <Paper shadow="xs" p="sm" withBorder>
              <Stack gap="lg">
                {/* Chatbox AI Quota & Expansion Pack Quota & Image Quota */}
                {(
                  [
                    [
                      t('Chatbox AI Quota'),
                      licenseDetail.remaining_quota_unified * 100,
                      formatUsage(
                        (licenseDetail.unified_token_limit || 0) - (licenseDetail.unified_token_usage || 0),
                        licenseDetail.unified_token_limit || 0,
                        2
                      ),
                    ],
                    ...(licenseDetail.expansion_pack_limit
                      ? [
                          [
                            t('Expansion Pack Quota'),
                            ((licenseDetail.expansion_pack_limit - (licenseDetail.expansion_pack_usage || 0)) /
                              licenseDetail.expansion_pack_limit) *
                              100,
                            formatUsage(
                              licenseDetail.expansion_pack_limit - (licenseDetail.expansion_pack_usage || 0),
                              licenseDetail.expansion_pack_limit,
                              2
                            ),
                          ],
                        ]
                      : []),
                    [
                      t('Chatbox AI Image Quota'),
                      licenseDetail.image_total_quota > 0
                        ? ((licenseDetail.image_total_quota - licenseDetail.image_used_count) /
                            licenseDetail.image_total_quota) *
                          100
                        : 0,
                      `${licenseDetail.image_total_quota - licenseDetail.image_used_count}/${
                        licenseDetail.image_total_quota
                      }`,
                    ],
                  ] as const
                ).map(([key, val, text]) => (
                  <Stack key={key} gap="xxs">
                    <Flex align="center" justify="space-between">
                      <Text>{key}</Text>
                      <Text c="chatbox-brand" fw="600">
                        {text}
                      </Text>
                    </Flex>
                    <Progress value={Number(val)} />
                  </Stack>
                ))}

                {/* Quota Reset & License Expiry */}
                <Flex gap="lg">
                  {[
                    [t('Quota Reset'), new Date(licenseDetail.token_next_refresh_time!).toLocaleDateString()],
                    [
                      t('License Expiry'),
                      licenseDetail.token_expire_time
                        ? new Date(licenseDetail.token_expire_time).toLocaleDateString()
                        : '',
                    ],
                  ].map(([key, val]) => (
                    <Stack key={key} flex={1} gap="xxs">
                      <Text>{key}</Text>
                      <Text size="md" fw="600">
                        {val}
                      </Text>
                    </Stack>
                  ))}
                </Flex>

                <Stack flex={1} gap="xxs">
                  <Text>{t('License Plan Overview')}</Text>
                  <Text size="md" fw="600">
                    {licenseDetail.name}
                  </Text>
                </Stack>
              </Stack>
            </Paper>

            {licenseDetail.remaining_quota_unified <= 0 &&
              (licenseDetail.expansion_pack_limit || 0) - (licenseDetail.expansion_pack_usage || 0) <= 0 && (
                <Alert variant="light" color="yellow" p="sm">
                  <Flex gap="xs" align="center" c="chatbox-primary">
                    <ScalableIcon icon={IconExclamationCircle} className="flex-shrink-0" />
                    <Text>{t('You have no more Chatbox AI quota left this month.')}</Text>

                    <a
                      href={`https://chatboxai.app/redirect_app/manage_license/${language}/${memorizedManualLicenseKey}`}
                      target="_blank"
                      className="ml-auto flex flex-row items-center gap-xxs"
                    >
                      <Text span fw={600} className="whitespace-nowrap">
                        {t('get more')}
                      </Text>
                      <ScalableIcon icon={IconArrowRight} />
                    </a>
                  </Flex>
                </Alert>
              )}

            <Flex gap="xs" align="center">
              <Button
                variant="outline"
                flex={1}
                onClick={() => {
                  platform.openLink(`https://chatboxai.app/redirect_app/manage_license/${language}`)
                  trackingEvent('click_manage_license_button', { event_category: 'user' })
                }}
              >
                {t('Manage License and Devices')}
              </Button>
              <Button
                variant="outline"
                flex={1}
                onClick={() => {
                  platform.openLink('https://chatboxai.app/redirect_app/view_more_plans')
                  trackingEvent('click_view_more_plans_button', { event_category: 'user' })
                }}
              >
                {t('View More Plans')}
              </Button>
            </Flex>
          </>
        ) : (
          <>
            {/* chatboxai not activated */}
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
          </>
        )}
      </Stack>
    </Stack>
  )
})

LicenseKeyView.displayName = 'LicenseKeyView'
