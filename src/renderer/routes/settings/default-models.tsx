/** biome-ignore-all lint/style/noNonNullAssertion: auto-text fallbacks are always defined for these selectors */

import NiceModal from '@ebay/nice-modal-react'
import { Anchor, Button, Flex, Stack, Text, Title } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { SystemProviders } from '@shared/defaults'
import type { ProviderModelInfo } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import type { DocumentParserType } from '@shared/types/settings'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBolt,
  IconCircleCheck,
  IconDatabase,
  IconFileText,
  IconLoader2,
  IconMessages,
  IconMicrophone,
  IconPhoto,
  IconPlayerPlay,
  IconScan,
  IconSelector,
  IconSortDescending,
  IconSparkles,
  IconVolume,
  IconWorldWww,
} from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { forwardRef, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createModelDependencies } from '@/adapters'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { ImageModelSelect } from '@/components/ImageModelSelect'
import ModelSelectorV2 from '@/components/ModelSelectorV2'
import type { ImageModelGroup } from '@/hooks/useImageModelGroups'
import { useImageModelGroups } from '@/hooks/useImageModelGroups'
import { useProviders } from '@/hooks/useProviders'
import { enrichModelsFromRegistry, useModelRegistryVersion } from '@/packages/model-registry'
import { testWebSearchConnection } from '@/packages/web-search'
import { WEB_SEARCH_PROVIDERS, type WebSearchProviderValue } from '@/packages/web-search/constants'
import platform from '@/platform'
import { lastUsedModelStore, useLastUsedModelStore } from '@/stores/lastUsedModelStore'
import { getPlatformDefaultDocumentParser, settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { pingModel } from '@/utils/model-tester'
import { isEmbeddingModel, isRerankModel } from './-defaultModelFilters'
import {
  applyAllPresetsExtension,
  applyAllPresetsSettings,
  customParserTypes,
  effectiveParserType,
  extensionWithParserType,
  extensionWithSearchProvider,
  FUTURE_SLOT_IDS,
  getSlotModelRef,
  MODEL_RIG_SLOT_IDS,
  type ModelRef,
  type ModelRigSlotId,
  type ModelSlotId,
  searchProvider,
  settingsPatchForModelSlot,
} from './-modelRigSettings'
import { runSlotTest, type SlotTestStatus } from './-modelRigTest'
import { modelEndpointLocation } from './-modelSource'

export const Route = createFileRoute('/settings/default-models')({
  component: RouteComponent,
})

type SlotUiState = { status: SlotTestStatus; latencyMs: number; error?: string; fix?: string }

const IDLE_SLOT: SlotUiState = { status: 'idle', latencyMs: 0 }

const ACTIVE_SLOT_IDS = MODEL_RIG_SLOT_IDS.filter((id) => !FUTURE_SLOT_IDS.has(id))

const GROUPS: { title: string; hint: string; slotIds: ModelRigSlotId[] }[] = [
  { title: 'Conversations', hint: 'Default models for chats and everyday tasks.', slotIds: ['llm', 'fast'] },
  { title: 'Images & documents', hint: 'Make attachments readable by your models.', slotIds: ['ocr', 'parser'] },
  {
    title: 'Knowledge & search',
    hint: 'Find relevant information in documents and on the web.',
    slotIds: ['embedding', 'rerank', 'search'],
  },
  { title: 'Image creation', hint: 'Choose the model used in Image Creator.', slotIds: ['image'] },
]

const SLOT_COPY: Record<ModelRigSlotId, { name: string; desc: string }> = {
  llm: { name: 'Default chat model', desc: 'Used for new chats. You can choose a different model in each chat.' },
  fast: {
    name: 'Fast model',
    desc: 'Used to automatically generate conversation titles. Choose a model with fast responses.',
  },
  ocr: {
    name: 'Image text recognition (OCR)',
    desc: 'Extracts text from images when the chat model cannot read them directly.',
  },
  parser: {
    name: 'Document parsing',
    desc: 'Extracts content from uploaded files. Supported formats depend on the selected service.',
  },
  asr: { name: 'Speech recognition', desc: 'Convert speech to text.' },
  embedding: {
    name: 'Knowledge search (Embedding)',
    desc: 'Converts text into vectors to find related content in your documents.',
  },
  rerank: {
    name: 'Search ranking (Rerank)',
    desc: 'Ranks retrieved passages so the most relevant content is used in answers.',
  },
  search: { name: 'Web search', desc: 'Searches the web when web search is enabled in a conversation.' },
  image: {
    name: 'Image generation',
    desc: 'Used in Image Creator. Changing the model there also updates this selection.',
  },
  tts: { name: 'Speech synthesis', desc: 'Read replies aloud.' },
}

const SLOT_ICONS = {
  llm: IconMessages,
  fast: IconBolt,
  ocr: IconScan,
  parser: IconFileText,
  asr: IconMicrophone,
  embedding: IconDatabase,
  rerank: IconSortDescending,
  search: IconWorldWww,
  image: IconPhoto,
  tts: IconVolume,
} as const

const PARSER_OPTION_LABELS: Record<string, string> = {
  'chatbox-ai': 'Chatbox AI',
  local: 'Built-in parser',
  mineru: 'MinerU',
}

function isChatType(model: ProviderModelInfo) {
  return !model.type || model.type === 'chat'
}

function idleResults(): Record<ModelRigSlotId, SlotUiState> {
  return Object.fromEntries(MODEL_RIG_SLOT_IDS.map((id) => [id, { ...IDLE_SLOT }])) as Record<
    ModelRigSlotId,
    SlotUiState
  >
}

export function RouteComponent() {
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state)
  const setSettings = settings.setSettings
  const picture = useLastUsedModelStore((state) => state.picture)
  const setPictureModel = useLastUsedModelStore((state) => state.setPictureModel)
  const imageModelGroups = useImageModelGroups()
  const { providers } = useProviders()
  const [results, setResults] = useState(idleResults)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)

  const licenseKey = settings.licenseKey
  const chatboxAIAutoText = licenseKey ? t('Auto (Use Chatbox AI)')! : t('None')!

  const chatboxImageGroups = useMemo(
    () => imageModelGroups.filter((group) => group.providerId === ModelProviderEnum.ChatboxAI),
    [imageModelGroups]
  )
  const customImageGroups = useMemo(
    () => imageModelGroups.filter((group) => group.providerId !== ModelProviderEnum.ChatboxAI),
    [imageModelGroups]
  )

  const pingChat = useCallback(async (provider: string, modelId: string, vision?: boolean) => {
    const configs = await platform.getConfig()
    const dependencies = await createModelDependencies()
    const result = await pingModel({
      providerId: provider,
      modelId,
      settings: settingsStore.getState(),
      configs,
      dependencies,
      vision,
      signal: AbortSignal.timeout(20_000),
    })
    if (!result.ok) {
      throw new Error(result.error || 'Model test failed')
    }
  }, [])

  const makeDeps = useCallback(
    () => ({
      settings: settingsStore.getState(),
      configuredProviderIds: new Set(providers.map((provider) => provider.id)),
      picture: lastUsedModelStore.getState().picture,
      hasLicense: Boolean(settingsStore.getState().licenseKey),
      isDesktopLike: platform.isDesktopLike,
      pingChat,
      testMineru: async (token: string) => {
        const result = await platform.getKnowledgeBaseController().testMineruConnection(token)
        return result.success
      },
      searchWeb: async () => {
        await testWebSearchConnection(AbortSignal.timeout(20_000))
      },
    }),
    [pingChat, providers]
  )

  const testSlot = useCallback(
    async (slotId: ModelRigSlotId) => {
      if (runningRef.current) return
      runningRef.current = true
      setRunning(true)
      try {
        setResults((prev) => ({ ...prev, [slotId]: { status: 'testing', latencyMs: 0 } }))
        const result = await runSlotTest(slotId, makeDeps())
        setResults((prev) => ({ ...prev, [slotId]: result }))
      } finally {
        setRunning(false)
        runningRef.current = false
      }
    },
    [makeDeps]
  )

  const runAll = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setResults(idleResults())
    for (const slotId of ACTIVE_SLOT_IDS) {
      setResults((prev) => ({ ...prev, [slotId]: { status: 'testing', latencyMs: 0 } }))
      const result = await runSlotTest(slotId, makeDeps())
      setResults((prev) => ({ ...prev, [slotId]: result }))
    }
    setRunning(false)
    runningRef.current = false
  }, [makeDeps])

  const applyAllPresets = useCallback(() => {
    const current = settingsStore.getState()
    setSettings({
      ...applyAllPresetsSettings(),
      extension: applyAllPresetsExtension(current),
    })
    const firstChatboxImage = imageModelGroups.find((group) => group.providerId === ModelProviderEnum.ChatboxAI)
      ?.models[0]
    if (firstChatboxImage) {
      setPictureModel(ModelProviderEnum.ChatboxAI, firstChatboxImage.modelId)
    } else {
      lastUsedModelStore.setState({ picture: undefined })
    }
    setResults(idleResults())
  }, [imageModelGroups, setPictureModel, setSettings])

  const setModelSlot = useCallback(
    (slotId: ModelSlotId, provider?: string, model?: string) => {
      setSettings(settingsPatchForModelSlot(slotId, provider && model ? { provider, model } : undefined))
      setResults((prev) => ({ ...prev, [slotId]: { ...IDLE_SLOT } }))
    },
    [setSettings]
  )

  const tested = ACTIVE_SLOT_IDS.filter((id) => results[id].status === 'ok' || results[id].status === 'fail')
  const okCount = ACTIVE_SLOT_IDS.filter((id) => results[id].status === 'ok').length
  const failCount = ACTIVE_SLOT_IDS.filter((id) => results[id].status === 'fail').length
  const progressWidth = `${Math.round((tested.length / ACTIVE_SLOT_IDS.length) * 100)}%`

  return (
    <Stack p="md" gap="xl" className="max-w-[880px]">
      <Stack gap="xs">
        <Title order={4}>{t('Models & services')}</Title>
        <Text c="chatbox-secondary" size="sm">
          {t('Choose which model or service each feature uses. Changes are saved automatically.')}
        </Text>
        <Stack gap={4} mt={4}>
          <Anchor
            component={Link}
            to="/settings/provider"
            size="sm"
            fw={500}
            className="self-start inline-flex items-center gap-1"
          >
            {t('Manage model providers')}
            <ScalableIcon icon={IconArrowRight} size={14} />
          </Anchor>
          <Text size="xs" c="chatbox-tertiary">
            {t('Connect remote providers or a local service such as Ollama.')}
          </Text>
        </Stack>
      </Stack>

      <Stack gap="sm" p="md" className="border border-solid border-chatbox-border-primary rounded-xl">
        <Flex align="center" justify="space-between" gap="sm" wrap="wrap">
          <Stack gap={4} className="flex-1 min-w-[160px]">
            <Text fw={600} size="sm">
              {t('Check your setup')}
            </Text>
            <Text size="xs" c="chatbox-tertiary">
              {t(
                'Connection tests send a short request and may use credits. Configuration checks do not run the model.'
              )}
            </Text>
          </Stack>
          <Button
            variant="light"
            color="chatbox-brand"
            size="sm"
            data-testid={TestId.settings.modelRigTestAll}
            leftSection={<ScalableIcon icon={IconPlayerPlay} size={16} />}
            onClick={() => void runAll()}
            loading={running}
          >
            {t('Check all')}
          </Button>
        </Flex>
        {(running || tested.length > 0) && (
          <Stack gap={6} role="status" aria-live="polite">
            <Text size="xs" c="chatbox-secondary">
              {running
                ? t('Checking {{done}} of {{total}}…', { done: tested.length, total: ACTIVE_SLOT_IDS.length })
                : t('{{ok}} passed · {{fail}} need attention', { ok: okCount, fail: failCount })}
            </Text>
            <div className="h-1 rounded-full bg-chatbox-background-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--chatbox-brand)] transition-[width] duration-300"
                style={{ width: progressWidth }}
              />
            </div>
          </Stack>
        )}
      </Stack>

      {GROUPS.map((group) => (
        <Stack key={group.title} gap="sm">
          <Stack gap={2}>
            <Text fw={600}>{t(group.title)}</Text>
            <Text size="xs" c="chatbox-tertiary">
              {t(group.hint)}
            </Text>
          </Stack>
          {group.slotIds.map((slotId) => {
            const copy = SLOT_COPY[slotId]
            const future = FUTURE_SLOT_IDS.has(slotId)
            const parserDefault = getPlatformDefaultDocumentParser().type
            const parser = effectiveParserType(settings, parserDefault)
            const result = results[slotId]
            const search = searchProvider(settings)
            return (
              <SlotCard
                key={slotId}
                slotId={slotId}
                name={t(copy.name)}
                desc={t(copy.desc)}
                future={future}
                result={result}
                parser={parser}
                search={search}
                picture={picture}
                chatboxImageGroups={chatboxImageGroups}
                customImageGroups={customImageGroups}
                licenseKey={licenseKey}
                chatboxAIAutoText={chatboxAIAutoText}
                running={running}
                onTest={() => void testSlot(slotId)}
                onSelectModel={(provider, model) => {
                  if (
                    slotId === 'llm' ||
                    slotId === 'fast' ||
                    slotId === 'ocr' ||
                    slotId === 'embedding' ||
                    slotId === 'rerank'
                  ) {
                    setModelSlot(slotId, provider, model)
                  }
                }}
                onSelectParser={(type) => {
                  setSettings({ extension: extensionWithParserType(settingsStore.getState(), type) })
                  setResults((prev) => ({ ...prev, parser: { ...IDLE_SLOT } }))
                }}
                onSelectSearch={(provider) => {
                  setSettings({ extension: extensionWithSearchProvider(settingsStore.getState(), provider) })
                  setResults((prev) => ({ ...prev, search: { ...IDLE_SLOT } }))
                }}
                onSelectImage={(provider, model) => {
                  setPictureModel(provider, model)
                  setResults((prev) => ({ ...prev, image: { ...IDLE_SLOT } }))
                }}
              />
            )
          })}
        </Stack>
      ))}
      <Stack gap="xs" pt="sm" className="border-0 border-t border-solid border-chatbox-border-primary">
        <Text size="sm" fw={500}>
          {t('Speech recognition & speech synthesis')}
        </Text>
        <Text size="xs" c="chatbox-tertiary">
          {t('Not available yet. No setup is needed.')}
        </Text>
      </Stack>
      <Button
        variant="subtle"
        color="gray"
        size="compact-sm"
        className="self-start"
        disabled={running}
        data-testid={TestId.settings.modelRigApplyPresets}
        leftSection={<ScalableIcon icon={IconSparkles} size={14} />}
        onClick={() =>
          void NiceModal.show('confirm', {
            title: t('Reset model selections?'),
            message: t(
              'This replaces your selections on this page with automatic models and Chatbox services. Your provider credentials are kept. Some services require Chatbox AI.'
            ),
            confirmText: t('Reset selections'),
            cancelText: t('Cancel'),
            onConfirm: applyAllPresets,
          })
        }
      >
        {t('Reset selections')}
      </Button>
    </Stack>
  )
}

