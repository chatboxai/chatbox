import { Collapse, Flex, Stack, Tabs, Text, TextInput } from '@mantine/core'
import type { ProviderModelInfo } from '@shared/types'
import { IconSearch } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAtom } from 'jotai'
import { forwardRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SwipeableViews from 'react-swipeable-views'
import { Drawer } from 'vaul'
import { useProviders } from '@/hooks/useProviders'
import { collapsedProvidersAtom } from '@/stores/atoms/uiAtoms'
import { AccessibleDrawerContent } from '../common/AccessibleDrawerContent'
import { ScalableIcon } from '../common/ScalableIcon'
import { ProviderHeader } from './ProviderHeader'
import { groupFavoriteModels, ModelItemInDrawer, SELECTED_BG_CLASS } from './shared'

type FilteredProvider = {
  id: string
  name: string
  isCustom?: boolean
  models?: ProviderModelInfo[]
}

interface MobileModelSelectorProps {
  children: React.ReactNode
  showAuto?: boolean
  autoText?: string
  selectedProviderId?: string
  selectedModelId?: string
  activeTab: string | null
  search: string
  filteredProviders: FilteredProvider[]
  onTabChange: (tab: string | null) => void
  onSearchChange: (search: string) => void
  onOptionSubmit: (val: string) => void
  modelFilter?: (model: ProviderModelInfo) => boolean
}

export const MobileModelSelector = forwardRef<HTMLDivElement, MobileModelSelectorProps>(
  (
    {
      children,
      showAuto,
      autoText,
      selectedProviderId,
      selectedModelId,
      activeTab,
      search,
      filteredProviders,
      onTabChange,
      onSearchChange,
      onOptionSubmit,
    },
    _ref
  ) => {
    const { t } = useTranslation()
    const { favoritedModels, favoriteModel, unfavoriteModel, isFavoritedModel } = useProviders()
    const [collapsedProviders, setCollapsedProviders] = useAtom(collapsedProvidersAtom)
    const [open, setOpen] = useState(false)

    // Convert activeTab to index for SwipeableViews (0 = 'all', 1 = 'favorite')
    const swipeIndex = useMemo(() => {
      return activeTab === 'favorite' ? 1 : 0
    }, [activeTab])

    const handleSwipeChange = (index: number) => {
      onTabChange(index === 0 ? 'all' : 'favorite')
    }

    const toggleProviderCollapse = (providerId: string) => {
      setCollapsedProviders((prev) => ({
        ...prev,
        [providerId]: !prev[providerId],
      }))
    }

    const handleOptionSubmit = (val: string) => {
      onOptionSubmit(val)
      setOpen(false)
    }

    // Render favorite tab content
    const renderFavoriteTab = () => {
      if (!favoritedModels || favoritedModels.length === 0) {
        return (
          <Flex align="center" justify="center" py="lg" px="xs">
            <Text c="chatbox-tertiary" size="sm">
              {t('No favorite models')}
            </Text>
          </Flex>
        )
      }

      return (
        <Stack gap="md">
          {Object.entries(groupFavoriteModels(favoritedModels)).map(([providerId, group]) => (
            <Stack key={providerId} gap={4}>
              <ProviderHeader
                provider={group.provider || { id: providerId, name: providerId }}
                modelCount={group.models.length}
                showChevron={false}
                variant="mobile"
              />
              {group.models.map((fm) => {
                if (!fm.provider || !fm.model) return null
                return (
                  <ModelItemInDrawer
                    key={`${fm.provider.id}/${fm.model.modelId}`}
                    providerId={fm.provider.id}
                    model={fm.model}
                    isFavorited={true}
                    isSelected={selectedProviderId === fm.provider.id && selectedModelId === fm.model.modelId}
                    hideFavoriteIcon={true}
                    onSelect={() => {
                      if (fm.provider && fm.model) {
                        handleOptionSubmit(`${fm.provider.id}/${fm.model.modelId}`)
                      }
                    }}
                    onToggleFavorited={() => {
                      if (fm.provider && fm.model) {
                        unfavoriteModel(fm.provider.id, fm.model.modelId)
                      }
                    }}
                  />
                )
              })}
            </Stack>
          ))}
        </Stack>
      )
    }

    return (
      <Drawer.Root open={open} onOpenChange={setOpen} noBodyStyles>
        <Drawer.Trigger asChild>{children}</Drawer.Trigger>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
          <AccessibleDrawerContent
            accessibleTitle={t('Select Model')}
            accessibleDescription={t('Search and choose a model from the available providers.')}
            className="flex flex-col rounded-t-[10px] h-fit fixed bottom-0 left-0 right-0 outline-none"
          >
            <Stack gap={0} className="bg-chatbox-background-primary rounded-t-lg h-[85vh]">
              <div aria-hidden className="mx-auto w-16 h-1 flex-shrink-0 rounded-full bg-chatbox-tint-tertiary my-3" />
              <Tabs value={activeTab} onChange={onTabChange}>
                <Tabs.List grow>
                  <Tabs.Tab value="all">{t('All')}</Tabs.Tab>
                  <Tabs.Tab value="favorite">{t('Favorite')}</Tabs.Tab>
                </Tabs.List>
              </Tabs>

              <Stack gap="md" className="flex-1 relative overflow-hidden">
                <SwipeableViews
                  index={swipeIndex}
                  onChangeIndex={handleSwipeChange}
                  resistance
                  style={{ height: '100%', width: '100%' }}
                  containerStyle={{ height: '100%' }}
                  slideStyle={{
                    overflow: 'auto',
                    scrollbarWidth: 'none',
                    WebkitOverflowScrolling: 'touch',
                    height: '100%',
                  }}
                >
                  {/* All Tab Content */}
                  <Stack gap="md" className="px-2 h-full overflow-y-auto scrollbar-none">
                    <TextInput
                      value={search}
                      onChange={(event) => onSearchChange(event.currentTarget.value)}
                      placeholder={t('Search models') as string}
                      leftSection={<ScalableIcon icon={IconSearch} />}
                      className="mt-2"
                    />

                    {showAuto && (
                      <Flex
                        component="button"
                        align="center"
                        gap="xs"
                        px="sm"
                        py="xs"
                        className={clsx(
                          'rounded-md outline-none',
                          !selectedProviderId && !selectedModelId
                            ? SELECTED_BG_CLASS
                            : 'bg-transparent active:bg-chatbox-background-brand-secondary-hover'
                        )}
                        onClick={() => {
                          handleOptionSubmit('')
                        }}
                      >
                        <Text
                          span
                          size="md"
                          c="chatbox-secondary"
                          lineClamp={1}
                          className="flex-grow-0 flex-shrink text-left"
                        >
                          {autoText || t('Auto')}
                        </Text>
                      </Flex>
                    )}
                    {filteredProviders.map((provider) => {
                      const isCollapsed = collapsedProviders[provider.id] || false
                      if (!provider.models?.length) return null
                      return (
                        <Stack key={provider.id} gap="xs">
                          <ProviderHeader
                            isCollapsed={isCollapsed}
                            provider={provider}
                            modelCount={provider.models?.length || 0}
                            onClick={() => toggleProviderCollapse(provider.id)}
                            variant="mobile"
                          />

                          <Collapse in={!isCollapsed}>
                            <Stack gap={4}>
                              {provider.models?.map((model: ProviderModelInfo) => {
                                const isFavorited = isFavoritedModel(provider.id, model.modelId)
                                return (
                                  <ModelItemInDrawer
                                    key={model.modelId}
                                    providerId={provider.id}
                                    model={model}
                                    isFavorited={isFavorited}
                                    isSelected={selectedProviderId === provider.id && selectedModelId === model.modelId}
                                    onSelect={() => {
                                      handleOptionSubmit(`${provider.id}/${model.modelId}`)
                                    }}
                                    onToggleFavorited={() => {
                                      if (isFavorited) {
                                        unfavoriteModel(provider.id, model.modelId)
                                      } else {
                                        favoriteModel(provider.id, model.modelId)
                                      }
                                    }}
                                  />
                                )
                              })}
                            </Stack>
                          </Collapse>
                        </Stack>
                      )
                    })}

                    <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
                  </Stack>

                  {/* Favorite Tab Content */}
                  <Stack gap="md" className="px-2 h-full overflow-y-auto scrollbar-none">
                    {renderFavoriteTab()}
                    <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
                  </Stack>
                </SwipeableViews>
              </Stack>
            </Stack>
          </AccessibleDrawerContent>
        </Drawer.Portal>
      </Drawer.Root>
    )
  }
)
