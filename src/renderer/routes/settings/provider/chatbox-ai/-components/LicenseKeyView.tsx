import { Alert, Button, Flex, Paper, PasswordInput, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCircleCheckFilled,
  IconExclamationCircle,
  IconExternalLink,
  IconHelp,
} from '@tabler/icons-react'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { trackingEvent } from '@/packages/event'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import { LicenseDetailCard } from './LicenseDetailCard'
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
    licenseDetailError,
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
              href={buildChatboxUrl(
                `/redirect_app/how_to_use_license/${language}?utm_source=app&utm_content=provider_cb_key_howtouse`
              )}
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
            href={buildChatboxUrl(
              `/redirect_app/how_to_use_license/${language}?utm_source=app&utm_content=provider_cb_key_howtouse`
            )}
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
          {activated && (
            <Flex gap="xs" align="center">
              <Text c="chatbox-success">{t('License Activated')}</Text>
              {licenseDetail?.token_expire_time && new Date(licenseDetail.token_expire_time) < new Date() && (
                <Text c="orange" size="sm">
                  ({t('Expired')})
                </Text>
              )}
            </Flex>
          )}
        </Stack>

        {(activateError || licenseDetailError) && (
          <Alert variant="light" color="red" p="sm">
            {(() => {
              const errorCode = licenseDetailError?.code || activateError
              const isLicenseNotFound = ['not_found', 'license_not_found'].includes(errorCode || '')
              return (
                <Flex gap="xs" align="center" c={isLicenseNotFound ? 'chatbox-error' : 'chatbox-primary'}>
                  <ScalableIcon icon={IconExclamationCircle} className="flex-shrink-0" />
                  <Text c={isLicenseNotFound ? 'chatbox-error' : undefined}>
                    {(() => {
                      switch (errorCode) {
                        case 'not_found':
                        case 'license_not_found':
                          return t('License not found, please check your license key')
                        case 'expired':
                        case 'expired_license':
                          return t('License expired, please check your license key')
                        case 'reached_activation_limit':
                          return t('This license key has reached the activation limit.')
                        case 'quota_exceeded':
                        case 'token_quota_exhausted':
                          return t('You have no more Chatbox AI quota left this month.')
                        default:
                          return t('Failed to activate license, please check your license key and network connection')
                      }
                    })()}
                  </Text>

                  <a
                    href={buildChatboxUrl(
                      `/redirect_app/manage_license/${language}?utm_source=app&utm_content=provider_cb_key_activate_error`
                    )}
                    target="_blank"
                    className={`ml-auto flex flex-row items-center gap-xxs${isLicenseNotFound ? ' text-chatbox-tint-error underline decoration-chatbox-tint-error' : ''}`}
                  >
                    <Text
                      span
                      fw={600}
                      className="whitespace-nowrap"
                      c={isLicenseNotFound ? 'chatbox-error' : undefined}
                    >
                      {t('Manage License')}
                    </Text>
                    <ScalableIcon
                      icon={IconArrowRight}
                      color={isLicenseNotFound ? 'var(--chatbox-tint-error)' : undefined}
                    />
                  </a>
                </Flex>
              )
            })()}
          </Alert>
        )}

        {activated && licenseDetail ? (
          <>
            <Paper shadow="xs" p="sm" withBorder>
              <LicenseDetailCard
                licenseDetail={licenseDetail}
                language={language}
                utmContent="provider_cb_key_quota_details"
              />
            </Paper>

            {licenseDetail.remaining_quota_unified <= 0 &&
              (licenseDetail.expansion_pack_limit || 0) - (licenseDetail.expansion_pack_usage || 0) <= 0 && (
                <Alert variant="light" color="yellow" p="sm">
                  <Flex gap="xs" align="center" c="chatbox-primary">
                    <ScalableIcon icon={IconExclamationCircle} className="flex-shrink-0" />
                    <Text>{t('You have no more Chatbox AI quota left this month.')}</Text>

                    <a
                      href={buildChatboxUrl(
                        `/redirect_app/manage_license/${language}/${memorizedManualLicenseKey}?utm_source=app&utm_content=provider_cb_key_no_quota`
                      )}
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
                  platform.openLink(
                    buildChatboxUrl(
                      `/redirect_app/manage_license/${language}?utm_source=app&utm_content=provider_cb_key_manage_license`
                    )
                  )
                  trackingEvent('click_manage_license_button', { event_category: 'user' })
                }}
              >
                {t('Manage License and Devices')}
              </Button>
              <Button
                variant="outline"
                flex={1}
                onClick={() => {
                  platform.openLink(
                    buildChatboxUrl(
                      `/redirect_app/view_more_plans/${language}?utm_source=app&utm_content=provider_cb_key_more_plans`
                    )
                  )
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
                  platform.openLink(
                    buildChatboxUrl(
                      `/redirect_app/get_license/${language}?utm_source=app&utm_content=provider_cb_key_get_license`
                    )
                  )
                  trackingEvent('click_get_license_button', { event_category: 'user' })
                }}
              >
                {t('Get License')}
              </Button>
              <Button
                variant="outline"
                flex={1}
                onClick={() => {
                  platform.openLink(
                    buildChatboxUrl(
                      `/redirect_app/manage_license/${language}?utm_source=app&utm_content=provider_cb_key_retrieve`
                    )
                  )
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
