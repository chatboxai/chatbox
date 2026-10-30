import NiceModal from '@ebay/nice-modal-react'
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Flex,
  Loader,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { TestId } from '@shared/automation/testids'
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
import { SettingRow, SettingSwitchRow, SettingsPage, SettingsSection } from '@/components/settings/SettingsLayout'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useOAuth } from '@/hooks/useOAuth'
import { useOAuthProviders } from '@/hooks/useOAuthProviders'
import { enrichModelsFromRegistry, forceRefreshRegistry, useModelRegistryVersion } from '@/packages/model-registry'
import { getModelSettingUtil } from '@/packages/model-setting-utils'
import platform from '@/platform'
import { settingsStore, useLanguage, useProviderSettings, useSettingsStore } from '@/stores/settingsStore'
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
  ModelProviderEnum.VercelAIGateway,
  ModelProviderEnum.OpenCodeGo,
  ModelProviderEnum.OpenCodeZen,
  ModelProviderEnum.TencentHunyuan,
  ModelProviderEnum.XiaomiMiMo,
  ModelProviderEnum.LongCat,
  ModelProviderEnum.ZhipuGLMCodingPlan,
  ModelProviderEnum.PowerTokens,
])

const OAUTH_ONLY_PROVIDERS = new Set<string>([ModelProviderEnum.QwenPortal])

