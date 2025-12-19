import NiceModal from '@ebay/nice-modal-react'
import {
  Badge,
  Button,
  Flex,
  Loader,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconCircleCheck,
  IconDiscount2,
  IconExternalLink,
  IconHelpCircle,
  IconPlus,
  IconRefresh,
  IconRestore,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { uniq } from 'lodash'
import { type ChangeEvent, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SystemProviders } from 'src/shared/defaults'
import { ModelProviderEnum, ModelProviderType, type ProviderModelInfo } from 'src/shared/types'
import {
  normalizeAzureEndpoint,
  normalizeClaudeHost,
  normalizeGeminiHost,
  normalizeOpenAIApiHostAndPath,
  normalizeOpenAIResponsesHostAndPath,
} from 'src/shared/utils'
import { createModelDependencies } from '@/adapters'
import { ModelList } from '@/components/ModelList'
import { Modal } from '@/components/Overlay'
import PopoverConfirm from '@/components/PopoverConfirm'
import { ScalableIcon } from '@/components/ScalableIcon'
import { getModelSettingUtil } from '@/packages/model-setting-utils'
import platform from '@/platform'
import { useLanguage, useProviderSettings, useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'
import { type ModelTestState, testModelCapabilities } from '@/utils/model-tester'

export const Route = createFileRoute('/settings/provider/$providerId')({
  component: RouteComponent,
})

type ModelTestResult = ModelTestState & {
  modelId: string
  modelName: string
}

function normalizeAPIHost(
  providerSettings: any,
  providerType: ModelProviderType
): {
  apiHost: string
  apiPath: string
} {
  switch (providerType) {
    case ModelProviderType.Claude:
      return normalizeClaudeHost(providerSettings?.apiHost || '')
    case ModelProviderType.Gemini:
      return normalizeGeminiHost(providerSettings?.apiHost || '')
    case ModelProviderType.OpenAIResponses:
      return normalizeOpenAIResponsesHostAndPath({
        apiHost: providerSettings?.apiHost,
        apiPath: providerSettings?.apiPath,
      })
    case ModelProviderType.OpenAI:
    default:
      return normalizeOpenAIApiHostAndPath({
        apiHost: providerSettings?.apiHost,
        apiPath: providerSettings?.apiPath,
      })
  }
}

export function RouteComponent() {
  const { providerId } = Route.useParams()
  return <ProviderSettings key={providerId} providerId={providerId} />
}

function ProviderSettings({ providerId }: { providerId: string }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)

  const language = useLanguage()

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
    const newModel: ProviderModelInfo = await NiceModal.show('model-edit', { providerId })
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
    const newModel: ProviderModelInfo = await NiceModal.show('model-edit', { model, providerId })
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
    try {
      setFetchedModels(undefined)
      setFetchingModels(true)
      const modelConfig = getModelSettingUtil(baseInfo!.id, baseInfo!.isCustom ? baseInfo!.type : undefined)
      const modelList = await modelConfig.getMergeOptionGroups({
        ...baseInfo?.defaultSettings,
        ...providerSettings,
      })

      if (modelList.length) {
        setFetchedModels(modelList)
      } else {
        addToast(t('Failed to fetch models'))
      }
      setFetchingModels(false)
    } catch (error) {
      console.error('Failed to fetch models', error)
      setFetchedModels(undefined)
      setFetchingModels(false)
    }
  }
  const [selectedTestModel, setSelectedTestModel] = useState<string>()
  const [showTestModelSelector, setShowTestModelSelector] = useState(false)
  const [modelTestResult, setModelTestResult] = useState<ModelTestResult | null>(null)
  const checkModel =
    selectedTestModel || baseInfo?.defaultSettings?.models?.[0]?.modelId || providerSettings?.models?.[0]?.modelId

  const handleCheckApiKey = async (modelId?: string) => {
    const testModel = modelId || checkModel
    if (!testModel) return

    // Find the model info
    const modelInfo = displayModels.find((m) => m.modelId === testModel)
    if (!modelInfo) return

    // Use the same testing modal as handleCheckModel
    await handleCheckModel(modelInfo)
  }

  const handleCheckModel = useCallback(
    async (model: ProviderModelInfo) => {
      // Initialize result with model info
      const result: ModelTestResult = {
        modelId: model.modelId,
        modelName: model.nickname || model.modelId,
        testing: true,
        basicTest: { status: 'pending' },
        visionTest: { status: 'pending' },
        toolTest: { status: 'pending' },
      }
      setModelTestResult(result)

      const configs = await platform.getConfig()
      const dependencies = await createModelDependencies()

      const finalState = await testModelCapabilities({
        providerId,
        modelId: model.modelId,
        settings,
        configs,
        dependencies,
        onStateChange: (state) => {
          setModelTestResult({
            ...result,
            ...state,
          })
        },
      })
      const visionSupported = finalState.visionTest?.status === 'success'
      const toolUseSupported = finalState.toolTest?.status === 'success'
      if (visionSupported || toolUseSupported) {
        const capabilitiesToAdd: ('vision' | 'tool_use')[] = []
        if (visionSupported) capabilitiesToAdd.push('vision')
        if (toolUseSupported) capabilitiesToAdd.push('tool_use')
        console.log('Auto-enable capabilities based on test results')
        setProviderSettings({
          models: displayModels.map((m) =>
            m.modelId === model.modelId
              ? { ...m, capabilities: uniq([...(m.capabilities || []), ...capabilitiesToAdd]) }
              : m
          ),
        })
      }
    },
    [displayModels, setProviderSettings, providerId]
  )

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
            <ScalableIcon icon={IconExternalLink} size={24} />
          </Button>
        )}
        {baseInfo.isCustom && (
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
              leftSection={<ScalableIcon icon={IconTrash} size={24} />}
              color="chatbox-error"
            ></Button>
          </PopoverConfirm>
        )}
      </Flex>
      {baseInfo.isCustom && language === 'zh-Hans' && (
        <Flex>
          <ScalableIcon icon={IconHelpCircle} />
          <Text span size="xs" c="chatbox-tertiary">
            <a href="https://docs.chatboxai.app/guides/providers" target="_blank" rel="noopener">
              {t('Setup guide')}
            </a>
          </Text>
        </Flex>
      )}

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
                onChange={(value) => {
                  setSettings({
                    customProviders: settings.customProviders?.map((p) =>
                      p.id === baseInfo.id ? { ...p, type: value as ModelProviderType } : p
                    ),
                  })
                }}
                data={[
                  {
                    value: ModelProviderType.OpenAI,
                    label: t('OpenAI API Compatible'),
                  },
                  {
                    value: ModelProviderType.OpenAIResponses,
                    label: t('OpenAI Responses API Compatible'),
                  },
                  {
                    value: ModelProviderType.Claude,
                    label: t('Claude API Compatible'),
                  },
                  {
                    value: ModelProviderType.Gemini,
                    label: t('Google Gemini API Compatible'),
                  },
                ]}
              />
            </Stack>
          </>
        )}

        {/* Provider description */}
        {baseInfo.description && (
          <Stack gap="xxs">
            <Text span size="xs" c="chatbox-tertiary">
              {t(baseInfo.description)}
            </Text>
          </Stack>
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
                disabled={!!providerSettings?.apiKey && displayModels.length > 0}
                label={
                  !providerSettings?.apiKey
                    ? t('API Key is required to check connection')
                    : displayModels.length === 0
                      ? t('Add at least one model to check connection')
                      : null
                }
              >
                <Button
                  size="sm"
                  disabled={!providerSettings?.apiKey || displayModels.length === 0}
                  loading={modelTestResult?.testing || false}
                  onClick={() => setShowTestModelSelector(true)}
                >
                  {t('Check')}
                </Button>
              </Tooltip>
            </Flex>
          </Stack>
        )}

        {/* API Host */}
        {[
          ModelProviderEnum.OpenAI,
          ModelProviderEnum.OpenAIResponses,
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
              {[ModelProviderEnum.OpenAI, ModelProviderEnum.Ollama, ModelProviderEnum.LMStudio, ''].includes(
                baseInfo.id
              )
                ? normalizeOpenAIApiHostAndPath({
                    apiHost: providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost,
                  }).apiHost +
                  normalizeOpenAIApiHostAndPath({
                    apiHost: providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost,
                  }).apiPath
                : ''}
              {baseInfo.id === ModelProviderEnum.OpenAIResponses
                ? normalizeOpenAIResponsesHostAndPath({
                    apiHost: providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost,
                    apiPath: providerSettings?.apiPath || baseInfo.defaultSettings?.apiPath,
                  }).apiHost +
                  normalizeOpenAIResponsesHostAndPath({
                    apiHost: providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost,
                    apiPath: providerSettings?.apiPath || baseInfo.defaultSettings?.apiPath,
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
                    <TextInput
                      flex={1}
                      value={providerSettings?.apiPath}
                      onChange={handleApiPathChange}
                      placeholder={normalizeAPIHost(providerSettings, baseInfo.type).apiPath}
                    />
                  </Flex>
                </Stack>
              </Flex>
              <Text span size="xs" flex="0 1 auto" c="chatbox-secondary">
                {normalizeAPIHost(providerSettings, baseInfo.type).apiHost +
                  normalizeAPIHost(providerSettings, baseInfo.type).apiPath}
              </Text>
              {providerSettings?.apiHost?.includes('aihubmix.com') && (
                <Flex align="center" gap={4}>
                  <ScalableIcon icon={IconDiscount2} size={14} color="var(--chatbox-tint-tertiary)" />
                  <Text span size="xs" c="chatbox-tertiary">
                    {t('AIHubMix integration in Chatbox offers 10% discount')}
                  </Text>
                </Flex>
              )}
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

        {/* useProxy for Ollama */}
        {baseInfo.id === ModelProviderEnum.Ollama && (
          <Switch
            label={t('Improve Network Compatibility')}
            checked={providerSettings?.useProxy || false}
            onChange={(e) =>
              setProviderSettings({
                useProxy: e.currentTarget.checked,
              })
            }
          />
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
                leftSection={<ScalableIcon icon={IconPlus} size={12} />}
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
                leftSection={<ScalableIcon icon={IconRestore} size={12} />}
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
                leftSection={<ScalableIcon icon={IconRefresh} size={12} />}
              >
                {t('Fetch')}
              </Button>
            </Flex>
          </Flex>

          <ModelList
            models={displayModels}
            showActions={true}
            showSearch={false}
            onEditModel={editModel}
            onDeleteModel={deleteModel}
          />
        </Stack>

        <Modal
          keepMounted={false}
          opened={!!fetchedModels}
          onClose={() => {
            setFetchedModels(undefined)
          }}
          title={t('Edit Model')}
          centered={true}
          classNames={{
            content: '!max-h-[95vh]',
          }}
        >
          <ModelList
            models={fetchedModels || []}
            showActions={true}
            showSearch={true}
            displayedModelIds={displayModels.map((m) => m.modelId)}
            onAddModel={(model) => setProviderSettings({ models: [...displayModels, model] })}
            onRemoveModel={(modelId) =>
              setProviderSettings({ models: displayModels.filter((m) => m.modelId !== modelId) })
            }
          />
        </Modal>

        {/* Test Model Selector Modal */}
        <Modal
          opened={showTestModelSelector}
          onClose={() => setShowTestModelSelector(false)}
          title={t('Select Test Model')}
          centered={true}
          size="md"
        >
          <Stack gap="xs">
            {displayModels.length > 0 ? (
              displayModels.map((model) => (
                <Button
                  key={model.modelId}
                  variant="light"
                  fullWidth
                  onClick={async () => {
                    setSelectedTestModel(model.modelId)
                    setShowTestModelSelector(false)
                    // 执行检查
                    await handleCheckApiKey(model.modelId)
                  }}
                  styles={{
                    root: {
                      justifyContent: 'flex-start',
                    },
                  }}
                >
                  {model.nickname || model.modelId}
                </Button>
              ))
            ) : (
              <Text c="chatbox-secondary" ta="center" py="md">
                {t('No models available')}
              </Text>
            )}
          </Stack>
        </Modal>

        {/* Model Test Result Modal */}
        <Modal
          opened={!!modelTestResult}
          onClose={() => setModelTestResult(null)}
          title={t('Model Test Results')}
          centered={true}
          size="md"
        >
          {modelTestResult && (
            <Stack gap="md">
              <Text size="lg" fw={500}>
                {modelTestResult.modelName}
              </Text>

              <Stack gap="sm">
                {/* Basic Test */}
                {modelTestResult.basicTest?.status === 'success' ? (
                  <>
                    <Text span c="chatbox-success">
                      {t('Connection successful!')}
                    </Text>
                    <Flex
                      direction="column"
                      gap="md"
                      bg="var(--chatbox-background-secondary)"
                      bd="1px solid var(--chatbox-border-primary)"
                      p="xs"
                    >
                      <Flex align="center" gap="xs">
                        <Text style={{ minWidth: '120px' }}>{t('Text Request')}:</Text>
                        <ScalableIcon icon={IconCircleCheck} color="var(--chatbox-tint-success)" />
                      </Flex>
                      {/* Vision Test */}
                      <Flex align="center" gap="xs">
                        <Text style={{ minWidth: '120px' }}>{t('Vision Request')}:</Text>
                        {modelTestResult.visionTest?.status === 'success' ? (
                          <ScalableIcon icon={IconCircleCheck} color="var(--chatbox-tint-success)" />
                        ) : modelTestResult.visionTest?.status === 'error' ? (
                          <Flex align="center" gap="xs" maw={400}>
                            <Tooltip label={modelTestResult.visionTest.error} multiline>
                              <ScalableIcon icon={IconX} className="cursor-help" color="var(--chatbox-tint-error)" />
                            </Tooltip>
                            <Text>{t('This model does not support vision')}</Text>
                          </Flex>
                        ) : (
                          <Flex align="center" gap="xs">
                            <Loader size="xs" />
                            <Text c="chatbox-tertiary" size="sm">
                              {t('Testing...')}
                            </Text>
                          </Flex>
                        )}
                      </Flex>

                      {/* Tool Use Test */}
                      <Flex align="center" gap="xs">
                        <Text style={{ minWidth: '120px' }}>{t('Tool Use Request')}:</Text>
                        {modelTestResult.toolTest?.status === 'success' ? (
                          <ScalableIcon icon={IconCircleCheck} color="var(--chatbox-tint-success)" />
                        ) : modelTestResult.toolTest?.status === 'error' ? (
                          <Flex align="center" gap="xs" maw={400}>
                            <Tooltip label={modelTestResult.toolTest.error} multiline>
                              <ScalableIcon icon={IconX} className="cursor-help" color="var(--chatbox-tint-error)" />
                            </Tooltip>
                            <Text>{t('This model does not support tool use')}</Text>
                          </Flex>
                        ) : (
                          <Flex align="center" gap="xs">
                            <Loader size="xs" />
                            <Text c="chatbox-tertiary" size="sm">
                              {t('Testing...')}
                            </Text>
                          </Flex>
                        )}
                      </Flex>
                    </Flex>
                  </>
                ) : modelTestResult.basicTest?.status === 'error' ? (
                  <Flex align="center" gap="xs" className="w-full">
                    <Text span c="chatbox-error" maw="100%">
                      {t('Connection failed!')}
                      <div className="bg-red-50 dark:bg-red-900/20 px-2 py-2">
                        <Text size="xs" c="chatbox-error">
                          {modelTestResult.basicTest.error}
                        </Text>
                      </div>
                    </Text>
                  </Flex>
                ) : (
                  <Flex align="center" gap="xs">
                    <Loader size="xs" />
                    <Text c="chatbox-tertiary" size="sm">
                      {t('Testing...')}
                    </Text>
                  </Flex>
                )}
              </Stack>
            </Stack>
          )}
          <Flex justify="flex-end">
            <Button mt="md" onClick={() => setModelTestResult(null)}>
              {t('Confirm')}
            </Button>
          </Flex>
        </Modal>
      </Stack>
    </Stack>
  )
}
