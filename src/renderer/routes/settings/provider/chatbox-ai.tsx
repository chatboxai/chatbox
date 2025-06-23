import { useProviderSettings, useSettings } from '@/hooks/useSettings'
import platform from '@/platform'
import { Badge, Button, Flex, Modal, Paper, PasswordInput, Progress, Stack, Text, Title, Tooltip } from '@mantine/core'
import {
  IconBulb,
  IconCircleCheckFilled,
  IconCircleMinus,
  IconCirclePlus,
  IconExternalLink,
  IconEye,
  IconRefresh,
  IconRestore,
  IconSettings,
  IconTool,
} from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { SystemProviders } from 'src/shared/defaults'
import { ModelOptionGroup, ModelProvider, ModelProviderEnum, ProviderModelInfo } from 'src/shared/types'
import * as premiumActions from '@/stores/premiumActions'
import { trackingEvent } from '@/packages/event'
import { getModelSettingUtil } from '@/packages/model-setting-utils'
import { useQuery } from '@tanstack/react-query'
import { getLicenseDetailRealtime, getModelConfigsWithCache } from '@/packages/remote'
import { useAtomValue } from 'jotai'
import { languageAtom } from '@/stores/atoms'
import useChatboxAIModels from '@/hooks/useChatboxAIModels'

const useLicenseDetail = (licenseKey: string) => {
  const { data: licenseDetail, ...others } = useQuery({
    queryKey: ['license-detail', licenseKey],
    queryFn: async () => {
      const res = await getLicenseDetailRealtime({ licenseKey })
      return res
    },
    enabled: !!licenseKey,
  })

  return {
    licenseDetail,
    ...others,
  }
}

