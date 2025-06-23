import { useProviders } from '@/hooks/useProviders'
import {
  cloneElement,
  FC,
  forwardRef,
  isValidElement,
  MouseEvent,
  PropsWithChildren,
  ReactElement,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Box,
  Button,
  Combobox,
  ComboboxProps,
  Divider,
  Drawer,
  Flex,
  FloatingPosition,
  Stack,
  Text,
  useCombobox,
} from '@mantine/core'
import { ModelProvider, ProviderModelInfo } from 'src/shared/types'
import ProviderIcon from './icons/ProviderIcon'
import { useNavigate } from '@tanstack/react-router'
import { useDisclosure } from '@mantine/hooks'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { IconStar, IconStarFilled } from '@tabler/icons-react'
import clsx from 'clsx'

export type ModelSelectorProps = PropsWithChildren<
  {
    showAuto?: boolean
    onSelect?: (provider: ModelProvider | string, model: string) => void
    onDropdownOpen?: () => void
  } & ComboboxProps
>

export const ModelSelector = forwardRef<HTMLDivElement, ModelSelectorProps>(
  ({ showAuto, onSelect, onDropdownOpen, children, ...comboboxProps }, ref) => {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { providers, favoritedModels, favoriteModel, unfavoriteModel, isFavoritedModel } = useProviders()

    const [search, setSearch] = useState('')
    const filteredProviders = useMemo(
      () =>
        providers.map((provider) => {
          const models = (provider.models || provider.defaultSettings?.models)?.filter(
            (model) =>
              provider.id.includes(search) ||
              provider.name.includes(search) ||
              model.nickname?.includes(search) ||
              model.modelId?.includes(search)
          )
          return {
            ...provider,
            models,
          }
        }),
      [providers, search]
    )
    const isEmpty = useMemo(
      () => filteredProviders.reduce((pre, cur) => pre + (cur.models?.length || 0), 0) === 0,
      [filteredProviders]
    )
    const combobox = useCombobox({
      onDropdownClose: () => {
        combobox.resetSelectedOption()
        combobox.focusTarget()
        setSearch('')
      },

      onDropdownOpen: () => {
        combobox.focusSearchInput()
        onDropdownOpen?.()
      },
    })

    const groups = filteredProviders.map((provider) => {
      provider
      const options = provider.models?.map((model) => {
        const isFavorited = isFavoritedModel(provider.id, model.modelId)

        return (
          <ModelItem
            key={`${provider.id}/${model.modelId}`}
            providerId={provider.id}
            model={model}
            isFavorited={isFavorited}
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

      return (
        <Combobox.Group
          label={
            <Flex align="center" gap="xs">
              {!provider.isCustom && <ProviderIcon size={12} provider={provider.id} />}
              <Text c="chatbox-tertiary" size="xs" fw={600}>
                {provider.name}
              </Text>
            </Flex>
          }
          key={provider.id}
        >
          {options}
        </Combobox.Group>
      )
    })

    const handleOptionSubmit = (val: string) => {
      if (!val) {
        onSelect?.('', '')
      } else {
        const selectedProvider = providers.find((p) =>
          (p.models || p.defaultSettings?.models)?.find((m) => val === `${p.id}/${m.modelId}`)
        )
        const selectedModel = (selectedProvider?.models || selectedProvider?.defaultSettings?.models)?.find(
          (m) => val === `${selectedProvider.id}/${m.modelId}`
        )

        if (selectedProvider && selectedModel) {
          onSelect?.(selectedProvider.id, selectedModel.modelId)
        }
      }
      combobox.closeDropdown()
    }

    const isSmallScreen = useIsSmallScreen()
    const [opened, { open, close }] = useDisclosure(false)

    return isSmallScreen ? (
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
          // className=' min-h-0'
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
          <Stack gap="md">
            {showAuto && (
              <Flex
                component="button"
                align="center"
                gap="xs"
                px="md"
                py="sm"
                className="rounded-md border-solid border border-[var(--mantine-color-chatbox-border-secondary-outline)] outline-none bg-transparent"
                onClick={() => {
                  handleOptionSubmit('')
                  close()
                }}
              >
                <Text span size="md" c="chatbox-secondary" lineClamp={1} className="flex-grow-0 flex-shrink text-left">
                  Auto
                </Text>
              </Flex>
            )}
            {!!favoritedModels?.length && (
              <Stack gap="xs">
                <Flex align="center" gap="xs" py="3xs" px="xxs" c="chatbox-tertiary">
                  <IconStarFilled size={16} className="text-inherit" />
                  <Text c="chatbox-tertiary" fw={600} className="uppercase">
                    {t('Favorite')}
                  </Text>
                </Flex>

                {favoritedModels.map((fm) => {
                  return (
                    <ModelItemInDrawer
                      key={`${fm.provider?.id}/${fm.model?.modelId}`}
                      providerId={fm.provider!.id}
                      model={fm.model!}
                      showIcon={true}
                      isFavorited={true}
                      onSelect={() => {
                        handleOptionSubmit(`${fm.provider?.id}/${fm.model?.modelId}`)
                        close()
                      }}
                      onToggleFavorited={() => {
                        unfavoriteModel(fm.provider!.id, fm.model!.modelId)
                      }}
                    />
                  )
                })}
              </Stack>
            )}
            {filteredProviders.map((provider) => (
              <Stack key={provider.id} gap="xs">
                <Flex align="center" gap="xs" py="3xs" px="xxs" c="chatbox-tertiary">
                  {!provider.isCustom && <ProviderIcon size={16} provider={provider.id} className="text-inherit" />}
                  <Text c="chatbox-tertiary" fw={600} className="uppercase">
                    {provider.name}
                  </Text>
                </Flex>
                {provider.models?.map((model) => {
                  const isFavorited = isFavoritedModel(provider.id, model.modelId)
                  return (
                    <ModelItemInDrawer
                      key={model.modelId}
                      providerId={provider.id}
                      model={model}
                      isFavorited={isFavorited}
                      onSelect={() => {
                        handleOptionSubmit(`${provider.id}/${model.modelId}`)
                        close()
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
            ))}
          </Stack>
        </Drawer>
      </>
    ) : (
      <Combobox
        store={combobox}
        width={260}
        position="top"
        withinPortal={true}
        {...comboboxProps}
        onOptionSubmit={handleOptionSubmit}
      >
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

        <Combobox.Dropdown>
          <Combobox.Search
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={t('Search models')!}
          />
          <Combobox.Options mah="50vh" style={{ overflowY: 'auto' }}>
            {showAuto && (
              <Combobox.Option value={''} c="chatbox-primary">
                Auto
              </Combobox.Option>
            )}
            {isEmpty && !showAuto ? (
              <Stack gap="xs" pt="xs" align="center" className="overflow-hidden">
                <Text c="chatbox-tertiary" size="xs">
                  {t('No eligible models available')}
                </Text>
                <Button variant="transparent" size="xs" onClick={() => navigate({ to: '/settings/provider' })}>
                  {t('Click here to set up')}
                </Button>
              </Stack>
            ) : (
              <>
                <Combobox.Group
                  label={
                    <Flex align="center" gap="xs">
                      <IconStar size={12} className="text-[var(--mantine-color-chatbox-tertiary-text)]" />
                      <Text c="chatbox-tertiary" size="xs" fw={600}>
                        {t('Favorite')}
                      </Text>
                    </Flex>
                  }
                >
                  {favoritedModels?.map((fm) => (
                    <ModelItem
                      key={`${fm.provider?.id}/${fm.model?.modelId}`}
                      showIcon={true}
                      providerId={fm.provider!.id}
                      model={fm.model!}
                      isFavorited={true}
                      onToggleFavorited={() => {
                        unfavoriteModel(fm.provider!.id, fm.model!.modelId)
                      }}
                    />
                  ))}
                </Combobox.Group>
                {groups}
              </>
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
    )
  }
)

export default ModelSelector

const ModelItem = ({
  providerId,
  model,
  isFavorited,
  onToggleFavorited,
  showIcon,
}: {
  providerId: string
  model: ProviderModelInfo
  isFavorited: boolean
  onToggleFavorited(): void
  showIcon?: boolean
}) => {
  return (
    <Combobox.Option value={`${providerId}/${model.modelId}`} className="flex flex-row items-center group">
      {showIcon && <ProviderIcon size={12} provider={providerId} className="mr-xs flex-shrink-0" />}
      <Text
        span
        className="flex-shrink"
        c={model.labels?.includes('recommended') ? 'chatbox-brand' : 'chatbox-primary'}
      >
        {model.nickname || model.modelId}
      </Text>
      {model.labels?.includes('pro') && (
        <Badge color="chatbox-brand" size="xs" variant="light" ml="xxs" className="flex-shrink-0 flex-grow-0">
          Pro
        </Badge>
      )}

      <Flex
        component="span"
        className={clsx(
          'ml-auto -m-xs p-xs',
          isFavorited
            ? 'text-[var(--mantine-color-chatbox-brand-outline)]'
            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto text-[var(--mantine-color-chatbox-border-secondary-outline)] hover:text-[var(--mantine-color-chatbox-brand-outline)]'
        )}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorited()
        }}
      >
        {isFavorited ? (
          <IconStarFilled size={16} className="text-inherit" />
        ) : (
          <IconStar size={16} className="text-inherit" />
        )}
      </Flex>
    </Combobox.Option>
  )
}

const ModelItemInDrawer = ({
  providerId,
  model,
  isFavorited,
  onToggleFavorited,
  onSelect,
  showIcon,
}: {
  providerId: string
  model: ProviderModelInfo
  isFavorited?: boolean
  onToggleFavorited?(): void
  onSelect?(): void
  showIcon?: boolean
}) => {
  const isRecommended = model.labels?.includes('recommended')
  return (
    <Flex
      component="button"
      key={model.modelId}
      align="center"
      gap="xs"
      px="md"
      py="sm"
      c={isRecommended ? 'chatbox-brand' : 'chatbox-secondary'}
      className="border-solid border border-[var(--mantine-color-chatbox-border-secondary-outline)] outline-none bg-transparent rounded-md"
      onClick={() => {
        onSelect?.()
      }}
    >
      {showIcon && <ProviderIcon size={20} provider={providerId} className="flex-shrink-0 text-inherit" />}

      <Text span size="md" className="flex-grow-0 flex-shrink text-left overflow-hidden break-words !text-inherit">
        {model.nickname || model.modelId}
      </Text>
      {model.labels?.includes('pro') && (
        <Badge color="chatbox-brand" size="xs" variant="light" className="flex-grow-0 flex-shrink-0">
          Pro
        </Badge>
      )}

      <Flex
        component="span"
        className={clsx(
          'ml-auto -m-xs p-xs',
          isFavorited
            ? 'text-[var(--mantine-color-chatbox-brand-outline)]'
            : 'text-[var(--mantine-color-chatbox-border-secondary-outline)]'
        )}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorited?.()
        }}
      >
        {isFavorited ? (
          <IconStarFilled size={16} className="text-inherit" />
        ) : (
          <IconStar size={16} className="text-inherit" />
        )}
      </Flex>
    </Flex>
  )
}
