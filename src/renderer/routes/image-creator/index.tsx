import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import type { ImageGeneration } from '@shared/types'
import { ModelProviderEnum, ModelProviderType } from '@shared/types'
import {
  IconAspectRatio,
  IconChevronRight,
  IconHistory,
  IconPhoto,
  IconArrowUp,
  IconPlus,
  IconSparkles,
} from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CHATBOXAI_DEFAULT_IMAGE_MODEL, ImageModelSelect } from '@/components/ImageModelSelect'
import Page from '@/components/layout/Page'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { getLogger } from '@/lib/utils'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { cancelGeneration, createAndGenerate, resumeGeneration, retryGeneration } from '@/stores/imageGenerationActions'
import {
  deleteRecord,
  IMAGE_GEN_LIST_QUERY_KEY,
  imageGenerationStore,
  useCurrentGeneratingId,
  useCurrentRecordId,
  useImageGenerationHistory,
  useImageGenerationRecord,
} from '@/stores/imageGenerationStore'
import { queryClient } from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import * as toastActions from '@/stores/toastActions'
import {
  CHATBOXAI_IMAGE_MODEL_IDS,
  GEMINI_IMAGE_MODEL_IDS,
  getRatioOptionsForModel,
  HISTORY_PANEL_WIDTH,
  IMAGE_MODEL_FALLBACK_NAMES,
  MAX_REFERENCE_IMAGES,
  OPENAI_IMAGE_MODEL_IDS,
} from './-components/constants'
import { EmptyState } from './-components/EmptyState'
import { GeneratedImagesGallery } from './-components/GeneratedImagesGallery'
import { HistoryPanel } from './-components/HistoryPanel'
import { ImageGenerationErrorTips } from './-components/ImageGenerationErrorTips'
import { MobileHistoryDrawer, MobileModelDrawer, MobileRatioDrawer } from './-components/MobileDrawers'
import { PromptDisplay } from './-components/PromptDisplay'
import { ReferenceImagesPreview } from './-components/ReferenceImagesPreview'
import { LoadingShimmer } from './-components/Shimmer'

const log = getLogger('image-creator')

export const Route = createFileRoute('/image-creator/')({
  component: ImageCreatorPage,
})

/* ============================================
   Input Toolbar (Model/Ratio/Reference buttons)
   ============================================ */

interface InputToolbarProps {
  isSmallScreen: boolean
  modelDisplayName: string
  selectedRatio: string
  ratioOptions: string[]
  onModelDrawerOpen: () => void
  onRatioDrawerOpen: () => void
  onRatioSelect: (ratio: string) => void
  onModelSelect: (provider: string, model: string) => void
  onAddReference: () => void
  onNewCreation: () => void
}

