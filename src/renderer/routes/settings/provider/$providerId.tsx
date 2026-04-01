import NiceModal from '@ebay/nice-modal-react'
import {
  Badge,
  Button,
  Flex,
  Loader,
  PasswordInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { SystemProviders } from '@shared/defaults'
import { type OAuthProviderInfo, toOAuthProviderId, toOAuthSettingsProviderId } from '@shared/oauth'
import { getProviderDefinition } from '@shared/providers'
import {
  ModelProviderEnum,
  ModelProviderType,
  type ProviderModelInfo,
  type ProviderSettings as SharedProviderSettings,
} from '@shared/types'
import {
  normalizeAzureEndpoint,
  normalizeClaudeHost,
  normalizeGeminiHost,
  normalizeOpenAIApiHostAndPath,
  normalizeOpenAIResponsesHostAndPath,
} from '@shared/utils'
import {
  IconCircleCheck,
  IconDiscount2,
  IconExternalLink,
  IconHelpCircle,
  IconLogin,
  IconLogout,
  IconPlus,
  IconRefresh,
  IconRestore,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { uniq } from 'lodash'
import { type ChangeEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createModelDependencies } from '@/adapters'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import PopoverConfirm from '@/components/common/PopoverConfirm'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { ModelList } from '@/components/ModelList'
import { useOAuth } from '@/hooks/useOAuth'
import { useOAuthProviders } from '@/hooks/useOAuthProviders'
import { enrichModelsFromRegistry, forceRefreshRegistry, useModelRegistryVersion } from '@/packages/model-registry'
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

const BUILTIN_API_HOST_PROVIDERS = new Set<string>([
  ModelProviderEnum.OpenAI,
  ModelProviderEnum.OpenAIResponses,
  ModelProviderEnum.Claude,
  ModelProviderEnum.Gemini,
  ModelProviderEnum.Qwen,
  ModelProviderEnum.QwenPortal,
  ModelProviderEnum.MiniMax,
  ModelProviderEnum.MiniMaxCN,
  ModelProviderEnum.Moonshot,
  ModelProviderEnum.MoonshotCN,
  ModelProviderEnum.Ollama,
  ModelProviderEnum.LMStudio,
])

const OAUTH_ONLY_PROVIDERS = new Set<string>([ModelProviderEnum.QwenPortal])

const OAUTH_PROVIDER_FALLBACKS: Record<string, OAuthProviderInfo> = {
  claude: {
    providerId: 'claude',
    name: 'Claude',
    flowType: 'code-paste',
  },
  gemini: {
    providerId: 'gemini',
    name: 'Gemini',
    flowType: 'callback',
  },
  'github-copilot': {
    providerId: 'github-copilot',
    name: 'GitHub Copilot',
    flowType: 'device-code',
  },
  minimax: {
    providerId: 'minimax',
    name: 'MiniMax',
    flowType: 'device-code',
  },
  'minimax-cn': {
    providerId: 'minimax-cn',
    name: 'MiniMax CN',
    flowType: 'device-code',
  },
  openai: {
    providerId: 'openai',
    name: 'OpenAI',
    flowType: 'callback',
  },
  'qwen-portal': {
    providerId: 'qwen-portal',
    name: 'Qwen Portal',
    flowType: 'device-code',
  },
}

function normalizeAPIHost(
  providerSettings: SharedProviderSettings | undefined,
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
  useModelRegistryVersion()

  const navigate = useNavigate()
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)

  const language = useLanguage()

  const baseInfo = [...SystemProviders(), ...(settings.customProviders || [])].find((p) => p.id === providerId)

  const { providerSettings, setProviderSettings } = useProviderSettings(providerId)
  const oauthProviderId = toOAuthProviderId(providerId)
  const oauthSettingsProviderId = toOAuthSettingsProviderId(providerId) || providerId

  // OAuth
  const oauthProviders = useOAuthProviders()
  const oauthProviderInfo = oauthProviderId
    ? oauthProviders.find((p) => p.providerId === oauthProviderId) || OAUTH_PROVIDER_FALLBACKS[oauthProviderId]
    : undefined
  const supportsOAuth = !!oauthProviderInfo
  const {
    isDesktop,
    hasOAuth,
    isOAuthActive,
    flowType,
    loginCallback,
    startLogin,
    exchangeCode,
    startDeviceFlow,
    waitForDeviceToken,
    cancel,
    logout,
  } = useOAuth(oauthProviderId || providerId, oauthProviderInfo, oauthSettingsProviderId, providerId)
  const [oauthLoading, setOAuthLoading] = useState(false)
  const [showCodeInput, setShowCodeInput] = useState(false)
  const [codeInputValue, setCodeInputValue] = useState('')
  const [codeInputInstructions, setCodeInputInstructions] = useState('')
  const [showDeviceCode, setShowDeviceCode] = useState(false)
  const [deviceUserCode, setDeviceUserCode] = useState('')
  const [deviceVerificationUri, setDeviceVerificationUri] = useState('')

  const handleOAuthLogin = async () => {
    if (flowType === 'code-paste') {
      // Code-paste flow: start login, show code input dialog
      setOAuthLoading(true)
      try {
        const startResult = await startLogin()
        if (!startResult.success) {
          addToast(startResult.error || t('Login failed'))
          return
        }
        // Open auth URL in browser
        if (startResult.authUrl) {
          platform.openLink(startResult.authUrl)
        }
        setCodeInputInstructions(startResult.instructions || '')
        setCodeInputValue('')
        setShowCodeInput(true)
      } finally {
        setOAuthLoading(false)
      }
    } else if (flowType === 'device-code') {
      // Device-code flow: start flow, show user code, poll for token
      setOAuthLoading(true)
      try {
        const startResult = await startDeviceFlow()
        if (!startResult.success) {
          addToast(startResult.error || t('Login failed'))
          return
        }
        setDeviceUserCode(startResult.userCode || '')
        setDeviceVerificationUri(startResult.verificationUri || '')
        setShowDeviceCode(true)
        // Open verification URL in browser
        if (startResult.verificationUri) {
          platform.openLink(startResult.verificationUri)
        }
        // Poll for token in background
        const result = await waitForDeviceToken()
        setShowDeviceCode(false)
        if (!result.success) {
          addToast(result.error || t('Login failed'))
        }
      } finally {
        setOAuthLoading(false)
      }
    } else {
      // Callback flow: single step (OpenAI, Gemini)
      setOAuthLoading(true)
      try {
        const result = await loginCallback()
        if (!result.success && result.error !== 'Login cancelled') {
          addToast(result.error || t('Login failed'))
        }
      } finally {
        setOAuthLoading(false)
      }
    }
  }

  const handleCancelOAuth = async () => {
    await cancel()
    setOAuthLoading(false)
    setShowDeviceCode(false)
    setShowCodeInput(false)
  }

  const handleCodeSubmit = async () => {
    if (!codeInputValue.trim()) return
    setOAuthLoading(true)
    try {
      const result = await exchangeCode(codeInputValue.trim())
      if (result.success) {
        setShowCodeInput(false)
        setCodeInputValue('')
      } else {
        addToast(result.error || t('Login failed'))
      }
    } finally {
      setOAuthLoading(false)
    }
  }

  const handleAuthModeChange = (value: string) => {
    setProviderSettings({
      activeAuthMode: value as 'apikey' | 'oauth',
    })
  }

  const rawModels = providerSettings?.models || baseInfo?.defaultSettings?.models || []
  const displayModels = enrichModelsFromRegistry(rawModels, providerId)
  const usesResponsesTransportForOAuth = [ModelProviderEnum.OpenAI, ModelProviderEnum.OpenAIResponses].includes(
    providerId as ModelProviderEnum
  )
  const isOAuthOnlyProvider = baseInfo?.id ? OAUTH_ONLY_PROVIDERS.has(baseInfo.id) : false
  const providerWebsite = baseInfo?.urls?.website || ''

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
  const normalizedBuiltinApiHost = baseInfo
    ? normalizeAPIHost(
        {
          ...providerSettings,
          apiHost: providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost,
          apiPath: providerSettings?.apiPath || baseInfo.defaultSettings?.apiPath,
        },
        baseInfo.type
      )
    : { apiHost: '', apiPath: '' }

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
    if (!baseInfo) return

    try {
      setFetchedModels(undefined)
      setFetchingModels(true)
      const providerDefinition = getProviderDefinition(baseInfo.id)
      if (providerDefinition?.modelsDevProviderId) {
        await forceRefreshRegistry()
      }
      const modelConfig = getModelSettingUtil(baseInfo.id, baseInfo.isCustom ? baseInfo.type : undefined)
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

  const handleCheckModel = async (model: ProviderModelInfo) => {
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
    const modelName = model.nickname || model.modelId
    const providerName = baseInfo?.name ? t(baseInfo.name) : providerId
    if (finalState.basicTest?.status === 'success') {
      trackJkClickEvent(JK_EVENTS.KEY_VERIFY_SUCCESS, {
        pageName: JK_PAGE_NAMES.SETTING_PAGE,
        content: null,
        contentType: modelName,
        props: { content_add_info: { content: providerName } },
      })
    } else if (finalState.basicTest?.status === 'error') {
      trackJkClickEvent(JK_EVENTS.KEY_VERIFY_FAILED, {
        pageName: JK_PAGE_NAMES.SETTING_PAGE,
        content: finalState.basicTest.error || 'unknown_error',
        contentType: modelName,
        props: { content_add_info: { content: providerName } },
      })
    }
    const visionSupported = finalState.visionTest?.status === 'success'
    const toolUseSupported = finalState.toolTest?.status === 'success'
    if (visionSupported || toolUseSupported) {
      const capabilitiesToAdd: ('vision' | 'tool_use')[] = []
      if (visionSupported) capabilitiesToAdd.push('vision')
      if (toolUseSupported) capabilitiesToAdd.push('tool_use')
      setProviderSettings({
        models: displayModels.map((m) =>
          m.modelId === model.modelId
            ? { ...m, capabilities: uniq([...(m.capabilities || []), ...capabilitiesToAdd]) }
            : m
        ),
      })
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
        {providerWebsite && (
          <Button
            variant="transparent"
            c="chatbox-tertiary"
            px={0}
            h={24}
            onClick={() => platform.openLink(providerWebsite)}
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
              navigate({ to: '/settings/provider', replace: true })
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
              <AdaptiveSelect
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

        {/* OAuth Login (Desktop only) */}
        {isDesktop && supportsOAuth && (
          <Stack gap="xs">
            <Text span fw="600">
              {t('Authentication')}
            </Text>

            {/* Auth mode toggle - show when both OAuth and API key are configured */}
            {hasOAuth && !isOAuthOnlyProvider && (
              <SegmentedControl
                value={providerSettings?.activeAuthMode || 'apikey'}
                onChange={handleAuthModeChange}
                data={[
                  { label: t('API Key'), value: 'apikey' },
                  { label: t('OAuth Login'), value: 'oauth' },
                ]}
              />
            )}

            {/* OAuth status & actions */}
            <Flex gap="xs" align="center">
              {hasOAuth ? (
                <>
                  <Badge color="green" variant="light">
                    {t('Logged in')}
                  </Badge>
                  <Button
                    variant="light"
                    color="red"
                    size="compact-sm"
                    leftSection={<ScalableIcon icon={IconLogout} size={14} />}
                    onClick={logout}
                  >
                    {t('Logout')}
                  </Button>
                </>
              ) : oauthLoading ? (
                <Flex gap="xs" align="center">
                  <Loader size="xs" />
                  <Text size="sm" c="chatbox-tertiary">
                    {t('Waiting for authorization...')}
                  </Text>
                  <Button variant="light" color="red" size="compact-sm" onClick={handleCancelOAuth}>
                    {t('Cancel')}
                  </Button>
                </Flex>
              ) : (
                <Button
                  variant="light"
                  size="sm"
                  leftSection={<ScalableIcon icon={IconLogin} size={16} />}
                  onClick={handleOAuthLogin}
                >
                  {t('Login with OAuth')}
                </Button>
              )}
            </Flex>
            {usesResponsesTransportForOAuth && (
              <Text size="xs" c="chatbox-tertiary">
                {t(
                  'When OAuth Login is enabled, OpenAI requests use the Responses transport instead of the legacy Chat Completions transport.'
                )}
              </Text>
            )}
          </Stack>
        )}

        {/* API Key */}
        {!isOAuthOnlyProvider && ![ModelProviderEnum.Ollama, ModelProviderEnum.LMStudio, ''].includes(baseInfo.id) && (
          <Stack gap="xxs" style={isOAuthActive ? { opacity: 0.5 } : undefined}>
            <Flex gap="xs" align="center">
              <Text span fw="600">
                {t('API Key')}
              </Text>
              {isOAuthActive && (
                <Text span size="xs" c="chatbox-tertiary">
                  ({t('Using OAuth')})
                </Text>
              )}
            </Flex>
            <Flex gap="xs" align="center">
              <PasswordInput
                flex={1}
                value={providerSettings?.apiKey || ''}
                onChange={handleApiKeyChange}
                disabled={isOAuthActive}
              />
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
                  disabled={isOAuthActive || !providerSettings?.apiKey || displayModels.length === 0}
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
        {BUILTIN_API_HOST_PROVIDERS.has(baseInfo.id) && (
          <Stack gap="xxs" style={isOAuthActive ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
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
              {normalizedBuiltinApiHost.apiHost + normalizedBuiltinApiHost.apiPath}
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

        <AdaptiveModal
          keepMounted={false}
          opened={!!fetchedModels}
          onClose={() => {
            setFetchedModels(undefined)
          }}
          title={t('Models')}
          centered={true}
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
        </AdaptiveModal>

        {/* Test Model Selector Modal */}
        <AdaptiveModal
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
        </AdaptiveModal>

        {/* OAuth Code Input Modal */}
        <AdaptiveModal
          opened={showCodeInput}
          onClose={handleCancelOAuth}
          title={t('Authorization Code')}
          centered={true}
          size="md"
        >
          <Stack gap="md">
            {codeInputInstructions && (
              <Text size="sm" c="chatbox-secondary">
                {codeInputInstructions}
              </Text>
            )}
            <TextInput
              value={codeInputValue}
              onChange={(e) => setCodeInputValue(e.currentTarget.value)}
              placeholder={t('Paste code here') || ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCodeSubmit()
              }}
            />
            <AdaptiveModal.Actions>
              <Flex gap="sm" justify="flex-end">
                <Button variant="default" onClick={handleCancelOAuth}>
                  {t('Cancel')}
                </Button>
                <Button loading={oauthLoading} disabled={!codeInputValue.trim()} onClick={handleCodeSubmit}>
                  {t('Confirm')}
                </Button>
              </Flex>
            </AdaptiveModal.Actions>
          </Stack>
        </AdaptiveModal>

        {/* OAuth Device Code Modal */}
        <AdaptiveModal
          opened={showDeviceCode}
          onClose={handleCancelOAuth}
          title={t('Device Authorization')}
          centered={true}
          size="md"
          closeOnClickOutside={false}
        >
          <Stack gap="md" align="center">
            <Text size="sm" c="chatbox-secondary" ta="center">
              {t('Enter the code below on the authorization page, then wait for approval.')}
            </Text>
            <Text
              size="xl"
              fw={700}
              ff="monospace"
              p="md"
              bg="var(--chatbox-background-secondary)"
              bd="1px solid var(--chatbox-border-primary)"
              style={{ borderRadius: 'var(--mantine-radius-md)', letterSpacing: '0.2em', userSelect: 'all' }}
            >
              {deviceUserCode}
            </Text>
            <Flex align="center" gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="chatbox-tertiary">
                {t('Waiting for authorization...')}
              </Text>
            </Flex>
            <Flex gap="sm">
              {deviceVerificationUri && (
                <Button
                  variant="light"
                  size="compact-sm"
                  leftSection={<ScalableIcon icon={IconExternalLink} size={14} />}
                  onClick={() => platform.openLink(deviceVerificationUri)}
                >
                  {t('Open Authorization Page')}
                </Button>
              )}
              <Button variant="light" color="red" size="compact-sm" onClick={handleCancelOAuth}>
                {t('Cancel')}
              </Button>
            </Flex>
          </Stack>
        </AdaptiveModal>

        {/* Model Test Result Modal */}
        <AdaptiveModal
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
          <AdaptiveModal.Actions>
            <Button mt="md" onClick={() => setModelTestResult(null)}>
              {t('Confirm')}
            </Button>
          </AdaptiveModal.Actions>
        </AdaptiveModal>
      </Stack>
    </Stack>
  )
}
