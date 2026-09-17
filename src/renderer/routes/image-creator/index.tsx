import NiceModal from '@ebay/nice-modal-react'
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
  UnstyledButton,
} from '@mantine/core'
import type { ImageGeneration, ImageGenerationModel } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import {
  IconArrowUp,
  IconAspectRatio,
  IconChevronRight,
  IconHistory,
  IconPhoto,
  IconPlus,
  IconSparkles,
} from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ChatboxWelcomeCard } from '@/components/common/ChatboxWelcomeCard'
import { ImageModelSelect } from '@/components/ImageModelSelect'
import Page from '@/components/layout/Page'
import { type ImageModelGroup, useImageModelGroups } from '@/hooks/useImageModelGroups'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import useVersion from '@/hooks/useVersion'
import { getLogger } from '@/lib/utils'
import { resumeImageGenerationWithFollowUp } from '@/packages/chatbox-cli/image-task-follow-up'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import { cancelGeneration, createAndGenerate, retryGeneration } from '@/stores/imageGenerationActions'
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
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import * as toastActions from '@/stores/toastActions'
import { getHomeWelcomeCardMode } from '@/utils/homeWelcomeCard'
import { getRatioOptionsForModel, HISTORY_PANEL_WIDTH, MAX_REFERENCE_IMAGES } from './-components/constants'
import { EmptyState } from './-components/EmptyState'
import { GeneratedImagesGallery } from './-components/GeneratedImagesGallery'
import { HistoryPanel } from './-components/HistoryPanel'
import { ImageGenerationErrorTips } from './-components/ImageGenerationErrorTips'
import { MobileHistoryDrawer, MobileModelDrawer, MobileRatioDrawer } from './-components/MobileDrawers'
import {
  getHistoryImageModelDisplayName as resolveHistoryImageModelDisplayName,
  getImageModelDisplayName as resolveImageModelDisplayName,
} from './-components/model-display-name'
import { getImageModelRatioOptions, resolveImageRatioSelection, resolveImageModelSelection } from './-components/model-selection'
import { PromptDisplay } from './-components/PromptDisplay'
import { ReferenceImagesPreview } from './-components/ReferenceImagesPreview'
import { LoadingShimmer } from './-components/Shimmer'
import { useReferenceImageDraft } from './-hooks/useReferenceImageDraft'

const log = getLogger('image-creator')

export const Route = createFileRoute('/image-creator/')({
  component: ImageCreatorPage,
})

/* ============================================
   Input Toolbar (Model/Ratio/Reference buttons)
   ============================================ */

interface InputToolbarProps {
  isSmallScreen: boolean
  modelGroups: ImageModelGroup[]
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
  modelGroups,
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
          <ImageModelSelect modelGroups={modelGroups} onSelect={onModelSelect}>
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
            <Menu.Dropdown className="!rounded-lg" style={{ minWidth: 100 }}>
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
  const imageModelGroups = useImageModelGroups()
  const hasLicense = useSettingsStore((s) => Boolean(s.licenseKey))
  const hasExpiredLicense = useSettingsStore((s) => s.hasExpiredLicense)
  const isLoggedIn = useAuthInfoStore((s) => Boolean(s.accessToken && s.refreshToken))
  const { isExceeded, isExceededResolved } = useVersion()
  const welcomeCardMode = useMemo(
    () =>
      getHomeWelcomeCardMode({
        providerCount: providers.length,
        isLoggedIn,
        hasLicense,
        hasExpiredLicense,
        hideForStoreReview: isExceeded || !isExceededResolved,
      }),
    [providers.length, isLoggedIn, hasLicense, hasExpiredLicense, isExceeded, isExceededResolved]
  )

  const [prompt, setPrompt] = useState('')
  const {
    images: referenceImages,
    upload: handleImageUpload,
    addReference: handleUseAsReference,
    removeReference: handleRemoveReferenceImage,
    replace: replaceReferenceImages,
    clear: clearReferenceImages,
    beginSubmission,
  } = useReferenceImageDraft()
  const [showHistory, setShowHistory] = useState(true)
  const [showMobileHistory, setShowMobileHistory] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string>(ModelProviderEnum.ChatboxAI)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [selectedRatio, setSelectedRatio] = useState<string>('auto')
  const [showModelDrawer, setShowModelDrawer] = useState(false)
  const [showRatioDrawer, setShowRatioDrawer] = useState(false)