export const Route = createFileRoute('/settings/provider/chatbox-ai')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const language = useAtomValue(languageAtom)
  const providerId: ModelProvider = ModelProviderEnum.ChatboxAI
  const baseInfo = SystemProviders.find((p) => p.id === providerId)
  const { providerSettings, setProviderSettings } = useProviderSettings(providerId)
  const { settings } = useSettings()

  // const displayModels = providerSettings?.models || baseInfo?.defaultSettings?.models || []

  const [licenseKey, setLicenseKey] = useState(settings.licenseKey || '')

  const activated = premiumActions.useAutoValidate()
  const [activating, setActivating] = useState(false)
  const [activateError, setActivateError] = useState<string>()

  const { allChatboxAIModels, chatboxAIModels, refetch: refetchChatboxAIModels } = useChatboxAIModels()

  const deleteModel = (modelId: string) => {
    setProviderSettings({
      excludedModels: [...(providerSettings?.excludedModels || []), modelId],
    })
  }

  const resetModels = () => {
    setProviderSettings({
      models: [],
      excludedModels: [],
    })
  }

  const activate = async () => {
    try {
      setActivating(true)
      setActivateError(undefined)
      const result = await premiumActions.activate(licenseKey || '')
      if (!result.valid) {
        setActivateError(result.error)
      }
    } catch (e: any) {
      setActivateError(e?.message || 'unknow error')
    } finally {
      setActivating(false)
    }
  }

  // 自动激活
  useEffect(() => {
    if (
      licenseKey &&
      licenseKey.length >= 36 &&
      !settings.licenseInstances?.[licenseKey] // 仅当 license key 还没激活
    ) {
      console.log('auto activate')
      activate()
    }
  }, [licenseKey])

  const [showFetchedModels, setShowFetchedModels] = useState(false)
  const handleFetchModels = () => {
    refetchChatboxAIModels()
    setShowFetchedModels(true)
  }

  const { licenseDetail } = useLicenseDetail(settings.licenseKey || '')

  return (
    <Stack gap="xxl">
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
          <IconExternalLink size={24} />
        </Button>
      </Flex>

      <Stack gap="xl">
        <Stack gap="md">
          {/* Chatbox AI License */}
          <Stack gap="xxs">
            <Text fw="600">{t('Chatbox AI License')}</Text>
            <Flex gap="xs" align="center">
              <PasswordInput
                flex={1}
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.currentTarget.value)}
                readOnly={activated}
              />

              {!activated ? (
                <Button onClick={activate} loading={activating}>
                  {t('Activate License')}
                </Button>
              ) : (
                <Button
                  onClick={async () => {
                    await premiumActions.deactivate()
                    setLicenseKey('')
                    trackingEvent('click_deactivate_license_button', { event_category: 'user' })
                  }}
                >
                  {t('Deactivate')}
                </Button>
              )}
            </Flex>
            {activated && <Text c="chatbox-success">{t('License Activated')}</Text>}
            {activateError && (
              <Text c="chatbox-error">
                {activateError === 'not_found' ? (
                  t('License not found, please check your license key')
                ) : activateError === 'expired' ? (
                  t('License expired, please check your license key')
                ) : activateError === 'reached_activation_limit' ? (
                  <Trans
                    i18nKey="This license key has reached the activation limit, <a>click here</a> to manage license and devices to deactivate old devices."
                    components={{
                      a: (
                        <a
                          href={`https://chatboxai.app/redirect_app/manage_license/${language}`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline !text-inherit !font-semibold"
                        />
                      ),
                    }}
                  />
                ) : (
                  <>
                    {t('Failed to activate license, please check your license key and network connection')}
                    <br />
                    Error: {activateError.slice(0, 100)}
                  </>
                )}
              </Text>
            )}
          </Stack>

          {activated && licenseDetail ? (
            <>
              <Paper shadow="xs" p="sm" withBorder>
                <Stack gap="lg">
                  {/* Chatbox AI Standard Model Quota & Chatbox AI Advanced Model Quota */}
                  {(
                    [
                      [
                        t('Chatbox AI Standard Model Quota'),
                        licenseDetail.remaining_quota_35 * 100,
                        `${(licenseDetail.remaining_quota_35 * 100).toFixed(2)}%`,
                      ],
                      [
                        t('Chatbox AI Advanced Model Quota'),
                        licenseDetail.remaining_quota_4 * 100,
                        `${(licenseDetail.remaining_quota_4 * 100).toFixed(2)}%`,
                      ],
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
                      <Progress value={val} />
                    </Stack>
                  ))}

                  {/* Quota Reset & License Expiry */}
                  <Flex gap="lg">
                    {[
                      [t('Quota Reset'), new Date(licenseDetail.token_refreshed_time).toLocaleDateString()],
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
              {/* chatboxai 未激活 */}
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
                        <IconCircleCheckFilled
                          size={16}
                          className=" flex-shrink-0 flex-grow-0 text-[var(--mantine-color-chatbox-brand-text)]"
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

        <Stack gap="xxs">
          <Flex justify="space-between" align="center">
            <Text span fw="600">
              {t('Model')}
            </Text>
            <Flex gap="sm" align="center" justify="flex-end">
              <Button
                variant="light"
                color="chatbox-gray"
                c="chatbox-secondary"
                size="compact-xs"
                px="sm"
                onClick={resetModels}
                leftSection={<IconRestore size={12} />}
              >
                {t('Reset')}
              </Button>

              <Button
                variant="light"
                color="chatbox-gray"
                c="chatbox-secondary"
                size="compact-xs"
                px="sm"
                onClick={handleFetchModels}
                leftSection={<IconRefresh size={12} />}
              >
                {t('Fetch')}
              </Button>
            </Flex>
          </Flex>

          <Stack
            gap={0}
            p="xxs"
            className="border-solid border rounded-sm min-h-[100px] border-[var(--mantine-color-chatbox-border-primary-outline)]"
          >
            {chatboxAIModels.map((model) => (
              <Flex
                key={model.modelId}
                gap="xs"
                align="center"
                p="sm"
                px="xs"
                className="border-solid border-0 border-b last:border-b-0 border-[var(--mantine-color-chatbox-border-primary-outline)]"
              >
                <Text
                  component="span"
                  size="sm"
                  flex="0 1 auto"
                  c={model.labels?.includes('recommended') ? 'chatbox-brand' : undefined}
                >
                  {model.nickname || model.modelId}
                </Text>

                {model.labels?.includes('pro') && (
                  <Badge color="chatbox-brand" size="xs" variant="light">
                    Pro
                  </Badge>
                )}

                <Flex flex="0 0 auto" gap="xs" align="center">
                  {model.capabilities?.includes('reasoning') && (
                    <Tooltip label={t('Reasoning')}>
                      <Text span c="chatbox-warning" className="flex items-center">
                        <IconBulb size={20} />
                      </Text>
                    </Tooltip>
                  )}
                  {model.capabilities?.includes('vision') && (
                    <Tooltip label={t('Vision')}>
                      <Text span c="chatbox-brand" className="flex items-center">
                        <IconEye size={20} />
                      </Text>
                    </Tooltip>
                  )}
                  {model.capabilities?.includes('tool_use') && (
                    <Tooltip label={t('Tool Use')}>
                      <Text span c="chatbox-success" className="flex items-center">
                        <IconTool size={20} />
                      </Text>
                    </Tooltip>
                  )}
                </Flex>

                <Flex flex="0 0 auto" gap="xs" align="center" className="ml-auto">
                  {/* <Button
                    variant="transparent"
                    c="chatbox-tertiary"
                    p={0}
                    h="auto"
                    size="xs"
                    bd={0}
                    onClick={() => editModel(model)}
                  >
                    <IconSettings size={20} />
                  </Button> */}

                  <Button
                    variant="transparent"
                    c="chatbox-error"
                    p={0}
                    h="auto"
                    size="compact-xs"
                    bd={0}
                    onClick={() => deleteModel(model.modelId)}
                  >
                    <IconCircleMinus size={20} />
                  </Button>
                </Flex>
              </Flex>
            ))}
          </Stack>
        </Stack>
      </Stack>

      <Modal
        keepMounted={false}
        opened={showFetchedModels}
        onClose={() => setShowFetchedModels(false)}
        title={t('Edit Model')}
        centered={true}
      >
        <Stack gap="md">
          {allChatboxAIModels?.map((model) => (
            <Flex key={model.modelId} align="center" gap="xs">
              <Text
                component="span"
                size="sm"
                flex="0 1 auto"
                c={model.labels?.includes('recommended') ? 'chatbox-brand' : undefined}
              >
                {model.nickname || model.modelId}
              </Text>
              {model.labels?.includes('pro') && (
                <Badge color="chatbox-brand" size="xs" variant="light">
                  Pro
                </Badge>
              )}

              <Flex flex="0 0 auto" gap="xs" align="center">
                {model.capabilities?.includes('reasoning') && (
                  <Tooltip label={t('Reasoning')}>
                    <IconBulb size={20} className="text-[var(--mantine-color-chatbox-warning-text)]" />
                  </Tooltip>
                )}
                {model.capabilities?.includes('vision') && (
                  <Tooltip label={t('Vision')}>
                    <IconEye size={20} className="text-[var(--mantine-color-chatbox-brand-text)]" />
                  </Tooltip>
                )}
                {model.capabilities?.includes('tool_use') && (
                  <Tooltip label={t('Tool Use')}>
                    <IconTool size={20} className="text-[var(--mantine-color-chatbox-success-text)]" />
                  </Tooltip>
                )}
              </Flex>

              {!providerSettings?.excludedModels?.includes(model.modelId) ? (
                <Button
                  variant="transparent"
                  p={0}
                  h="auto"
                  size="xs"
                  bd={0}
                  className="ml-auto"
                  onClick={() =>
                    setProviderSettings({
                      excludedModels: [...(providerSettings?.excludedModels || []), model.modelId],
                    })
                  }
                >
                  <IconCircleMinus size={20} className="text-[var(--mantine-color-chatbox-error-text)]" />
                </Button>
              ) : (
                <Button
                  variant="transparent"
                  p={0}
                  h="auto"
                  size="xs"
                  bd={0}
                  className="ml-auto"
                  onClick={() =>
                    setProviderSettings({
                      excludedModels: (providerSettings?.excludedModels || []).filter((m) => m !== model.modelId),
                    })
                  }
                >
                  <IconCirclePlus size={20} className="text-[var(--mantine-color-chatbox-success-text)]" />
                </Button>
              )}
            </Flex>
          ))}
        </Stack>
      </Modal>
    </Stack>
  )
}
