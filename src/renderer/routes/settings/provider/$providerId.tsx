import PopoverConfirm from '@/components/PopoverConfirm'
import { useProviderSettings, useSettings } from '@/hooks/useSettings'
import { getModelSettingUtil } from '@/packages/model-setting-utils'
import { getModel } from '@/packages/models'
import {
  normalizeAzureEndpoint,
  normalizeClaudeHost,
  normalizeGeminiHost,
  normalizeOpenAIApiHostAndPath,
} from '@/packages/models/llm_utils'
import platform from '@/platform'
import { add, add as addToast } from '@/stores/toastActions'
import NiceModal from '@ebay/nice-modal-react'
import {
  Button,
  Flex,
  Modal,
  PasswordInput,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconBulb,
  IconCircleMinus,
  IconCirclePlus,
  IconExternalLink,
  IconEye,
  IconPlus,
  IconRefresh,
  IconRestore,
  IconSettings,
  IconTool,
  IconTrash,
} from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChangeEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SystemProviders } from 'src/shared/defaults'
import {
  MessageRoleEnum,
  ModelOptionGroup,
  ModelProviderEnum,
  ModelProviderType,
  ProviderModelInfo
} from 'src/shared/types'

export const Route = createFileRoute('/settings/provider/$providerId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { providerId } = Route.useParams()
  return <ProviderSettings key={providerId} providerId={providerId} />
}

