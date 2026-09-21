import { Combobox, Flex, SegmentedControl, Stack, Text, TextInput, useCombobox } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { ModelProviderEnum } from '@shared/types'
import { IconSearch } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAtom } from 'jotai'
import {
  cloneElement,
  forwardRef,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { trackListModelClick, trackSelectModelClick, trackUpgradeModelClick } from '@/analytics/model-selection'
import useChatboxAIModels from '@/hooks/useChatboxAIModels'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { collapsedProvidersAtom } from '@/stores/atoms/uiAtoms'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { ScalableIcon } from '../common/ScalableIcon'
import { ChatboxProviderRows } from './ChatboxProviderRows'
import { buildChatboxAIGroupViews, modelMatchesSearch } from './chatboxCatalog'
import {
  DESKTOP_DETAIL_CARD_GAP,
  DESKTOP_DETAIL_CARD_MARGIN,
  DESKTOP_DETAIL_CARD_OUTER_WIDTH,
  DESKTOP_DETAIL_CARD_WIDTH,
  DESKTOP_DETAIL_VIEWPORT_MARGIN,
  DRAWER_SURFACE_STYLE,
  EMPTY_MODEL_IDS,
  HOVER_CLASS,
  MODEL_SELECTOR_SURFACE_CLASS,
  SELECTED_CLASS,
} from './constants'
import { DetailCard } from './DetailCard'
import { filterModelsForSelector } from './filterModels'
import { GenericProviderRows } from './GenericProviderRows'
import { searchGenericModel, toProviderModelInfo } from './helpers'
import type { ChatboxAIModel, DesktopDetailState, DetailModel, ModelSelectorV2Props } from './types'

export const ModelSelectorV2 = forwardRef<HTMLDivElement, ModelSelectorV2Props>(
  (
    {
      children,
      showAuto,
      autoText,
      onSelect,
      onDropdownOpen,
      modelFilter,
      modelDisabledCheck,
      selectedProviderId,
      selectedModelId,
      searchPosition = 'bottom',
      pageName,
      ...comboboxProps
    },
    ref
  ) => {
    const { t } = useTranslation()
    const isMobile = useIsSmallScreen()
    const { providers, favoritedModels, favoriteModel, unfavoriteModel, isFavoritedModel } = useProviders()
    const { chatboxAIModelList, chatboxAIModels } = useChatboxAIModels()
    const favoritedModelsSetting = useSettingsStore((state) => state.favoritedModels)
    const chatboxAIExcludedModels = useSettingsStore(
      (state) => state.providers?.[ModelProviderEnum.ChatboxAI]?.excludedModels || EMPTY_MODEL_IDS
    )
    const [collapsedProviders, setCollapsedProviders] = useAtom(collapsedProvidersAtom)
    const activeTab = useUIStore((state) => state.modelSelectorTab)
    const setActiveTab = useUIStore((state) => state.setModelSelectorTab)
    const [search, setSearch] = useState('')
    const [mobileOpen, setMobileOpen] = useState(false)
    const [advancedExpanded, setAdvancedExpanded] = useState(false)
    const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())
    const [mobileDetail, setMobileDetail] = useState<DetailModel | null>(null)
    const [desktopDetail, setDesktopDetail] = useState<DesktopDetailState | null>(null)
    const desktopDropdownRef = useRef<HTMLDivElement>(null)
    const desktopDetailRef = useRef<HTMLDivElement>(null)
    const desktopDetailCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleDropdownOpen = useCallback(() => {
      onDropdownOpen?.()
      if (pageName) {
        trackListModelClick(pageName, selectedModelId)
      }
    }, [onDropdownOpen, pageName, selectedModelId])

    const combobox = useCombobox({
      onDropdownOpen: handleDropdownOpen,
      onDropdownClose: () => {
        combobox.resetSelectedOption()
        setSearch('')
        setDesktopDetail(null)
      },
    })

    useEffect(() => {
      return () => {
        if (desktopDetailCloseTimerRef.current) {
          clearTimeout(desktopDetailCloseTimerRef.current)
        }
      }
    }, [])

    useLayoutEffect(() => {
      if (!desktopDetail) return
      const dropdownRect = desktopDropdownRef.current?.getBoundingClientRect()
      const detailRect = desktopDetailRef.current?.getBoundingClientRect()
      if (!dropdownRect || !detailRect) return

      const minTop = DESKTOP_DETAIL_VIEWPORT_MARGIN + detailRect.height / 2 - dropdownRect.top
      const maxTop = window.innerHeight - DESKTOP_DETAIL_VIEWPORT_MARGIN - detailRect.height / 2 - dropdownRect.top
      const top = minTop <= maxTop ? Math.min(Math.max(desktopDetail.top, minTop), maxTop) : desktopDetail.top

      if (Math.abs(top - desktopDetail.top) > 0.5) {
        setDesktopDetail((current) => (current ? { ...current, top } : current))
      }
    }, [desktopDetail])

    const chatboxProvider = useMemo(
      () =>
        chatboxAIModelList
          ? {
              id: chatboxAIModelList.provider.id,
              name: chatboxAIModelList.provider.name,
            }
          : providers.find((provider) => provider.id === ModelProviderEnum.ChatboxAI),
      [chatboxAIModelList, providers]
    )

    const genericProviders = useMemo(() => {
      const manifestBackedChatboxProviders =
        !chatboxAIModelList && chatboxAIModels.length > 0
          ? [
              {
                id: ModelProviderEnum.ChatboxAI,
                name: 'Chatbox AI',
                isCustom: false,
                models: chatboxAIModels,
              },
            ]
          : []
      const sourceProviders = chatboxAIModelList
        ? providers.filter((provider) => provider.id !== ModelProviderEnum.ChatboxAI)
        : [
            ...manifestBackedChatboxProviders,
            ...providers.filter((provider) => provider.id !== ModelProviderEnum.ChatboxAI),
          ]

      return sourceProviders
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          isCustom: provider.isCustom,
          models: filterModelsForSelector(provider.models, modelFilter, provider.id)?.filter((model) =>
            searchGenericModel(provider, model, search)
          ),
        }))
        .filter((provider) => provider.models?.length)
    }, [chatboxAIModelList, chatboxAIModels, providers, modelFilter, search])

    const chatboxFilter = useCallback(
      (model: ChatboxAIModel) =>
        !chatboxAIExcludedModels.includes(model.modelId) &&
        (!modelFilter || modelFilter(toProviderModelInfo(model), ModelProviderEnum.ChatboxAI)),
      [chatboxAIExcludedModels, modelFilter]
    )

    const chatboxGroups = useMemo(() => {
      if (!chatboxAIModelList) return []
      return buildChatboxAIGroupViews({
        catalog: chatboxAIModelList,
        search,
        expandedAdvanced: advancedExpanded,
        collapsedGroupIds,
        modelFilter: (modelId) => {
          const model = chatboxAIModelList.models[modelId]
          return model ? chatboxFilter(model) : false
        },
      })
    }, [advancedExpanded, chatboxAIModelList, collapsedGroupIds, search, chatboxFilter])

    const clearDesktopDetailCloseTimer = () => {
      if (desktopDetailCloseTimerRef.current) {
        clearTimeout(desktopDetailCloseTimerRef.current)
        desktopDetailCloseTimerRef.current = null
      }
    }

    const scheduleDesktopDetailClose = () => {
      clearDesktopDetailCloseTimer()
      desktopDetailCloseTimerRef.current = setTimeout(() => {
        setDesktopDetail(null)
        desktopDetailCloseTimerRef.current = null
      }, 120)
    }

    const openDesktopDetail = (
      key: string,
      model: DetailModel,
      pricingLink: string | undefined,
      anchor: HTMLElement,
      upgradeLink?: string
    ) => {
      if (isMobile || typeof window === 'undefined') return
      const dropdownRect = desktopDropdownRef.current?.getBoundingClientRect()
      if (!dropdownRect) return
      clearDesktopDetailCloseTimer()
      const rect = anchor.getBoundingClientRect()
      const rightSideLeft = rect.right + DESKTOP_DETAIL_CARD_GAP - DESKTOP_DETAIL_CARD_MARGIN
      const hasRightSideSpace =
        rightSideLeft + DESKTOP_DETAIL_CARD_OUTER_WIDTH <= window.innerWidth - DESKTOP_DETAIL_VIEWPORT_MARGIN
      const left = hasRightSideSpace
        ? rightSideLeft
        : Math.max(
            DESKTOP_DETAIL_VIEWPORT_MARGIN - DESKTOP_DETAIL_CARD_MARGIN,
            rect.left - DESKTOP_DETAIL_CARD_GAP - DESKTOP_DETAIL_CARD_WIDTH - DESKTOP_DETAIL_CARD_MARGIN
          )
      setDesktopDetail({
        key,
        model,
        pricingLink,
        upgradeLink,
        left: left - dropdownRect.left,
        top: rect.top + rect.height / 2 - dropdownRect.top,
      })
    }

    const handleSelect = (providerId: string, modelId: string) => {
      clearDesktopDetailCloseTimer()
      setDesktopDetail(null)
      combobox.closeDropdown()
      setMobileOpen(false)
      setMobileDetail(null)
      if (pageName && providerId && modelId) {
        trackSelectModelClick(pageName, modelId, 'success')
      }
      onSelect?.(providerId, modelId)
    }

    const handleDisabledSelect = (modelId: string) => {
      if (pageName) {
        trackSelectModelClick(pageName, modelId, 'failed')
      }
    }

    const blurActiveElement = () => {
      if (typeof document === 'undefined') return
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement) {
        activeElement.blur()
      }
    }

    const handleMobileOpenChange = (open: boolean) => {
      setMobileOpen(open)
      if (open && pageName) {
        trackListModelClick(pageName, selectedModelId)
      }
      blurActiveElement()
    }

    const toggleProvider = (providerId: string) => {
      setCollapsedProviders((prev) => ({ ...prev, [providerId]: !prev[providerId] }))
    }

    const toggleFavorite = (providerId: string, modelId: string) => {
      if (isFavorited(providerId, modelId)) {
        unfavoriteModel(providerId, modelId)
      } else {
        favoriteModel(providerId, modelId)
      }
    }

    const isFavorited = useCallback(
      (providerId: string, modelId: string) =>
        !!favoritedModelsSetting?.some((favorite) => favorite.provider === providerId && favorite.model === modelId) ||
        isFavoritedModel(providerId, modelId),
      [favoritedModelsSetting, isFavoritedModel]
    )

    const toggleGroup = (groupId: string) => {
      setCollapsedGroupIds((prev) => {
        const next = new Set(prev)
        if (next.has(groupId)) next.delete(groupId)
        else next.add(groupId)
        return next
      })
    }

    const searchBox = (
      <Flex
        align="center"
        gap="xs"
        px="xs"
        py={6}
        className="border-0 border-t border-solid border-chatbox-border-primary"
      >
        <ScalableIcon icon={IconSearch} size={16} className="text-chatbox-tint-tertiary" />
        <TextInput
          data-testid={TestId.model.searchInput}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={t('Search models') as string}
          variant="unstyled"
          className="flex-1"
          styles={{ input: { fontSize: 'var(--mantine-font-size-sm)', minHeight: 24, height: 24, padding: 0 } }}
        />
        <SegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          data={[
            { label: t('All'), value: 'all' },
            { label: t('Favorite'), value: 'favorite' },
          ]}
          size="xs"
          styles={{ label: { paddingInline: 10 } }}
        />
      </Flex>
    )

    const visibleModelCount = useMemo(() => {
      const favoriteOnly = activeTab === 'favorite'
      let chatboxCount = 0

      if (chatboxAIModelList && chatboxProvider) {
        const chatboxFavoriteSet = new Set(
          (favoritedModelsSetting || [])
            .filter((favorite) => favorite.provider === chatboxProvider.id)
            .map((favorite) => favorite.model)
        )

        chatboxCount = chatboxAIModelList.groups.reduce(
          (count, group) =>
            count +
            group.modelIds.filter((modelId) => {
              const model = chatboxAIModelList.models[modelId]
              if (!model || !chatboxFilter(model)) return false
              if (favoriteOnly && !chatboxFavoriteSet.has(modelId)) return false
              return modelMatchesSearch(model, search, chatboxProvider.name)
            }).length,
          0
        )
      }

      const genericCount = favoriteOnly
        ? (favoritedModels || []).filter((favorite) => {
            const provider = favorite.provider
            const model = favorite.model
            if (!provider || !model || (chatboxAIModelList && provider.id === ModelProviderEnum.ChatboxAI)) return false
            if (!modelMatchesSearch({ modelId: model.modelId, modelName: model.nickname }, search, provider.name)) {
              return false
            }
            return modelFilter ? modelFilter(model, provider.id) : !model.type || model.type === 'chat'
          }).length
        : genericProviders.reduce((count, provider) => count + (provider.models?.length || 0), 0)

      return chatboxCount + genericCount
    }, [
      activeTab,
      chatboxAIModelList,
      chatboxFilter,
      chatboxProvider,
      favoritedModels,
      favoritedModelsSetting,
      genericProviders,
      modelFilter,
      search,
    ])

    const content = (
      <Stack
        data-testid={TestId.model.selectorPanel}
        gap={0}
        className={clsx(
          'overflow-hidden',
          MODEL_SELECTOR_SURFACE_CLASS,
          isMobile ? 'border-0' : 'rounded-[10px] border border-solid border-chatbox-border-primary shadow-lg'
        )}
      >
        {isMobile && (
          <div className="px-3 pt-1.5 pb-2">
            <SegmentedControl
              value={activeTab}
              onChange={setActiveTab}
              data={[
                { label: t('All'), value: 'all' },
                { label: t('Favorite'), value: 'favorite' },
              ]}
              fullWidth
              radius="lg"
              size="sm"
              styles={{
                root: {
                  padding: 3,
                  background: 'var(--chatbox-background-secondary)',
                },
                indicator: {
                  boxShadow: '0 1px 3px rgb(0 0 0 / 0.08)',
                },
                label: {
                  minHeight: 30,
                  fontWeight: 600,
                },
              }}
            />
          </div>
        )}
        {isMobile && (
          <Flex align="center" gap="xs" px="md" py={6} className="bg-transparent">
            <ScalableIcon icon={IconSearch} size={16} className="text-chatbox-tint-tertiary" />
            <TextInput
              data-testid={TestId.model.searchInput}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={t('Search models') as string}
              variant="unstyled"
              className="flex-1"
              styles={{ input: { fontSize: 'var(--mantine-font-size-sm)', height: 28, minHeight: 28 } }}
            />
          </Flex>
        )}
        {!isMobile && searchPosition === 'top' && searchBox}
        <div
          className={clsx('overflow-y-auto', isMobile ? 'max-h-[70vh]' : 'max-h-[48vh]')}
          onScroll={
            isMobile
              ? undefined
              : () => {
                  clearDesktopDetailCloseTimer()
                  setDesktopDetail(null)
                }
          }
        >
          {showAuto && activeTab === 'all' && (
            <button
              type="button"
              className={clsx(
                'w-full h-9 px-2.5 text-left border-0 bg-transparent cursor-pointer text-sm text-chatbox-tint-primary',
                !selectedProviderId && !selectedModelId ? SELECTED_CLASS : HOVER_CLASS
              )}
              onClick={() => handleSelect('', '')}
            >
              {autoText || t('Auto')}
            </button>
          )}
          {visibleModelCount === 0 ? (
            showAuto && activeTab === 'all' ? null : (
              <Stack gap="xs" py="md" px="sm" align="center">
                <Text c="chatbox-tertiary" size="xs">
                  {activeTab === 'favorite' ? t('No favorite models') : t('No eligible models available')}
                </Text>
              </Stack>
            )
          ) : activeTab === 'favorite' ? (
            <>
              {chatboxAIModelList && chatboxProvider && (
                <ChatboxProviderRows
                  catalog={chatboxAIModelList}
                  provider={chatboxProvider}
                  favoriteOnly
                  favorites={favoritedModelsSetting}
                  search={search}
                  groups={chatboxGroups}
                  collapsed={collapsedProviders[chatboxProvider.id] || false}
                  collapsedGroupIds={collapsedGroupIds}
                  advancedExpanded={advancedExpanded}
                  selectedProviderId={selectedProviderId}
                  selectedModelId={selectedModelId}
                  isMobile={isMobile}
                  modelDisabledCheck={modelDisabledCheck}
                  chatboxFilter={chatboxFilter}
                  isFavorited={isFavorited}
                  onToggleProvider={() => toggleProvider(chatboxProvider.id)}
                  onToggleGroup={toggleGroup}
                  onSetAdvancedExpanded={setAdvancedExpanded}
                  onSelect={handleSelect}
                  onToggleFavorite={toggleFavorite}
                  onShowMobileDetail={setMobileDetail}
                  onDesktopDetailOpen={openDesktopDetail}
                  onDesktopDetailClose={scheduleDesktopDetailClose}
                  onDisabledSelect={handleDisabledSelect}
                  pageName={pageName}
                />
              )}
              <GenericProviderRows
                hasChatboxCatalog={!!chatboxAIModelList}
                favoriteOnly
                favoritedModels={favoritedModels}
                genericProviders={genericProviders}
                collapsedProviders={collapsedProviders}
                search={search}
                selectedProviderId={selectedProviderId}
                selectedModelId={selectedModelId}
                isMobile={isMobile}
                modelFilter={modelFilter}
                modelDisabledCheck={modelDisabledCheck}
                isFavorited={isFavorited}
                onToggleProvider={toggleProvider}
                onSelect={handleSelect}
                onToggleFavorite={toggleFavorite}
                onShowMobileDetail={setMobileDetail}
                onDesktopDetailOpen={openDesktopDetail}
                onDesktopDetailClose={scheduleDesktopDetailClose}
                onDisabledSelect={handleDisabledSelect}
              />
            </>
          ) : (
            <>
              {chatboxAIModelList && chatboxProvider && (
                <ChatboxProviderRows
                  catalog={chatboxAIModelList}
                  provider={chatboxProvider}
                  favoriteOnly={false}
                  favorites={favoritedModelsSetting}
                  search={search}
                  groups={chatboxGroups}
                  collapsed={collapsedProviders[chatboxProvider.id] || false}
                  collapsedGroupIds={collapsedGroupIds}
                  advancedExpanded={advancedExpanded}
                  selectedProviderId={selectedProviderId}
                  selectedModelId={selectedModelId}
                  isMobile={isMobile}
                  modelDisabledCheck={modelDisabledCheck}
                  chatboxFilter={chatboxFilter}
                  isFavorited={isFavorited}
                  onToggleProvider={() => toggleProvider(chatboxProvider.id)}
                  onToggleGroup={toggleGroup}
                  onSetAdvancedExpanded={setAdvancedExpanded}
                  onSelect={handleSelect}
                  onToggleFavorite={toggleFavorite}
                  onShowMobileDetail={setMobileDetail}
                  onDesktopDetailOpen={openDesktopDetail}
                  onDesktopDetailClose={scheduleDesktopDetailClose}
                  onDisabledSelect={handleDisabledSelect}
                  pageName={pageName}
                />
              )}
              <GenericProviderRows
                hasChatboxCatalog={!!chatboxAIModelList}
                favoriteOnly={false}
                favoritedModels={favoritedModels}
                genericProviders={genericProviders}
                collapsedProviders={collapsedProviders}
                search={search}
                selectedProviderId={selectedProviderId}
                selectedModelId={selectedModelId}
                isMobile={isMobile}
                modelFilter={modelFilter}
                modelDisabledCheck={modelDisabledCheck}
                isFavorited={isFavorited}
                onToggleProvider={toggleProvider}
                onSelect={handleSelect}
                onToggleFavorite={toggleFavorite}
                onShowMobileDetail={setMobileDetail}
                onDesktopDetailOpen={openDesktopDetail}
                onDesktopDetailClose={scheduleDesktopDetailClose}
                onDisabledSelect={handleDisabledSelect}
              />
            </>
          )}
        </div>
        {!isMobile && searchPosition === 'bottom' && searchBox}
      </Stack>
    )

    if (isMobile) {
      return (
        <>
          <Drawer.Root open={mobileOpen} onOpenChange={handleMobileOpenChange} noBodyStyles>
            <Drawer.Trigger asChild>{children}</Drawer.Trigger>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
              <Drawer.Content className="fixed bottom-0 left-0 right-0 outline-none">
                <Stack
                  gap={0}
                  className={clsx(
                    'max-h-[88vh] rounded-t-[16px] border border-b-0 border-solid',
                    MODEL_SELECTOR_SURFACE_CLASS
                  )}
                  style={DRAWER_SURFACE_STYLE}
                >
                  <div aria-hidden className="mx-auto my-3 h-1 w-14 rounded-full bg-chatbox-tint-tertiary opacity-70" />
                  <Drawer.Title className="hidden">{t('Select Model')}</Drawer.Title>
                  {content}
                  <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
                </Stack>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
          <Drawer.Root
            open={!!mobileDetail}
            onOpenChange={(open) => {
              if (!open) setMobileDetail(null)
              blurActiveElement()
            }}
            noBodyStyles
          >
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
              <Drawer.Content className="fixed bottom-0 left-0 right-0 outline-none">
                <Stack
                  gap={0}
                  className={clsx('rounded-t-[16px] border border-b-0 border-solid', MODEL_SELECTOR_SURFACE_CLASS)}
                  style={DRAWER_SURFACE_STYLE}
                >
                  <div aria-hidden className="mx-auto my-3 h-1 w-14 rounded-full bg-chatbox-tint-tertiary opacity-70" />
                  <Drawer.Title className="hidden">{t('Model details')}</Drawer.Title>
                  {mobileDetail && (
                    <DetailCard
                      model={mobileDetail}
                      pricingLink={chatboxAIModelList?.links?.modelPricing}
                      upgradeLink={chatboxAIModelList?.links?.upgrade}
                      onClose={() => setMobileDetail(null)}
                      onUpgradeClick={() =>
                        pageName && trackUpgradeModelClick(pageName, 'upgrade_modal', mobileDetail.modelId)
                      }
                      mobile
                    />
                  )}
                  <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
                </Stack>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        </>
      )
    }

    return (
      <Combobox store={combobox} width={360} withinPortal {...comboboxProps}>
        <Combobox.Target targetType="button">
          {isValidElement(children) ? (
            cloneElement(children as ReactElement, {
              onClick: (event: MouseEvent<HTMLButtonElement>) => {
                children.props?.onClick?.(event)
                combobox.toggleDropdown()
              },
              ref,
            })
          ) : (
            <button
              type="button"
              onClick={() => combobox.toggleDropdown()}
              className="border-none bg-transparent p-0 flex"
            >
              {children}
            </button>
          )}
        </Combobox.Target>
        <Combobox.Dropdown
          ref={desktopDropdownRef}
          className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none"
          style={{ overflow: 'visible' }}
        >
          {content}
          {desktopDetail && (
            <div
              key={desktopDetail.key}
              ref={desktopDetailRef}
              className="absolute"
              style={{
                left: desktopDetail.left,
                top: desktopDetail.top,
                width: DESKTOP_DETAIL_CARD_OUTER_WIDTH,
                transform: 'translateY(-50%)',
                zIndex: 1,
              }}
              onMouseEnter={clearDesktopDetailCloseTimer}
              onMouseLeave={scheduleDesktopDetailClose}
            >
              <DetailCard
                model={desktopDetail.model}
                pricingLink={desktopDetail.pricingLink}
                upgradeLink={desktopDetail.upgradeLink}
                onUpgradeClick={() =>
                  pageName && trackUpgradeModelClick(pageName, 'upgrade_modal', desktopDetail.model.modelId)
                }
              />
            </div>
          )}
        </Combobox.Dropdown>
      </Combobox>
    )
  }
)

export default ModelSelectorV2
