import { Drawer, Flex, Stack, Tabs, Text, TextInput } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconSearch } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAtom } from 'jotai'
import { cloneElement, forwardRef, isValidElement, type MouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderModelInfo } from 'src/shared/types'
import { useProviders } from '@/hooks/useProviders'
import { collapsedProvidersAtom } from '@/stores/atoms/uiAtoms'
import { ScalableIcon } from '../ScalableIcon'
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
    ref
  ) => {
    const { t } = useTranslation()
    const { favoritedModels, favoriteModel, unfavoriteModel, isFavoritedModel } = useProviders()
    const [collapsedProviders, setCollapsedProviders] = useAtom(collapsedProvidersAtom)
    const [opened, { open, close }] = useDisclosure(false)

    const toggleProviderCollapse = (providerId: string) => {
      setCollapsedProviders((prev) => ({
        ...prev,
        [providerId]: !prev[providerId],
      }))
    }

    const handleOptionSubmit = (val: string) => {
      onOptionSubmit(val)
      close()
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
            <Stack key={providerId} gap="xs">
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
                    showIcon={false}
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
      <>
        {isValidElement(children) ? (
          cloneElement(children as ReactElement, {
            onClick: (e: MouseEvent<HTMLButtonElement, MouseEvent>) => {
              children.props?.onClick?.(e)
              open()
            },
            ref,
          })
        ) : (
          <button onClick={open} className="border-none bg-transparent p-0 flex">
            {children}
          </button>
        )}

        <Drawer
          opened={opened}
          onClose={close}
          position="bottom"
          title={t('Select Model')}
          classNames={{
            header: '!p-sm !min-h-0',
            body: '!px-xs',
            content: '!rounded-tl-lg !rounded-tr-lg',
          }}
          styles={{
            title: {
              flex: 1,
              marginLeft: 28,
              textAlign: 'center',
              fontWeight: 600,
            },
          }}
          size="80%"
          zIndex={3000}
          trapFocus={false}
        >
          <Stack gap="md" className="relative" style={{ maxHeight: 'calc(80vh - 100px)', overflowY: 'auto' }}>
            <Tabs value={activeTab} onChange={onTabChange}>
              <Tabs.List grow>
                <Tabs.Tab value="all">{t('All')}</Tabs.Tab>
                <Tabs.Tab value="favorite">{t('Favorite')}</Tabs.Tab>
              </Tabs.List>
            </Tabs>

            <TextInput
              value={search}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
              placeholder={t('Search models') as string}
              leftSection={<ScalableIcon icon={IconSearch} />}
            />

            {showAuto && activeTab === 'all' && (
              <Flex
                component="button"
                align="center"
                gap="xs"
                px="md"
                py="sm"
                className={clsx(
                  'rounded-md border-solid border border-chatbox-border-secondary outline-none',
                  !selectedProviderId && !selectedModelId ? SELECTED_BG_CLASS : 'bg-transparent'
                )}
                onClick={() => {
                  handleOptionSubmit('')
                }}
              >
                <Text span size="md" c="chatbox-secondary" lineClamp={1} className="flex-grow-0 flex-shrink text-left">
                  {autoText || t('Auto')}
                </Text>
              </Flex>
            )}
            {activeTab === 'favorite' ? (
              renderFavoriteTab()
            ) : (
              <>
                {favoritedModels && favoritedModels.length > 0 && (
                  <Stack gap="xs">
                    <ProviderHeader
                      provider={{ id: 'favorite', name: t('Favorite') }}
                      variant="mobile-favorite"
                      showChevron={false}
                    />

                    {favoritedModels.map((fm) => {
                      if (!fm.provider || !fm.model) return null
                      return (
                        <ModelItemInDrawer
                          key={`${fm.provider.id}/${fm.model.modelId}`}
                          providerId={fm.provider.id}
                          model={fm.model}
                          showIcon={true}
                          isFavorited={true}
                          isSelected={selectedProviderId === fm.provider.id && selectedModelId === fm.model.modelId}
                          hideFavoriteIcon={activeTab === 'favorite'}
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
                      {!isCollapsed &&
                        provider.models?.map((model: ProviderModelInfo) => {
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
                  )
                })}
              </>
            )}
          </Stack>
        </Drawer>
      </>
    )
  }
)