const OAUTH_PROVIDER_FALLBACKS: Record<string, OAuthProviderInfo> = {
  claude: {
    providerId: 'claude',
    name: 'Claude',
    flowType: 'code-paste',
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
  const setSettings = useSettingsStore((state) => state.setSettings)
  const customProviders = useSettingsStore((state) => state.customProviders)

  const language = useLanguage()

  const baseInfo = [...SystemProviders(), ...(customProviders || [])].find((p) => p.id === providerId)

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
      settings: settingsStore.getState(),
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
    return <Text p="md">{t('Provider not found')}</Text>
  }

  const isSystemManagedModelList = false
  const showApiKey =
    !isOAuthOnlyProvider &&
    ![
      ModelProviderEnum.Ollama,
      ModelProviderEnum.LMStudio,
      ModelProviderEnum.Bedrock,
      '',
    ].includes(baseInfo.id)
  const showNetworkCompatibility =
    baseInfo.isCustom ||
    baseInfo.id === ModelProviderEnum.Ollama ||
    (platform.type === 'web' &&
      (baseInfo.id === ModelProviderEnum.OpenCodeGo || baseInfo.id === ModelProviderEnum.OpenCodeZen))
  const customApiHost = normalizeAPIHost(providerSettings, baseInfo.type)
  const azureEndpoint = normalizeAzureEndpoint(providerSettings?.endpoint || baseInfo.defaultSettings?.endpoint || '')
  const hasConnectionSettings =
    baseInfo.isCustom ||
    (isDesktop && supportsOAuth) ||
    showApiKey ||
    BUILTIN_API_HOST_PROVIDERS.has(baseInfo.id) ||
    baseInfo.id === ModelProviderEnum.Azure ||
    baseInfo.id === ModelProviderEnum.Bedrock ||
    showNetworkCompatibility

  return (
    <SettingsPage
      key={baseInfo.id}
      titleOnTouch
      title={t(baseInfo.name)}
      description={
        (baseInfo.description || (baseInfo.isCustom && language === 'zh-Hans')) && (
          <>
            {baseInfo.description && t(baseInfo.description)}
            {baseInfo.isCustom && language === 'zh-Hans' && (
              <Anchor
                href="https://docs.chatboxai.app/guides/providers"
                target="_blank"
                rel="noopener"
                fz={13}
                className="inline-flex items-center gap-1"
              >
                <ScalableIcon icon={IconHelpCircle} size={14} />
                {t('Setup guide')}
              </Anchor>
            )}
          </>
        )
      }
      action={
        <Flex gap={4} align="center">
          {providerWebsite && (
            <Tooltip label={t('Website')} openDelay={300}>
              <ActionIcon
                variant="subtle"
                color="chatbox-gray"
                size="lg"
                aria-label={t('Website') ?? undefined}
                onClick={() => platform.openLink(providerWebsite)}
              >
                <ScalableIcon icon={IconExternalLink} size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          {baseInfo.isCustom && (
            <PopoverConfirm
              title={t('Confirm to delete this custom provider?')}
              confirmButtonColor="chatbox-error"
              onConfirm={() => {
                setSettings({
                  customProviders: customProviders?.filter((p) => p.id !== baseInfo.id),
                })
                navigate({ to: '/settings/provider', replace: true })
              }}
            >
              <ActionIcon
                data-testid={TestId.settings.providerDelete}
                variant="subtle"
                color="chatbox-error"
                size="lg"
                aria-label={t('Delete') ?? undefined}
              >
                <ScalableIcon icon={IconTrash} size={18} />
              </ActionIcon>
            </PopoverConfirm>
          )}
        </Flex>
      }
    >
      {hasConnectionSettings && (
        <SettingsSection title={t('Connection')}>
          {/* custom provider base info */}
          {baseInfo.isCustom && (
            <>
              <SettingRow
                id="provider-name"
                label={t('Name')}
                controlLayout="block"
                control={(fieldId) => (
                  <TextInput
                    id={fieldId}
                    data-testid={TestId.settings.providerName}
                    aria-label={t('Name') ?? undefined}
                    value={baseInfo.name}
                    onChange={(e) => {
                      setSettings({
                        customProviders: customProviders?.map((p) =>
                          p.id === baseInfo.id ? { ...p, name: e.currentTarget.value } : p
                        ),
                      })
                    }}
                  />
                )}
              />
              <SettingRow
                id="provider-api-mode"
                label={t('API Mode')}
                controlLayout="block"
                control={(fieldId) => (
                  <AdaptiveSelect
                    id={fieldId}
                    data-testid={TestId.settings.providerApiMode}
                    aria-label={t('API Mode') ?? undefined}
                    value={baseInfo.type}
                    onChange={(value) => {
                      setSettings({
                        customProviders: customProviders?.map((p) =>
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
                )}
              />
            </>
          )}

          {/* OAuth Login (Desktop only) */}
          {isDesktop && supportsOAuth && (
            <SettingRow
              id="provider-authentication"
              label={t('Authentication')}
              description={
                usesResponsesTransportForOAuth
                  ? t(
                      'When OAuth Login is enabled, OpenAI requests use the Responses transport instead of the legacy Chat Completions transport.'
                    )
                  : undefined
              }
              controlLayout="block"
              control={
                <Stack gap="xs">
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
                </Stack>
              }
            />
          )}

          {/* API Key */}
          {showApiKey && (
            <SettingRow
              id="provider-api-key"
              label={t('API Key')}
              description={isOAuthActive ? t('Using OAuth') : undefined}
              disabled={isOAuthActive}
              controlLayout="block"
              control={(fieldId) => (
                <Flex gap="xs" align="center">
                  <PasswordInput
                    id={fieldId}
                    data-testid={TestId.settings.providerApiKey}
                    aria-label={t('API Key') ?? undefined}
                    flex={1}
                    value={providerSettings?.apiKey || ''}
                    onChange={handleApiKeyChange}
                    disabled={isOAuthActive}
                  />
                  <Tooltip
                    openOnTouch
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
                      data-testid={TestId.settings.providerCheck}
                      variant="default"
                      size="sm"
                      disabled={isOAuthActive || !providerSettings?.apiKey || displayModels.length === 0}
                      loading={modelTestResult?.testing || false}
                      onClick={() => setShowTestModelSelector(true)}
                    >
                      {t('Check')}
                    </Button>
                  </Tooltip>
                </Flex>
              )}
            />
          )}

          {/* API Host */}
          {BUILTIN_API_HOST_PROVIDERS.has(baseInfo.id) && (
            <SettingRow
              id="provider-api-host"
              label={t('API Host')}
              disabled={isOAuthActive}
              controlLayout="block"
              control={(fieldId) => (
                <Stack gap={4}>
                  <TextInput
                    id={fieldId}
                    data-testid={TestId.settings.providerApiHost}
                    aria-label={t('API Host') ?? undefined}
                    disabled={isOAuthActive}
                    value={providerSettings?.apiHost || baseInfo.defaultSettings?.apiHost || ''}
                    onChange={handleApiHostChange}
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <Text span fz={12} c="chatbox-tertiary" className="break-all">
                    {t('Preview')}: {normalizedBuiltinApiHost.apiHost + normalizedBuiltinApiHost.apiPath}
                  </Text>
                </Stack>
              )}
            />
          )}

          {/* custom provider api host & path */}
          {baseInfo.isCustom && (
            <>
              <SettingRow
                id="provider-api-host"
                label={t('API Host')}
                controlLayout="block"
                control={(fieldId) => (
                  <Stack gap={4}>
                    <TextInput
                      id={fieldId}
                      data-testid={TestId.settings.providerApiHost}
                      aria-label={t('API Host') ?? undefined}
                      value={providerSettings?.apiHost}
                      placeholder={baseInfo.defaultSettings?.apiHost}
                      onChange={handleApiHostChange}
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    {providerSettings?.apiHost?.includes('aihubmix.com') && (
                      <Flex align="center" gap={4}>
                        <ScalableIcon icon={IconDiscount2} size={14} color="var(--chatbox-tint-tertiary)" />
                        <Text span fz={12} c="chatbox-tertiary">
                          {t('AIHubMix integration in Chatbox offers 10% discount')}
                        </Text>
                      </Flex>
                    )}
                  </Stack>
                )}
              />
              <SettingRow
                id="provider-api-path"
                label={t('API Path')}
                controlLayout="block"
                control={(fieldId) => (
                  <Stack gap={4}>
                    <TextInput
                      id={fieldId}
                      data-testid={TestId.settings.providerApiPath}
                      aria-label={t('API Path') ?? undefined}
                      value={providerSettings?.apiPath}
                      onChange={handleApiPathChange}
                      placeholder={customApiHost.apiPath}
                    />
                    <Text span fz={12} c="chatbox-tertiary" className="break-all">
                      {t('Preview')}: {customApiHost.apiHost + customApiHost.apiPath}
                    </Text>
                  </Stack>
                )}
              />
            </>
          )}

          {baseInfo.id === ModelProviderEnum.Azure && (
            <>
              <SettingRow
                id="provider-azure-endpoint"
                label={t('Azure Endpoint')}
                controlLayout="block"
                control={(fieldId) => (
                  <Stack gap={4}>
                    <TextInput
                      id={fieldId}
                      data-testid={TestId.settings.providerAzureEndpoint}
                      aria-label={t('Azure Endpoint') ?? undefined}
                      value={providerSettings?.endpoint}
                      placeholder="https://<resource_name>.openai.azure.com/"
                      onChange={(e) =>
                        setProviderSettings({
                          endpoint: e.currentTarget.value,
                        })
                      }
                    />
                    <Text span fz={12} c="chatbox-tertiary" className="break-all">
                      {azureEndpoint.endpoint + azureEndpoint.apiPath}
                    </Text>
                  </Stack>
                )}
              />
              <SettingRow
                id="provider-azure-api-version"
                label={t('Azure API Version')}
                controlLayout="block"
                control={(fieldId) => (
                  <TextInput
                    id={fieldId}
                    data-testid={TestId.settings.providerAzureApiVersion}
                    aria-label={t('Azure API Version') ?? undefined}
                    value={providerSettings?.apiVersion}
                    placeholder="v1"
                    onChange={(e) =>
                      setProviderSettings({
                        apiVersion: e.currentTarget.value,
                      })
                    }
                  />
                )}
              />
            </>
          )}

          {/* AWS Bedrock Credentials */}
          {baseInfo.id === ModelProviderEnum.Bedrock && (
            <>
              <SettingRow
                id="provider-aws-access-key"
                label={t('AWS Access Key ID')}
                controlLayout="block"
                control={(fieldId) => (
                  <PasswordInput
                    id={fieldId}
                    aria-label={t('AWS Access Key ID') ?? undefined}
                    value={providerSettings?.accessKey || ''}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                    onChange={(e) =>
                      setProviderSettings({
                        accessKey: e.currentTarget.value,
                      })
                    }
                  />
                )}
              />
              <SettingRow
                id="provider-aws-secret-key"
                label={t('AWS Secret Access Key')}
                controlLayout="block"
                control={(fieldId) => (
                  <PasswordInput
                    id={fieldId}
                    aria-label={t('AWS Secret Access Key') ?? undefined}
                    value={providerSettings?.secretKey || ''}
                    placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                    onChange={(e) =>
                      setProviderSettings({
                        secretKey: e.currentTarget.value,
                      })
                    }
                  />
                )}
              />
              <SettingRow
                id="provider-aws-region"
                label={t('AWS Region')}
                controlLayout="block"
                control={(fieldId) => (
                  <Flex gap="xs" align="center">
                    <TextInput
                      id={fieldId}
                      aria-label={t('AWS Region') ?? undefined}
                      flex={1}
                      value={providerSettings?.region || ''}
                      placeholder="us-east-1"
                      onChange={(e) =>
                        setProviderSettings({
                          region: e.currentTarget.value,
                        })
                      }
                    />
                    <Tooltip
                      openOnTouch
                      disabled={
                        !!providerSettings?.accessKey && !!providerSettings?.secretKey && displayModels.length > 0
                      }
                      label={
                        !providerSettings?.accessKey || !providerSettings?.secretKey
                          ? t('AWS Access Key ID and Secret Access Key are required to check connection')
                          : displayModels.length === 0
                            ? t('Add at least one model to check connection')
                            : null
                      }
                    >
                      <Button
                        data-testid={TestId.settings.providerCheck}
                        variant="default"
                        size="sm"
                        disabled={
                          !providerSettings?.accessKey || !providerSettings?.secretKey || displayModels.length === 0
                        }
                        loading={modelTestResult?.testing || false}
                        onClick={() => setShowTestModelSelector(true)}
                      >
                        {t('Check')}
                      </Button>
                    </Tooltip>
                  </Flex>
                )}
              />
            </>
          )}

          {/* Network compatibility */}
          {showNetworkCompatibility && (
            <SettingSwitchRow
              id="provider-network-compatibility"
              label={t('Improve Network Compatibility')}
              description={t('Only enable this when necessary, as it may reduce connection speed.')}
              checked={providerSettings?.useProxy || false}
              onChange={(checked) => setProviderSettings({ useProxy: checked })}
            />
          )}
        </SettingsSection>
      )}

      {/* Models */}
      <SettingsSection
        bare
        title={t('Model')}
        action={
          !isSystemManagedModelList && (
            <Flex gap={4} align="center" justify="flex-end">
              <Button
                data-testid={TestId.settings.providerModelNew}
                variant="light"
                size="compact-sm"
                onClick={handleAddModel}
                leftSection={<ScalableIcon icon={IconPlus} size={14} />}
              >
                {t('New')}
              </Button>
              <Button
                data-testid={TestId.settings.providerModelReset}
                variant="subtle"
                color="chatbox-gray"
                size="compact-sm"
                onClick={resetModels}
                leftSection={<ScalableIcon icon={IconRestore} size={14} />}
              >
                {t('Reset')}
              </Button>
              <Button
                data-testid={TestId.settings.providerModelFetch}
                loading={fetchingModels}
                variant="subtle"
                color="chatbox-gray"
                size="compact-sm"
                onClick={handleFetchModels}
                leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
              >
                {t('Fetch')}
              </Button>
            </Flex>
          )
        }
      >
        <ModelList
          models={displayModels}
          showActions={!isSystemManagedModelList}
          showSearch={false}
          onEditModel={editModel}
          onDeleteModel={deleteModel}
        />
      </SettingsSection>

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
                          <Tooltip label={modelTestResult.visionTest.error} multiline openOnTouch>
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
                          <Tooltip label={modelTestResult.toolTest.error} multiline openOnTouch>
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
                    {t(
                      'Connection failed! Please make sure the API key was copied completely, has no extra spaces, has sufficient balance, matches the provider, and has not expired.'
                    )}
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
    </SettingsPage>
  )
}