function SlotCard(props: {
  slotId: ModelRigSlotId
  name: string
  desc: string
  future: boolean
  result: SlotUiState
  parser: DocumentParserType
  search: WebSearchProviderValue
  picture?: { provider: string; modelId: string }
  chatboxImageGroups: ImageModelGroup[]
  customImageGroups: ImageModelGroup[]
  licenseKey?: string
  chatboxAIAutoText: string
  running: boolean
  onTest: () => void
  onSelectModel: (provider?: string, model?: string) => void
  onSelectParser: (type: DocumentParserType) => void
  onSelectSearch: (provider: WebSearchProviderValue) => void
  onSelectImage: (provider: string, model: string) => void
}) {
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state)
  const Icon = SLOT_ICONS[props.slotId]
  const modelSlot = isModelSlot(props.slotId) ? props.slotId : undefined
  const selection = modelSlot ? getSlotModelRef(modelSlot, settings) : undefined
  const autoText = autoTextForSlot(props.slotId, props.licenseKey, t, props.chatboxAIAutoText)
  const modelText = displayTextForSlot(props, autoText, t)

  return (
    <Stack
      gap="sm"
      p="md"
      className="border border-solid border-chatbox-border-primary rounded-xl bg-chatbox-background-primary"
    >
      <Flex align="center" gap="sm" wrap="wrap">
        <Flex
          align="center"
          justify="center"
          w={36}
          h={36}
          className="rounded-lg bg-chatbox-background-gray-secondary shrink-0"
        >
          <ScalableIcon icon={Icon} size={20} className="text-chatbox-tint-secondary" />
        </Flex>
        <Stack gap={2} className="flex-1 min-w-[160px]">
          <Flex align="center" gap="xs" wrap="wrap">
            <Text fw={600}>{props.name}</Text>
            {props.future && (
              <Text
                size="xs"
                className="px-2 py-px rounded-full bg-[var(--chatbox-background-warning-secondary)] text-[var(--chatbox-tint-warning)]"
              >
                {t('Coming soon')}
              </Text>
            )}
          </Flex>
          <Text size="xs" c="chatbox-tertiary">
            {props.desc}
          </Text>
        </Stack>
      </Flex>

      <Flex align="center" gap="xs" wrap="wrap">
        <fieldset className="w-full sm:w-[320px] min-w-0 m-0 p-0 border-0 [&>button]:w-full" disabled={props.running}>
          <SlotSelector {...props} selection={selection} autoText={autoText} modelText={modelText} />
        </fieldset>
        <Button
          variant="default"
          size="sm"
          onClick={props.onTest}
          disabled={props.running || props.result.status === 'testing'}
          aria-label={t('Check {{name}}', { name: props.name })}
        >
          {t(isConnectionCheck(props.slotId, selection, props.parser) ? 'Test connection' : 'Check configuration')}
        </Button>
        <SlotStatus result={props.result} connection={isConnectionCheck(props.slotId, selection, props.parser)} />
      </Flex>

      <Text size="xs" c="chatbox-tertiary">
        {t(
          sourceForSlot(
            props.slotId,
            props.slotId === 'image' ? props.picture?.provider : selection?.provider,
            settings,
            props.parser
          )
        )}
      </Text>
      {props.slotId === 'parser' && (
        <Button
          component={Link}
          to="/settings/document-parser"
          variant="subtle"
          size="compact-xs"
          className="self-start"
        >
          {t('Document parser settings')}
        </Button>
      )}
      {props.slotId === 'search' && (
        <Button component={Link} to="/settings/web-search" variant="subtle" size="compact-xs" className="self-start">
          {t('Web search settings')}
        </Button>
      )}
      {props.result.status === 'fail' && (props.result.error || props.result.fix) && (
        <Stack
          gap={4}
          px="sm"
          py="xs"
          className="border-0 border-l-2 border-solid border-[var(--chatbox-tint-error)] rounded-r-lg bg-[var(--chatbox-background-error-secondary)]"
        >
          <Text size="xs" fw={600} c="chatbox-error">
            {props.result.error ? t(props.result.error) : null}
          </Text>
          {props.result.fix && (
            <Text size="xs" c="chatbox-secondary">
              {t('Suggested action')}: {t(props.result.fix)}
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  )
}

function SlotSelector(
  props: Parameters<typeof SlotCard>[0] & { selection?: ModelRef; autoText: string; modelText: string }
) {
  const { t } = useTranslation()
  if (props.future) {
    return (
      <Flex
        px={12}
        py={6}
        align="center"
        c="chatbox-tertiary"
        w={320}
        className="border-solid border border-chatbox-border-primary rounded-lg bg-transparent opacity-70"
      >
        <Text span flex={1} className="text-left">
          {t('Not available yet')}
        </Text>
        <ScalableIcon icon={IconSelector} className="text-inherit" />
      </Flex>
    )
  }

  if (props.slotId === 'parser') {
    const options = withCurrentOption(
      ['chatbox-ai', ...customParserTypes(parserHost())].map((value) => ({
        value,
        label: t(PARSER_OPTION_LABELS[value]),
      })),
      props.parser,
      t(PARSER_OPTION_LABELS[props.parser] || props.parser)
    )
    return (
      <AdaptiveSelect
        comboboxProps={{ withinPortal: true, withArrow: true }}
        data={options}
        value={props.parser}
        onChange={(value) => value && props.onSelectParser(value as DocumentParserType)}
        w="100%"
        allowDeselect={false}
      />
    )
  }

  if (props.slotId === 'search') {
    const options = WEB_SEARCH_PROVIDERS.map((item) => ({
      value: item.value,
      label: item.value === 'build-in' ? t('Chatbox AI Search') : item.label,
    }))
    return (
      <AdaptiveSelect
        comboboxProps={{ withinPortal: true, withArrow: true }}
        data={options}
        value={props.search}
        onChange={(value) => value && props.onSelectSearch(value as WebSearchProviderValue)}
        w="100%"
        allowDeselect={false}
      />
    )
  }

  if (props.slotId === 'image') {
    const groups = [...props.chatboxImageGroups, ...props.customImageGroups]
    return (
      <ImageModelSelect
        position="bottom-start"
        width={320}
        withinPortal
        modelGroups={groups}
        onSelect={props.onSelectImage}
      >
        <ModelSelectContent autoText={props.autoText} displayText={props.modelText} asDiv />
      </ImageModelSelect>
    )
  }

  const modelFilter = modelFilterForSlot(props.slotId)
  return (
    <ModelSelectorV2
      position="bottom-start"
      transitionProps={{ transition: 'fade-down', duration: 200 }}
      keepMounted
      width={320}
      showAuto
      autoText={props.autoText}
      modelFilter={modelFilter}
      selectedProviderId={props.selection?.provider}
      selectedModelId={props.selection?.model}
      searchPosition="top"
      onSelect={(provider, model) => props.onSelectModel(provider || undefined, model || undefined)}
    >
      <ModelSelectContent
        autoText={props.autoText}
        provider={props.selection?.provider}
        model={props.selection?.model}
        modelType={props.slotId === 'embedding' ? 'embedding' : props.slotId === 'rerank' ? 'rerank' : 'chat'}
        testId={props.slotId === 'llm' ? TestId.settings.defaultChatModel : undefined}
      />
    </ModelSelectorV2>
  )
}

function SlotStatus({ result, connection }: { result: SlotUiState; connection: boolean }) {
  const { t } = useTranslation()
  if (result.status === 'testing') {
    return (
      <Flex align="center" gap={6}>
        <ScalableIcon icon={IconLoader2} size={14} className="text-chatbox-tint-tertiary animate-spin" />
        <Text size="xs" c="chatbox-tertiary">
          {t('Testing…')}
        </Text>
      </Flex>
    )
  }
  if (result.status === 'ok') {
    return (
      <Flex
        align="center"
        gap={6}
        className="px-2.5 py-0.5 rounded-full bg-[var(--chatbox-background-success-secondary)] text-[var(--chatbox-tint-success)]"
      >
        <ScalableIcon icon={IconCircleCheck} size={14} />
        <Text size="xs">
          {t(connection ? 'Connected' : 'Configuration checked')}
          {result.latencyMs ? ` · ${result.latencyMs} ms` : ''}
        </Text>
      </Flex>
    )
  }
  if (result.status === 'fail') {
    return (
      <Flex
        align="center"
        gap={6}
        className="px-2.5 py-0.5 rounded-full bg-[var(--chatbox-background-error-secondary)] text-[var(--chatbox-tint-error)]"
      >
        <ScalableIcon icon={IconAlertTriangle} size={14} />
        <Text size="xs">
          {t('Needs attention')}
          {result.latencyMs ? ` · ${result.latencyMs} ms` : ''}
        </Text>
      </Flex>
    )
  }
  return (
    <Text size="xs" c="chatbox-tertiary">
      {t('Not tested yet')}
    </Text>
  )
}

function parserHost() {
  return { isDesktopLike: platform.isDesktopLike, isMobile: platform.type === 'mobile' }
}

function withCurrentOption(options: { value: string; label: string }[], value: string, label: string) {
  if (!value || options.some((item) => item.value === value)) return options
  return [{ value, label }, ...options]
}

function isModelSlot(slotId: ModelRigSlotId): slotId is ModelSlotId {
  return slotId === 'llm' || slotId === 'fast' || slotId === 'ocr' || slotId === 'embedding' || slotId === 'rerank'
}

function autoTextForSlot(
  slotId: ModelRigSlotId,
  licenseKey: string | undefined,
  t: (key: string) => string,
  chatboxAIAutoText: string
) {
  if (slotId === 'llm') return t('Auto (Use Last Used)')
  if (slotId === 'fast') return t('Auto (Use Chat Model)')
  if (slotId === 'image') return licenseKey ? t('Chatbox AI / Image model') : t('None')
  return chatboxAIAutoText
}

function displayTextForSlot(props: Parameters<typeof SlotCard>[0], autoText: string, t: (key: string) => string) {
  if (props.slotId === 'parser') return t(PARSER_OPTION_LABELS[props.parser] || props.parser)
  if (props.slotId === 'search') {
    if (props.search === 'build-in') return t('Chatbox AI Search')
    return WEB_SEARCH_PROVIDERS.find((item) => item.value === props.search)?.label || props.search
  }
  if (props.slotId === 'image') {
    if (!props.picture) return autoText
    const groups = [...props.chatboxImageGroups, ...props.customImageGroups]
    const group = groups.find((item) => item.providerId === props.picture?.provider)
    const model = group?.models.find((item) => item.modelId === props.picture?.modelId)
    return `${group?.label || props.picture.provider} / ${model?.displayName || props.picture.modelId}`
  }
  return autoText
}

function isConnectionCheck(slotId: ModelRigSlotId, selection: ModelRef | undefined, parser: DocumentParserType) {
  return (
    (slotId === 'llm' && Boolean(selection)) ||
    slotId === 'ocr' ||
    slotId === 'search' ||
    (slotId === 'fast' && Boolean(selection)) ||
    (slotId === 'parser' && parser === 'mineru')
  )
}

function sourceForSlot(
  slotId: ModelRigSlotId,
  provider: string | undefined,
  settings: ReturnType<typeof settingsStore.getState>,
  parser: DocumentParserType
) {
  if (slotId === 'parser')
    return parser === 'mineru'
      ? 'Remote service'
      : parser === 'local'
        ? 'Built-in parsing. Image recognition may use the selected OCR provider.'
        : 'Uses local parsing where supported, with Chatbox cloud parsing as a fallback.'
  if (slotId === 'search') return 'Search requests are sent to the selected service.'
  if (!provider) return 'Automatic selection follows the defaults for this feature.'
  if (provider === ModelProviderEnum.Local) return 'On-device model'
  const endpoint =
    settings.providers?.[provider]?.apiHost ||
    SystemProviders().find((item) => item.id === provider)?.defaultSettings?.apiHost
  return modelEndpointLocation(endpoint, provider === ModelProviderEnum.ChatboxAI)
}

function modelFilterForSlot(slotId: ModelRigSlotId) {
  return (model: ProviderModelInfo) => {
    if (slotId === 'embedding') return isEmbeddingModel(model)
    if (slotId === 'rerank') return isRerankModel(model)
    if (slotId === 'ocr') return Boolean(model.capabilities?.includes('vision'))
    return isChatType(model)
  }
}

const ModelSelectContent = forwardRef<
  HTMLButtonElement,
  {
    provider?: string
    model?: string
    autoText?: string
    displayText?: string
    onClick?: () => void
    modelType?: 'chat' | 'embedding' | 'rerank'
    testId?: string
    asDiv?: boolean
  }
>(({ provider, model, autoText, displayText, onClick, modelType, testId, asDiv }, ref) => {
  useModelRegistryVersion()

  const { t } = useTranslation()
  const customProviders = useSettingsStore((state) => state.customProviders)
  const providers = useSettingsStore((state) => state.providers)
  const modelOptions = useMemo(() => {
    if (!provider) return []
    const rawModels =
      providers?.[provider]?.models ||
      SystemProviders().find((candidate) => candidate.id === provider)?.defaultSettings?.models ||
      []
    return enrichModelsFromRegistry(rawModels, provider).filter((candidate) =>
      modelType ? candidate.type === modelType || (!candidate.type && modelType === 'chat') : true
    )
  }, [provider, providers, modelType])
  const resolvedText = useMemo(
    () =>
      displayText ||
      (!provider || !model
        ? autoText || t('Auto')
        : ([...SystemProviders(), ...(customProviders || [])].find((item) => item.id === provider)?.name || provider) +
          '/' +
          (modelOptions.find((candidate) => candidate.modelId === model)?.nickname || model)),
    [displayText, provider, model, autoText, t, customProviders, modelOptions]
  )
  const content = (
    <>
      <Text span flex={1} className="text-left break-all min-w-0">
        {resolvedText}
      </Text>
      <ScalableIcon icon={IconSelector} className="text-inherit shrink-0" />
    </>
  )
  const sharedProps = {
    px: 12,
    py: 6,
    align: 'center',
    gap: 8,
    w: '100%',
    c: 'chatbox-secondary',
    className: 'border-solid border border-chatbox-border-primary rounded-lg cursor-pointer bg-transparent',
  }
  if (asDiv) return <Flex {...sharedProps}>{content}</Flex>
  return (
    <Flex {...sharedProps} component="button" type="button" ref={ref} data-testid={testId} onClick={onClick}>
      {content}
    </Flex>
  )
})