function ProviderSettings({ providerId }: { providerId: string }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { settings, setSettings } = useSettings()
  const baseInfo = [...SystemProviders, ...(settings.customProviders || [])].find((p) => p.id === providerId)

  const { providerSettings, setProviderSettings } = useProviderSettings(providerId)

  const displayModels = providerSettings?.models || baseInfo?.defaultSettings?.models || []

  const handleApiKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    setProviderSettings({
      apiKey: e.currentTarget.value,
    })
  }

  const handleApiHostChange = (e: ChangeEvent<HTMLInputElement>) => {
    setProviderSettings({
      apiHost: e.currentTarget.value,
    })
  }

  const handleApiPathChange = (e: ChangeEvent<HTMLInputElement>) => {
    setProviderSettings({
      apiPath: e.currentTarget.value,
    })
  }

  const handleAddModel = async () => {
    const newModel: ProviderModelInfo = await NiceModal.show('model-edit', {})
    if (!newModel?.modelId) {
      return
    }

    if (displayModels?.find((m) => m.modelId === newModel.modelId)) {
      addToast(t('already existed'))
      return
    }

    setProviderSettings({
      models: [...displayModels, newModel],
    })
  }

  const editModel = async (model: ProviderModelInfo) => {
    const newModel: ProviderModelInfo = await NiceModal.show('model-edit', { model })
    if (!newModel?.modelId) {
      return
    }

    setProviderSettings({
      models: displayModels.map((m) => (m.modelId === newModel.modelId ? newModel : m)),
    })
  }

  const deleteModel = (modelId: string) => {
    setProviderSettings({
      models: displayModels.filter((m) => m.modelId !== modelId),
    })
  }

  const resetModels = () => {
    setProviderSettings({
      models: baseInfo?.defaultSettings?.models,
    })
  }

  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<ProviderModelInfo[]>()

  const handleFetchModels = async () => {
    if (baseInfo?.isCustom === true) {
      return
    }

    try {
      setFetchedModels(undefined)
      setFetchingModels(true)
      const modelConfig = getModelSettingUtil(baseInfo!.id)
      const modelList = await modelConfig.getMergeOptionGroups({
        ...baseInfo?.defaultSettings,
        ...providerSettings,
      })

      if (modelList.length) {
        setFetchedModels(
          modelList
            .reduce((pre, cur) => [...pre, ...cur.options], [] as ModelOptionGroup['options'])
            .map((option) => ({ modelId: option.value } as ProviderModelInfo))
        )
      } else {
        add(t('Failed to fetch models'))
      }
      setFetchingModels(false)
    } catch (error) {
      setFetchedModels(undefined)
      setFetchingModels(false)
    }
  }

  const [apiKeyAvaliable, setApiKeyAvaliable] = useState<boolean>()
  const [apiKeyChecking, setApiKeyChecking] = useState(false)
  const [apiKeyCheckingError, setApiKeyCheckingError] = useState<string>()
  const checkModel = baseInfo?.defaultSettings?.models?.[0]?.modelId || providerSettings?.models?.[0]?.modelId
  const handleCheckApiKey = async () => {
    try {
      setApiKeyChecking(true)
      const configs = await platform.getConfig()
      const modelInstance = getModel(
        {
          ...settings,
          provider: providerId as any,
          modelId: checkModel,
        },
        configs
      )
      await modelInstance.chat(
        [
          {
            id: '',
            role: MessageRoleEnum.User,
            contentParts: [
              {
                type: 'text',
                text: 'test',
              },
            ],
          },
        ],
        {}
      )
      setApiKeyAvaliable(true)
    } catch (e: any) {
      try {
        const errorMessage = JSON.parse(e.responseBody)
        setApiKeyCheckingError(JSON.stringify(errorMessage, null, 2))
      } catch {
        setApiKeyCheckingError(e?.responseBody || e?.message || e?.error?.message || String(e))
      }
      setApiKeyAvaliable(false)
    } finally {
      setApiKeyChecking(false)
    }
  }

  if (!baseInfo) {
    return <Text>{t('Provider not found')}</Text>
  }

  return (
    <Stack key={baseInfo.id} gap="xxl">
      <Flex gap="xs" align="center">
        <Title order={3} c="chatbox-secondary">
          {t(baseInfo.name)}
        </Title>
        {baseInfo.urls?.website && (
          <Button
            variant="transparent"
            c="chatbox-tertiary"
            px={0}
            h={24}
            onClick={() => platform.openLink(baseInfo.urls!.website!)}
          >
            <IconExternalLink size={24} />
          </Button>
        )}
        {baseInfo.isCustom && (
          <>
            <PopoverConfirm
              title={t('Confirm to delete this custom provider?')}
              confirmButtonColor="chatbox-error"
              onConfirm={() => {
                setSettings({
                  customProviders: settings.customProviders?.filter((p) => p.id !== baseInfo.id),
                })
                navigate({ to: './..' as any, replace: true })
              }}
            >
              <Button
                variant="transparent"
                size="compact-xs"
                leftSection={<IconTrash size={24} />}
                color="chatbox-error"
              ></Button>
            </PopoverConfirm>
          </>
        )}
      </Flex>

      <Stack gap="xl">
        {/* custom provider base info */}
        {baseInfo.isCustom && (
          <>
            <Stack gap="xxs">
              <Text span fw="600">
                {t('Name')}
              </Text>
              <TextInput
                flex={1}
                value={baseInfo.name}
                onChange={(e) => {
                  setSettings({
                    customProviders: settings.customProviders?.map((p) =>
                      p.id === baseInfo.id ? { ...p, name: e.currentTarget.value } : p
                    ),
                  })
                }}
              />
            </Stack>

            <Stack gap="xxs">
              <Text span fw="600">
                {t('API Mode')}
              </Text>
              <Select
                value={baseInfo.type}
                data={[
                  {
                    value: ModelProviderType.OpenAI,
                    label: t('OpenAI API Compatible'),
                  },
                ]}
              />
            </Stack>
          </>
        )}

        {/* API Key */}
        {![ModelProviderEnum.Ollama, ModelProviderEnum.LMStudio, ''].includes(baseInfo.id) && (
          <Stack gap="xxs">
            <Text span fw="600">
              {t('API Key')}
            </Text>
            <Flex gap="xs" align="center">
              <PasswordInput flex={1} value={providerSettings?.apiKey || ''} onChange={handleApiKeyChange} />
              <Tooltip
                disabled={!!providerSettings?.apiKey && !!checkModel}
                label={
                  !providerSettings?.apiKey
                    ? t('API Key is required to check connection')
                    : !checkModel
                    ? t('Add at least one model to check connection')
                    : null
                }
              >
                <Button
                  size="sm"
                  disabled={!providerSettings?.apiKey || !checkModel}
                  loading={apiKeyChecking}
                  onClick={handleCheckApiKey}
                >
                  {t('Check')}
                </Button>
              </Tooltip>
            </Flex>
            {apiKeyAvaliable === true && (
              <Text span c="chatbox-success">
                {t('Connection successful!')}
              </Text>
            )}
            {apiKeyAvaliable === false && (
              <Text span c="chatbox-error">
                {t('Connection failed!')}
                <ScrollArea w="100%" className="bg-red-50 dark:bg-red-900/20 px-2">
                  <pre className="text-xs">{apiKeyCheckingError}</pre>
                </ScrollArea>
              </Text>
            )}
          </Stack>
        )}

        {/* API Host */}
        {[
          ModelProviderEnum.OpenAI,
          ModelProviderEnum.Claude,
          ModelProviderEnum.Gemini,
          ModelProviderEnum.Ollama,
          ModelProviderEnum.LMStudio,
          '',
        ].includes(baseInfo.id) && (
          <Stack gap="xxs">
            <Flex justify="space-between" align="flex-end" gap="md">
              <Text span fw="600" className=" whitespace-nowrap">
                {t('API Host')}
              </Text>
              {/* <Text span size="xs" flex="0 1 auto" c="chatbox-secondary" lineClamp={1}>
                {t('Ending with / ignores v1, ending with # forces use of input address')}
              </Text> */}
            </Flex>
            <Flex gap="xs" align="center">
              <TextInput
                flex={1}
                value={providerSettings?.apiHost}
                placeholder={baseInfo.defaultSettings?.apiHost}
                onChange={handleApiHostChange}
              />
            </Flex>
            <Text span size="xs" flex="0 1 auto" c="chatbox-secondary">
              {[ModelProviderEnum.OpenAI, ModelProviderEnum.Ollama, ModelProviderEnum.LMStudio, ''].includes(baseInfo.id)
                ? normalizeOpenAIApiHostAndPath({
                    apiHost: providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost,
                  }).apiHost +
                  normalizeOpenAIApiHostAndPath({
                    apiHost: providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost,
                  }).apiPath
                : ''}
              {baseInfo.id === ModelProviderEnum.Claude
                ? normalizeClaudeHost(providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost || '').apiHost +
                  normalizeClaudeHost(providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost || '').apiPath
                : ''}
              {baseInfo.id === ModelProviderEnum.Gemini
                ? normalizeGeminiHost(providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost || '').apiHost +
                  normalizeGeminiHost(providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost || '').apiPath
                : ''}
            </Text>
          </Stack>
        )}

        {baseInfo.isCustom && (
          <>
            {/* custom provider api host & path */}
            <Stack gap="xs">
              <Flex gap="sm">
                <Stack gap="xxs" flex={3}>
                  <Flex justify="space-between" align="flex-end" gap="md">
                    <Text span fw="600" className=" whitespace-nowrap">
                      {t('API Host')}
                    </Text>
                  </Flex>
                  <Flex gap="xs" align="center">
                    <TextInput
                      flex={1}
                      value={providerSettings?.apiHost}
                      placeholder={baseInfo.defaultSettings?.apiHost}
                      onChange={handleApiHostChange}
                    />
                  </Flex>
                </Stack>

                <Stack gap="xxs" flex={2}>
                  <Flex justify="space-between" align="flex-end" gap="md">
                    <Text span fw="600" className=" whitespace-nowrap">
                      {t('API Path')}
                    </Text>
                  </Flex>
                  <Flex gap="xs" align="center">
                    <TextInput flex={1} value={providerSettings?.apiPath} onChange={handleApiPathChange} />
                  </Flex>
                </Stack>
              </Flex>
              <Text span size="xs" flex="0 1 auto" c="chatbox-secondary">
                {normalizeOpenAIApiHostAndPath({
                  apiHost: providerSettings?.apiHost,
                  apiPath: providerSettings?.apiPath,
                }).apiHost +
                  normalizeOpenAIApiHostAndPath({
                    apiHost: providerSettings?.apiHost,
                    apiPath: providerSettings?.apiPath,
                  }).apiPath}
              </Text>
            </Stack>

            <Switch
              label={t('Improve Network Compatibility')}
              checked={providerSettings?.useProxy || false}
              onChange={(e) =>
                setProviderSettings({
                  useProxy: e.currentTarget.checked,
                })
              }
            />

            <Stack gap="xs">
              <Text span fw="600" className=" whitespace-nowrap">
                {t('Improve Network Compatibility')}
              </Text>
            </Stack>
          </>
        )}

        {baseInfo.id === ModelProviderEnum.Azure && (
          <>
            {/* Azure Endpoint */}
            <Stack gap="xxs">
              <Text span fw="600">
                {t('Azure Endpoint')}
              </Text>
              <Flex gap="xs" align="center">
                <TextInput
                  flex={1}
                  value={providerSettings?.endpoint}
                  placeholder="https://<resource_name>.openai.azure.com/"
                  onChange={(e) =>
                    setProviderSettings({
                      endpoint: e.currentTarget.value,
                    })
                  }
                />
              </Flex>
              <Text span size="xs" flex="0 1 auto" c="chatbox-secondary">
                {baseInfo.id === ModelProviderEnum.Azure
                  ? normalizeAzureEndpoint(providerSettings?.endpoint || baseInfo.defaultSettings?.endpoint || '')
                      .endpoint +
                    normalizeAzureEndpoint(providerSettings?.endpoint || baseInfo.defaultSettings?.endpoint || '')
                      .apiPath
                  : ''}
              </Text>
            </Stack>
            {/* Azure API Version */}
            <Stack gap="xxs">
              <Text span fw="600">
                {t('Azure API Version')}
              </Text>
              <Flex gap="xs" align="center">
                <TextInput
                  flex={1}
                  value={providerSettings?.apiVersion}
                  placeholder="2024-05-01-preview"
                  onChange={(e) =>
                    setProviderSettings({
                      apiVersion: e.currentTarget.value,
                    })
                  }
                />
              </Flex>
            </Stack>
          </>
        )}

        {/* Models */}
        <Stack gap="xxs">
          <Flex justify="space-between" align="center">
            <Text span fw="600">
              {t('Model')}
            </Text>
            <Flex gap="sm" align="center" justify="flex-end">
              <Button
                variant="light"
                size="compact-xs"
                px="sm"
                onClick={handleAddModel}
                leftSection={<IconPlus size={12} />}
              >
                {t('New')}
              </Button>

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
                loading={fetchingModels}
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
            px="xxs"
            className=" border-solid border rounded-sm min-h-[100px] border-[var(--mantine-color-chatbox-border-primary-outline)]"
          >
            {displayModels.map((model, index, list) => (
              <Flex
                key={model.modelId}
                gap="xs"
                align="center"
                py="sm"
                px="xs"
                className="border-solid border-0 border-b last:border-b-0 border-[var(--mantine-color-chatbox-border-primary-outline)]"
              >
                <Text component="span" size="sm" flex="0 1 auto">
                  {model.nickname || model.modelId}
                </Text>

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
                  <Button
                    variant="transparent"
                    c="chatbox-tertiary"
                    p={0}
                    h="auto"
                    size="xs"
                    bd={0}
                    onClick={() => editModel(model)}
                  >
                    <IconSettings size={20} />
                  </Button>

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

        <Modal
          keepMounted={false}
          opened={!!fetchedModels}
          onClose={() => setFetchedModels(undefined)}
          title={t('Edit Model')}
          centered={true}
        >
          <Stack gap="md">
            {fetchedModels?.map((model) => (
              <Flex key={model.modelId}>
                <Text component="span" size="sm" flex="0 1 auto">
                  {model.nickname || model.modelId}
                </Text>

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

                {displayModels?.find((m) => m.modelId === model.modelId) ? (
                  <Button
                    variant="transparent"
                    p={0}
                    h="auto"
                    size="xs"
                    bd={0}
                    className="ml-auto"
                    onClick={() =>
                      setProviderSettings({
                        models: displayModels.filter((m) => m.modelId !== model.modelId),
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
                        models: [...displayModels, model],
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
    </Stack>
  )
}
