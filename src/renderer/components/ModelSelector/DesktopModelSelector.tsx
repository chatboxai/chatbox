import {
  Button,
  Collapse,
  Combobox,
  type ComboboxProps,
  Flex,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  useCombobox,
} from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAtom } from 'jotai'
import { cloneElement, forwardRef, isValidElement, type MouseEvent, type ReactElement, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderModelInfo } from 'src/shared/types'
import { useProviders } from '@/hooks/useProviders'
import { navigateToSettings } from '@/modals/Settings'
import { collapsedProvidersAtom } from '@/stores/atoms/uiAtoms'
import { ScalableIcon } from '../ScalableIcon'
import { ProviderHeader } from './ProviderHeader'
import { groupFavoriteModels, ModelItem, SELECTED_BG_CLASS } from './shared'

type FilteredProvider = {
  id: string
  name: string
  isCustom?: boolean
  models?: ProviderModelInfo[]
}

interface DesktopModelSelectorProps {
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
  onDropdownOpen?: () => void
  modelFilter?: (model: ProviderModelInfo) => boolean
  comboboxProps?: ComboboxProps
  searchPosition?: 'top' | 'bottom'
}

// Search box component with integrated SegmentedControl
const SearchBox = ({
  search,
  activeTab,
  onSearchChange,
  onTabChange,
  t,
}: {
  search: string
  activeTab: string | null
  onSearchChange: (value: string) => void
  onTabChange: (value: string | null) => void
  t: (key: string) => string
}) => (
  <Flex align="center" className="px-xs py-xs">
    <ScalableIcon icon={IconSearch} className="text-chatbox-tint-gray" />
    <TextInput
      value={search}
      onChange={(event) => onSearchChange(event.currentTarget.value)}
      placeholder={t('Search models') as string}
      variant="unstyled"
      className="flex-1 ml-xs"
      styles={{
        input: {
          padding: 0,
          height: 'auto',
          minHeight: 'auto',
          fontSize: 'var(--mantine-font-size-sm)',
        },
      }}
    />
    <SegmentedControl
      value={activeTab || 'all'}
      onChange={(value) => onTabChange(value)}
      data={[
        { label: t('All'), value: 'all' },
        {
          label: t('Favorite'),
          value: 'favorite',
        },
      ]}
      size="xs"
    />
  </Flex>
)