  const selectedModelCapabilities = useMemo(
    () =>
      imageModelGroups
        .find((group) => group.providerId === selectedProvider)
        ?.models.find((model) => model.modelId === selectedModel)?.capabilities,
    [imageModelGroups, selectedProvider, selectedModel]
  )
  const ratioOptions = useMemo(
    () => getImageModelRatioOptions(selectedModel, selectedModelCapabilities),
    [selectedModel, selectedModelCapabilities]
  )

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

  useEffect(() => {
    const nextSelection = resolveImageModelSelection(imageModelGroups, selectedProvider, selectedModel)
    if (!nextSelection) {
      setSelectedProvider('')
      setSelectedModel('')
      setSelectedRatio('auto')
      return
    }
    if (nextSelection.provider === selectedProvider && nextSelection.model === selectedModel) return

    setSelectedProvider(nextSelection.provider)
    setSelectedModel(nextSelection.model)
    const nextCapabilities = imageModelGroups
      .find((group) => group.providerId === nextSelection.provider)
      ?.models.find((model) => model.modelId === nextSelection.model)?.capabilities
    const nextRatioOptions = getImageModelRatioOptions(nextSelection.model, nextCapabilities)
    setSelectedRatio((prev) => resolveImageRatioSelection(prev, nextRatioOptions))
  }, [imageModelGroups, selectedProvider, selectedModel])

  useEffect(() => {
    setSelectedRatio((prev) => resolveImageRatioSelection(prev, ratioOptions))
  }, [ratioOptions])