function InputToolbar({
  isSmallScreen,
  modelDisplayName,
  selectedRatio,
  ratioOptions,
  onModelDrawerOpen,
  onRatioDrawerOpen,
  onRatioSelect,
  onModelSelect,
  onAddReference,
  onNewCreation,
}: InputToolbarProps) {
  const { t } = useTranslation()

  return (
    <Flex align="center" gap={0} className="shrink-0 w-full" justify="space-between">
      {/* Left Group: Model, Ratio, Reference */}
      <Flex align="center" gap={0}>
        {/* Model Select */}
        {isSmallScreen ? (
          <UnstyledButton
            onClick={onModelDrawerOpen}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
          >
            <IconSparkles size={16} className="text-[var(--chatbox-tint-secondary)]" />
            <Text size="sm" className="text-[var(--chatbox-tint-secondary)] max-w-[120px] truncate">
              {modelDisplayName}
            </Text>
            <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)] rotate-90" />
          </UnstyledButton>
        ) : (
          <ImageModelSelect onSelect={onModelSelect}>
            <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
              <IconSparkles size={16} className="text-[var(--chatbox-tint-secondary)]" />
              <Text size="sm" className="text-[var(--chatbox-tint-secondary)] max-w-[120px] truncate">
                {modelDisplayName}
              </Text>
              <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)] rotate-90" />
            </UnstyledButton>
          </ImageModelSelect>
        )}

        {/* Ratio Select */}
        {isSmallScreen ? (
          <UnstyledButton
            onClick={onRatioDrawerOpen}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
          >
            <IconAspectRatio size={16} className="text-[var(--chatbox-tint-secondary)]" />
            <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
              {selectedRatio}
            </Text>
            <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)] rotate-90" />
          </UnstyledButton>
        ) : (
          <Menu position="top" withinPortal shadow="md" radius="lg">
            <Menu.Target>
              <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                <IconAspectRatio size={16} className="text-[var(--chatbox-tint-secondary)]" />
                <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
                  {selectedRatio}
                </Text>
                <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)] rotate-90" />
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown className="!rounded-2xl" style={{ minWidth: 100 }}>
              {ratioOptions.map((ratio) => (
                <Menu.Item key={ratio} onClick={() => onRatioSelect(ratio)} className="!rounded-lg">
                  <Text size="sm" fw={500} ta="center">
                    {ratio}
                  </Text>
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}

        {/* Reference Image Button */}
        <UnstyledButton
          onClick={onAddReference}
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
        >
          <IconPhoto size={16} className="text-[var(--chatbox-tint-secondary)]" />
          <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
            {t('Upload')}
          </Text>
        </UnstyledButton>
      </Flex>

      {/* Right Group: New Creation */}
      <Flex align="center" gap={4}>
        {/* New Creation Button */}
        {isSmallScreen ? (
          <ActionIcon variant="light" size="md" radius="lg" onClick={onNewCreation}>
            <IconPlus size={18} />
          </ActionIcon>
        ) : (
          <Button
            variant="light"
            size="compact-md"
            radius="lg"
            fz="sm"
            leftSection={<IconPlus size={16} />}
            onClick={onNewCreation}
          >
            {t('New Creation')}
          </Button>
        )}
      </Flex>
    </Flex>
  )
}

/* ============================================
   Main Page Component
   ============================================ */