export const DesktopModelSelector = forwardRef<HTMLDivElement, DesktopModelSelectorProps>(
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
      onDropdownOpen,
      comboboxProps,
      searchPosition = 'bottom',
    },
    ref
  ) => {
    const { t } = useTranslation()
    const { favoritedModels, favoriteModel, unfavoriteModel, isFavoritedModel } = useProviders()
    const [collapsedProviders, setCollapsedProviders] = useAtom(collapsedProvidersAtom)

    const toggleProviderCollapse = (providerId: string) => {
      setCollapsedProviders((prev) => ({
        ...prev,
        [providerId]: !prev[providerId],
      }))
    }

    const combobox = useCombobox({
      onDropdownClose: () => {
        combobox.resetSelectedOption()
        onSearchChange('')
      },
      onDropdownOpen: () => {
        onDropdownOpen?.()
      },
    })

    const isEmpty = useMemo(
      () => filteredProviders.reduce((pre, cur) => pre + (cur.models?.length || 0), 0) === 0,
      [filteredProviders]
    )

    const groups = filteredProviders.map((provider) => {
      const isCollapsed = collapsedProviders[provider.id] || false
      const options = provider.models?.map((model: ProviderModelInfo) => {
        const isFavorited = isFavoritedModel(provider.id, model.modelId)
        return (
          <ModelItem
            key={`${provider.id}/${model.modelId}`}
            providerId={provider.id}
            model={model}
            isFavorited={isFavorited}
            isSelected={selectedProviderId === provider.id && selectedModelId === model.modelId}
            onToggleFavorited={() => {
              if (isFavorited) {
                unfavoriteModel(provider.id, model.modelId)
              } else {
                favoriteModel(provider.id, model.modelId)
              }
            }}
          />
        )
      })

      if (!provider.models?.length) return null

      return (
        <div key={provider.id}>
          <ProviderHeader
            provider={provider}
            modelCount={provider.models?.length || 0}
            isCollapsed={isCollapsed}
            onClick={() => toggleProviderCollapse(provider.id)}
            className="-ml-xs -mr-xs pr-sm"
          />
          <Collapse in={!isCollapsed}>
            <div className="mb-xs">{options}</div>
          </Collapse>
        </div>
      )
    })

    const handleOptionSubmit = (val: string) => {
      onOptionSubmit(val)
      combobox.closeDropdown()
    }

    return (
      <Combobox store={combobox} width={350} withinPortal={true} {...comboboxProps} onOptionSubmit={handleOptionSubmit}>
        <Combobox.Target targetType="button">
          {isValidElement(children) ? (
            cloneElement(children as ReactElement, {
              onClick: (e: MouseEvent<HTMLButtonElement, MouseEvent>) => {
                children.props?.onClick?.(e)
                combobox.toggleDropdown()
              },
              ref,
            })
          ) : (
            <button onClick={() => combobox.toggleDropdown()} className="border-none bg-transparent p-0 flex">
              {children}
            </button>
          )}
        </Combobox.Target>

        <Combobox.Dropdown className="!p-0 overflow-hidden rounded-md">
          {searchPosition === 'top' && (
            <div className="sticky top-0 z-10" style={{ borderBottom: '1px solid var(--chatbox-border-primary)' }}>
              <SearchBox
                search={search}
                activeTab={activeTab}
                onSearchChange={onSearchChange}
                onTabChange={onTabChange}
                t={t}
              />
            </div>
          )}

          <Combobox.Options mah="50vh" style={{ overflowY: 'auto' }} className="px-xs pb-xs">
            {showAuto && activeTab === 'all' && (
              <Combobox.Option
                value={''}
                className={clsx(
                  'flex items-center -mx-xs px-xs',
                  !selectedProviderId && !selectedModelId ? SELECTED_BG_CLASS : ''
                )}
              >
                {autoText || t('Auto')}
              </Combobox.Option>
            )}
            {(isEmpty && !showAuto) ||
            (activeTab === 'favorite' && (!favoritedModels || favoritedModels.length === 0)) ? (
              <Stack gap="xs" pt="xs" align="center" className="overflow-hidden">
                <Text c="chatbox-tertiary" size="xs">
                  {activeTab === 'favorite' ? t('No favorite models') : t('No eligible models available')}
                </Text>
                {activeTab === 'all' && (
                  <Button variant="transparent" size="xs" onClick={() => navigateToSettings('/provider')}>
                    {t('Click here to set up')}
                  </Button>
                )}
              </Stack>
            ) : activeTab === 'favorite' ? (
              <div>
                {Object.entries(groupFavoriteModels(favoritedModels)).map(([providerId, group]) => (
                  <div key={providerId}>
                    <ProviderHeader
                      provider={group.provider || { id: providerId, name: providerId }}
                      showChevron={false}
                      showModelCount={false}
                      className="-ml-xs -mr-xs pr-sm"
                    />
                    <div className="mb-xs">
                      {group.models.map((fm) => {
                        if (!fm.provider || !fm.model) return null
                        return (
                          <ModelItem
                            key={`${fm.provider.id}/${fm.model.modelId}`}
                            providerId={fm.provider.id}
                            model={fm.model}
                            isFavorited={true}
                            isSelected={selectedProviderId === fm.provider.id && selectedModelId === fm.model.modelId}
                            hideFavoriteIcon={true}
                            onToggleFavorited={() => {
                              if (fm.provider && fm.model) {
                                unfavoriteModel(fm.provider.id, fm.model.modelId)
                              }
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {favoritedModels && favoritedModels.length > 0 && (
                  <div>
                    <ProviderHeader
                      provider={{ id: 'favorite', name: t('Favorite') }}
                      variant="favorite"
                      showChevron={false}
                      showModelCount={false}
                      className="-ml-xs -mr-xs pr-sm"
                    />
                    <div className="mb-xs">
                      {favoritedModels?.map((fm) => {
                        if (!fm.provider || !fm.model) return null
                        return (
                          <ModelItem
                            key={`${fm.provider.id}/${fm.model.modelId}`}
                            showIcon={true}
                            providerId={fm.provider.id}
                            model={fm.model}
                            isFavorited={true}
                            isSelected={selectedProviderId === fm.provider.id && selectedModelId === fm.model.modelId}
                            hideFavoriteIcon={true}
                            onToggleFavorited={() => {
                              if (fm.provider && fm.model) {
                                unfavoriteModel(fm.provider.id, fm.model.modelId)
                              }
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
                {groups}
              </>
            )}
          </Combobox.Options>

          {searchPosition === 'bottom' && (
            <div className="sticky bottom-0 z-10" style={{ borderTop: '1px solid var(--chatbox-border-primary)' }}>
              <SearchBox
                search={search}
                activeTab={activeTab}
                onSearchChange={onSearchChange}
                onTabChange={onTabChange}
                t={t}
              />
            </div>
          )}
        </Combobox.Dropdown>
      </Combobox>
    )
  }
)