  const handleModelSelect = useCallback(
    (provider: string, model: string) => {
      setSelectedProvider(provider)
      setSelectedModel(model)
      // lastUsedModelStore.getState().setPictureModel(provider, model)

      const capabilities = imageModelGroups
        .find((group) => group.providerId === provider)
        ?.models.find((option) => option.modelId === model)?.capabilities
      const newRatioOptions = getImageModelRatioOptions(model, capabilities)
      setSelectedRatio((prev) => resolveImageRatioSelection(prev, newRatioOptions))
    },
    [imageModelGroups]
  )

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || isCurrentlyGenerating) return
    if (!selectedModel) {
      toastActions.add(t('Please select a model'))
      return
    }

    if (selectedProvider === ModelProviderEnum.ChatboxAI && !settingsStore.getState().licenseKey) {
      toastActions.add(t('Please log in to Chatbox AI first'))
      return
    }

    try {
      const submission = beginSubmission()
      try {
        await createAndGenerate(
          {
            prompt: prompt.trim(),
            referenceImages: submission.referenceImages,
            model: { provider: selectedProvider, modelId: selectedModel },
            imageGenerateNum: 1,
            aspectRatio: selectedRatio,
            parentIds: submission.parentIds.length > 0 ? submission.parentIds : undefined,
          },
          { onRecordCreated: submission.commit }
        )
      } catch (error) {
        await submission.rollback()
        throw error
      }
      if (submission.complete()) setPrompt('')
    } catch (error) {
      log.error('Failed to generate image:', error)
    }
  }, [prompt, beginSubmission, selectedProvider, selectedModel, selectedRatio, isCurrentlyGenerating, t])

  const handleQuickPromptSubmit = useCallback(
    async (quickPrompt: string) => {
      if (isCurrentlyGenerating) return
      if (!selectedModel) {
        toastActions.add(t('Please select a model'))
        return
      }

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
    [selectedProvider, selectedModel, isCurrentlyGenerating, t]
  )

  const handleReportGeneratedImage = useCallback(async (record: ImageGeneration) => {
    const contentId = [
      `Image generation prompt: ${record.prompt}`,
      `Record ID: ${record.id}`,
      record.taskId ? `Task ID: ${record.taskId}` : undefined,
      record.generatedImages.length > 0 ? `Images: ${record.generatedImages.join(', ')}` : undefined,
      `Model: ${record.model.provider}/${record.model.modelId}`,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n')

    await NiceModal.show('report-content', { contentId })
  }, [])

  const handleHistoryClick = useCallback(
    async (record: ImageGeneration) => {
      imageGenerationStore.getState().setCurrentRecordId(record.id)
      setPrompt(record.prompt)

      await replaceReferenceImages(record.referenceImages.map((key) => ({ storageKey: key })))
    },
    [replaceReferenceImages]
  )

  const handleNewCreation = useCallback(() => {
    void clearReferenceImages()
    imageGenerationStore.getState().setCurrentRecordId(null)
    setPrompt('')
    textareaRef.current?.focus()
  }, [clearReferenceImages])

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

  const getImageModelDisplayName = useCallback(
    (model: ImageGenerationModel) => resolveImageModelDisplayName(model, { imageModelGroups, providers }),
    [imageModelGroups, providers]
  )

  const modelDisplayName = useMemo(() => {
    if (!selectedModel) return t('No models available')
    return getImageModelDisplayName({
      provider: selectedProvider,
      modelId: selectedModel,
    })
  }, [selectedProvider, selectedModel, getImageModelDisplayName, t])

  const getHistoryImageModelDisplayName = useCallback(
    (model: ImageGenerationModel) => resolveHistoryImageModelDisplayName(model, { imageModelGroups, providers }),
    [imageModelGroups, providers]
  )

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
      className={`controls flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${showHistory ? 'bg-[var(--chatbox-background-tertiary)]' : 'bg-[var(--chatbox-background-secondary)]'}`}
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
                        thumbnails={currentRecord.generatedImageThumbnails}
                        onUseAsReference={(urlOrKey) => handleUseAsReference(urlOrKey, currentRecord.id)}
                        onReport={() => void handleReportGeneratedImage(currentRecord)}
                      />
                    </Flex>
                  )}

                  <PromptDisplay
                    prompt={currentRecord.prompt}
                    modelDisplayName={getImageModelDisplayName(currentRecord.model)}
                    referenceImageCount={currentRecord.referenceImages.length}
                  />

                  {currentRecord.status !== 'done' && currentRecord.taskId && !isCurrentlyGenerating && (
                    <Flex justify="center" w="100%">
                      <Button variant="light" onClick={() => void resumeImageGenerationWithFollowUp(currentRecord.id)}>
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
            <Stack gap="sm" maw={800} mx="auto">
              {!currentRecord && welcomeCardMode !== 'none' && (
                <ChatboxWelcomeCard mode={welcomeCardMode} pageName={JK_PAGE_NAMES.IMAGE_PAGE} />
              )}

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
                className="rounded-lg bg-[var(--chatbox-background-secondary)] px-3 py-2"
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
                      onPaste={(e) => {
                        const items = Array.from(e.clipboardData.items)
                        const images = items
                          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                          .map((item) => item.getAsFile())
                          .filter((file): file is File => file !== null)
                        if (images.length === 0) return

                        if (!items.some((item) => item.kind === 'string' && item.type === 'text/plain')) {
                          e.preventDefault()
                        }
                        handleImageUpload(images)
                      }}
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
                      radius="lg"
                      onClick={isCurrentlyGenerating ? cancelGeneration : handleSubmit}
                      disabled={(!prompt.trim() || !selectedModel) && !isCurrentlyGenerating}
                      className={`shrink-0 mb-1 ${(!prompt.trim() || !selectedModel) && !isCurrentlyGenerating ? 'disabled:!opacity-100 !text-white' : ''}`}
                      style={{
                        cursor: isCurrentlyGenerating ? 'pointer' : undefined,
                        ...((!prompt.trim() || !selectedModel) && !isCurrentlyGenerating
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
                    modelGroups={imageModelGroups}
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
            getModelDisplayName={(record) => getHistoryImageModelDisplayName(record.model)}
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
              getModelDisplayName={(record) => getHistoryImageModelDisplayName(record.model)}
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