function ImageCreatorPage() {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const { providers } = useProviders()

  const [prompt, setPrompt] = useState('')
  const [referenceImages, setReferenceImages] = useState<
    { storageKey: string; sourceRecordId?: string; isTempUpload?: boolean }[]
  >([])
  const referenceImagesRef = useRef(referenceImages)
  referenceImagesRef.current = referenceImages
  const tempUploadKeysRef = useRef<Set<string>>(new Set())
  const [showHistory, setShowHistory] = useState(true)
  const [showMobileHistory, setShowMobileHistory] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string>(ModelProviderEnum.ChatboxAI)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [selectedRatio, setSelectedRatio] = useState<string>('auto')
  const [showModelDrawer, setShowModelDrawer] = useState(false)
  const [showRatioDrawer, setShowRatioDrawer] = useState(false)

  // Get ratio options based on selected model
  const ratioOptions = getRatioOptionsForModel(selectedModel)

  const currentGeneratingId = useCurrentGeneratingId()
  const currentRecordId = useCurrentRecordId()
  const { data: currentRecord } = useImageGenerationRecord(currentRecordId)

  const {
    data: historyData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: historyLoading,
  } = useImageGenerationHistory()

  const historyCache = useMemo(() => {
    return historyData?.pages.flatMap((page) => page.items) ?? []
  }, [historyData])

  const isCurrentlyGenerating = currentGeneratingId !== null

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const cleanupTempUploads = useCallback(async () => {
    const keys = Array.from(tempUploadKeysRef.current)
    tempUploadKeysRef.current.clear()
    await Promise.all(
      keys.map(async (key) => {
        try {
          await storage.delBlob(key)
        } catch (e) {
          log.error('Failed to cleanup temp reference image blob:', key, e)
        }
      })
    )
  }, [])

  // Default model is always ChatboxAI "GPT Image" (provider=ChatboxAI, modelId='')
  // No need to restore from lastUsedModelStore

  // Cleanup orphan temp uploads if user leaves the page mid-way.
  useEffect(() => {
    return () => {
      void cleanupTempUploads()
    }
  }, [cleanupTempUploads])

  const handleModelSelect = useCallback((provider: string, model: string) => {
    setSelectedProvider(provider)
    setSelectedModel(model)
    // lastUsedModelStore.getState().setPictureModel(provider, model)

    // Reset ratio to 'auto' if current ratio is not supported by the new model
    const newRatioOptions = getRatioOptionsForModel(model)
    setSelectedRatio((prev) => (newRatioOptions.includes(prev) ? prev : 'auto'))
  }, [])

  const handleImageUpload = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return

    let available = MAX_REFERENCE_IMAGES - referenceImagesRef.current.length
    if (available <= 0) return

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      if (available <= 0) break
      available--

      const reader = new FileReader()
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string
        const storageKey = StorageKeyGenerator.picture('image-creator-ref')
        try {
          await storage.setBlob(storageKey, dataUrl)
        } catch (err) {
          log.error('Failed to store uploaded reference image:', err)
          return
        }
        // Prime blob cache so preview doesn't need to refetch immediately.
        queryClient.setQueryData(['blob', storageKey], dataUrl)
        tempUploadKeysRef.current.add(storageKey)
        setReferenceImages((prev) => {
          if (prev.length >= MAX_REFERENCE_IMAGES) return prev
          return [...prev, { storageKey, isTempUpload: true }]
        })
      }
      reader.onerror = () => {
        log.error('Failed to read image file:', file.name)
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const handleRemoveReferenceImage = useCallback((storageKey: string) => {
    const current = referenceImagesRef.current.find((img) => img.storageKey === storageKey)
    setReferenceImages((prev) => prev.filter((img) => img.storageKey !== storageKey))
    if (current?.isTempUpload) {
      tempUploadKeysRef.current.delete(storageKey)
      void storage.delBlob(storageKey).catch((e) => log.error('Failed to delete temp reference image blob:', e))
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || isCurrentlyGenerating) return

    if (selectedProvider === ModelProviderEnum.ChatboxAI && !settingsStore.getState().licenseKey) {
      toastActions.add(t('Please log in to Chatbox AI first'))
      return
    }

    try {
      // Collect all unique source record IDs from reference images (DAG support)
      const parentIds = [
        ...new Set(referenceImages.map((img) => img.sourceRecordId).filter((id): id is string => !!id)),
      ]

      await createAndGenerate({
        prompt: prompt.trim(),
        referenceImages: referenceImages.map((img) => img.storageKey),
        model: {
          provider: selectedProvider,
          modelId: selectedModel,
        },
        imageGenerateNum: 1,
        aspectRatio: selectedRatio,
        parentIds: parentIds.length > 0 ? parentIds : undefined,
      })

      // Temp uploads are now "owned" by the created record; don't delete them on page leave.
      tempUploadKeysRef.current.clear()
      setPrompt('')
      setReferenceImages([])
    } catch (error) {
      log.error('Failed to generate image:', error)
    }
  }, [prompt, referenceImages, selectedProvider, selectedModel, selectedRatio, isCurrentlyGenerating, t])

  const handleQuickPromptSubmit = useCallback(
    async (quickPrompt: string) => {
      if (isCurrentlyGenerating) return

      if (selectedProvider === ModelProviderEnum.ChatboxAI && !settingsStore.getState().licenseKey) {
        toastActions.add(t('Please log in to Chatbox AI first'))
        return
      }

      try {
        await createAndGenerate({
          prompt: quickPrompt,
          referenceImages: [],
          model: {
            provider: selectedProvider,
            modelId: selectedModel,
          },
          imageGenerateNum: 1,
          aspectRatio: 'auto',
        })
      } catch (error) {
        log.error('Failed to generate image:', error)
      }
    },
    [selectedProvider, selectedModel, selectedRatio, isCurrentlyGenerating, t]
  )

  const handleUseAsReference = useCallback(async (storageKey: string, sourceRecordId?: string) => {
    setReferenceImages((prev) => {
      if (prev.length >= MAX_REFERENCE_IMAGES) return prev
      return [...prev, { storageKey, sourceRecordId, isTempUpload: false }]
    })
  }, [])

  const handleHistoryClick = useCallback(
    async (record: ImageGeneration) => {
      await cleanupTempUploads()
      imageGenerationStore.getState().setCurrentRecordId(record.id)
      setPrompt(record.prompt)

      setReferenceImages(record.referenceImages.map((key) => ({ storageKey: key, isTempUpload: false })))
    },
    [cleanupTempUploads]
  )

  const handleNewCreation = useCallback(() => {
    void cleanupTempUploads()
    imageGenerationStore.getState().setCurrentRecordId(null)
    setPrompt('')
    setReferenceImages([])
    textareaRef.current?.focus()
  }, [cleanupTempUploads])

  const handleLoadMoreHistory = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteRecord(id)
      queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
    } catch (error) {
      log.error('Failed to delete record:', error)
    }
  }, [])

  const getAvailableImageModels = (
    providerModels: { modelId: string; nickname?: string }[],
    imageModelIds: string[]
  ) => {
    return imageModelIds
      .map((modelId) => {
        const model = providerModels.find((m) => m.modelId === modelId)
        if (!model) return null
        return {
          modelId,
          displayName: model.nickname || IMAGE_MODEL_FALLBACK_NAMES[modelId] || modelId,
        }
      })
      .filter((m): m is { modelId: string; displayName: string } => m !== null)
  }

  const imageModelGroups = useMemo(() => {
    const groups: { label: string; providerId: string; models: { modelId: string; displayName: string }[] }[] = []

    const chatboxProvider = providers.find((p) => p.id === ModelProviderEnum.ChatboxAI)
    const chatboxModels = chatboxProvider
      ? getAvailableImageModels(
          chatboxProvider.models || chatboxProvider.defaultSettings?.models || [],
          CHATBOXAI_IMAGE_MODEL_IDS
        )
      : []
    groups.push({
      label: 'Chatbox AI',
      providerId: ModelProviderEnum.ChatboxAI,
      models: [CHATBOXAI_DEFAULT_IMAGE_MODEL, ...chatboxModels],
    })

    const geminiProvider = providers.find((p) => p.id === ModelProviderEnum.Gemini)
    if (geminiProvider) {
      const providerModels = geminiProvider.models || geminiProvider.defaultSettings?.models || []
      const models = getAvailableImageModels(providerModels, GEMINI_IMAGE_MODEL_IDS)
      if (models.length > 0) {
        groups.push({ label: 'Google Gemini', providerId: ModelProviderEnum.Gemini, models })
      }
    }

    providers
      .filter((p) => p.isCustom && p.type === ModelProviderType.Gemini)
      .forEach((provider) => {
        const providerModels = provider.models || provider.defaultSettings?.models || []
        const models = getAvailableImageModels(providerModels, GEMINI_IMAGE_MODEL_IDS)
        if (models.length > 0) {
          groups.push({ label: provider.name, providerId: provider.id, models })
        }
      })

    providers
      .filter((p) => [ModelProviderEnum.OpenAI, ModelProviderEnum.Azure].includes(p.id as ModelProviderEnum))
      .forEach((provider) => {
        const providerModels = provider.models || provider.defaultSettings?.models || []
        const models = getAvailableImageModels(providerModels, OPENAI_IMAGE_MODEL_IDS)
        if (models.length > 0) {
          groups.push({ label: provider.name, providerId: provider.id, models })
        }
      })

    return groups
  }, [providers])

  // Workaround: DALL-E-3 was removed in new version, fallback to default
  useEffect(() => {
    if (selectedModel === 'DALL-E-3') {
      setSelectedModel('')
    }
  }, [selectedModel])

  const modelDisplayName = useMemo(() => {
    const provider = providers.find((p) => p.id === selectedProvider)
    const providerModels = provider?.models || provider?.defaultSettings?.models || []
    const model = providerModels.find((m) => m.modelId === selectedModel)
    const modelName =
      model?.nickname ||
      IMAGE_MODEL_FALLBACK_NAMES[selectedModel] ||
      selectedModel ||
      CHATBOXAI_DEFAULT_IMAGE_MODEL.displayName

    if (selectedProvider === ModelProviderEnum.ChatboxAI) {
      return modelName
    }
    const providerName = provider?.name || selectedProvider
    return `${providerName} - ${modelName}`
  }, [selectedProvider, selectedModel, providers])

  const headerRight = isSmallScreen ? (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="md"
      radius="lg"
      onClick={() => setShowMobileHistory(true)}
      className="controls"
    >
      <IconHistory size={20} />
    </ActionIcon>
  ) : (
    <UnstyledButton
      onClick={() => setShowHistory(!showHistory)}
      className={`controls flex items-center gap-1.5 px-3 py-1.5 rounded-sm ${showHistory ? 'bg-[var(--chatbox-background-tertiary)]' : 'bg-[var(--chatbox-background-secondary)]'}`}
    >
      <IconHistory size={18} className="text-[var(--chatbox-tint-secondary)]" />
      <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
        {t('History')}
      </Text>
    </UnstyledButton>
  )

  return (
    <Page title={t('Image Creator')} right={headerRight}>
      <Flex flex={1} h="100%" className="overflow-hidden relative">
        {/* Main Content Area */}
        <Flex direction="column" flex={1} h="100%" className="overflow-hidden relative">
          {/* Results Area */}
          <ScrollArea flex={1} type="auto" offsetScrollbars={!isSmallScreen}>
            <Box maw={900} mx="auto" py="xl" px="md" className="min-h-full">
              {!currentRecord && <EmptyState onPromptSelect={handleQuickPromptSubmit} />}

              {currentRecord && (
                <Stack gap="lg" className="animate-in fade-in duration-300">
                  {currentRecord.status === 'generating' && currentRecord.generatedImages.length === 0 && (
                    <LoadingShimmer />
                  )}

                  {currentRecord.generatedImages.length > 0 && (
                    <Flex justify="center" w="100%">
                      <GeneratedImagesGallery
                        images={currentRecord.generatedImages}
                        onUseAsReference={(urlOrKey) => handleUseAsReference(urlOrKey, currentRecord.id)}
                      />
                    </Flex>
                  )}

                  <PromptDisplay
                    prompt={currentRecord.prompt}
                    model={currentRecord.model}
                    referenceImageCount={currentRecord.referenceImages.length}
                  />

                  {currentRecord.status === 'generating' && currentRecord.taskId && !isCurrentlyGenerating && (
                    <Flex justify="center" w="100%">
                      <Button variant="light" onClick={() => void resumeGeneration(currentRecord.id)}>
                        {t('Resume Generation')}
                      </Button>
                    </Flex>
                  )}

                  {currentRecord.status === 'error' && (
                    <ImageGenerationErrorTips
                      record={currentRecord}
                      onRetry={() => void retryGeneration(currentRecord.id)}
                      isRetrying={isCurrentlyGenerating}
                    />
                  )}
                </Stack>
              )}
            </Box>
          </ScrollArea>

          {/* Input Area */}
          <Box py="md" px="sm">
            <Stack gap="xs" maw={800} mx="auto">
              <ReferenceImagesPreview
                images={referenceImages}
                onRemove={handleRemoveReferenceImage}
                onAddClick={() => fileInputRef.current?.click()}
              />

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleImageUpload(e.target.files)}
              />

              <Box
                className="rounded-md bg-[var(--chatbox-background-secondary)] px-3 py-2"
                style={{ border: '1px solid var(--chatbox-border-primary)' }}
              >
                <Stack gap="xs">
                  {/* Input Row */}
                  <Flex align="flex-end" gap={4}>
                    <Textarea
                      ref={textareaRef}
                      placeholder={t('Describe the image you want to create...') || ''}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      minRows={2}
                      maxRows={6}
                      autosize
                      size="sm"
                      className="flex-1"
                      styles={{
                        root: { flex: 1 },
                        wrapper: { flex: 1 },
                        input: {
                          border: 'none',
                          backgroundColor: 'transparent',
                          paddingLeft: 8,
                          paddingRight: 8,
                          '&:focus': { border: 'none', boxShadow: 'none' },
                        },
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void handleSubmit()
                        }
                      }}
                    />

                    {/* Send / Stop Button */}
                    <ActionIcon
                      size={32}
                      variant="filled"
                      color={isCurrentlyGenerating ? 'dark' : 'chatbox-brand'}
                      radius="xl"
                      onClick={isCurrentlyGenerating ? cancelGeneration : handleSubmit}
                      disabled={!prompt.trim() && !isCurrentlyGenerating}
                      className={`shrink-0 mb-1 ${!prompt.trim() && !isCurrentlyGenerating ? 'disabled:!opacity-100 !text-white' : ''}`}
                      style={{
                        cursor: isCurrentlyGenerating ? 'pointer' : undefined,
                        ...(!prompt.trim() && !isCurrentlyGenerating
                          ? { backgroundColor: 'rgba(222, 226, 230, 1)' }
                          : {}),
                      }}
                    >
                      {isCurrentlyGenerating ? <Loader size={16} color="white" /> : <IconArrowUp size={16} />}
                    </ActionIcon>
                  </Flex>

                  {/* Toolbar Row */}
                  <InputToolbar
                    isSmallScreen={isSmallScreen}
                    modelDisplayName={modelDisplayName}
                    selectedRatio={selectedRatio}
                    ratioOptions={ratioOptions}
                    onModelDrawerOpen={() => setShowModelDrawer(true)}
                    onRatioDrawerOpen={() => setShowRatioDrawer(true)}
                    onRatioSelect={setSelectedRatio}
                    onModelSelect={handleModelSelect}
                    onAddReference={() => fileInputRef.current?.click()}
                    onNewCreation={handleNewCreation}
                  />
                </Stack>
              </Box>

              <Text className="disclaimer-safe-area" size="xs" c="dimmed" ta="center">
                {t('AI-generated images may not be accurate. Review output carefully.')}
              </Text>
            </Stack>
          </Box>
        </Flex>

        {/* Desktop History Panel */}
        {!isSmallScreen && (
          <HistoryPanel
            show={showHistory}
            width={HISTORY_PANEL_WIDTH}
            historyCache={historyCache}
            historyLoading={historyLoading}
            currentRecordId={currentRecord?.id ?? null}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onItemClick={handleHistoryClick}
            onLoadMore={handleLoadMoreHistory}
            onNewCreation={handleNewCreation}
            onClose={() => setShowHistory(false)}
            onDelete={handleDelete}
          />
        )}

        {/* Mobile Drawers */}
        {isSmallScreen && (
          <>
            <MobileHistoryDrawer
              open={showMobileHistory}
              onOpenChange={setShowMobileHistory}
              historyCache={historyCache}
              historyLoading={historyLoading}
              currentRecordId={currentRecord?.id ?? null}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onItemClick={handleHistoryClick}
              onLoadMore={handleLoadMoreHistory}
              onNewCreation={handleNewCreation}
              onDelete={handleDelete}
            />

            <MobileModelDrawer
              open={showModelDrawer}
              onOpenChange={setShowModelDrawer}
              modelGroups={imageModelGroups}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onSelect={handleModelSelect}
            />

            <MobileRatioDrawer
              open={showRatioDrawer}
              onOpenChange={setShowRatioDrawer}
              options={ratioOptions}
              selectedRatio={selectedRatio}
              onSelect={setSelectedRatio}
            />
          </>
        )}
      </Flex>
    </Page>
  )
}
