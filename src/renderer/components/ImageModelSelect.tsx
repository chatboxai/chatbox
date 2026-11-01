import { ActionIcon, Combobox, type ComboboxProps, Flex, HoverCard, Text, useCombobox } from '@mantine/core'
import type { ModelProvider } from '@shared/types'
import { IconInfoCircle, IconServer } from '@tabler/icons-react'
import { forwardRef, type PropsWithChildren, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageModelGroup } from '@/hooks/useImageModelGroups'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { ScalableIcon } from './common/ScalableIcon'
import { getImageModelDetail, ImageModelDetailDrawer } from './ImageModelDetails'
import { ModelIcon } from './icons/ModelIcon'
import ProviderIcon from './icons/ProviderIcon'
import { DESKTOP_DETAIL_CARD_GAP, DESKTOP_DETAIL_CARD_OUTER_WIDTH } from './ModelSelectorV2/constants'
import { DetailCard } from './ModelSelectorV2/DetailCard'
import type { DetailModel } from './ModelSelectorV2/types'

function ProviderGroupLabel({ providerId, name, isCustom }: { providerId: string; name: string; isCustom?: boolean }) {
  return (
    <Flex align="center" gap={6} className="px-2 pt-2.5 pb-1">
      {isCustom ? (
        <ScalableIcon icon={IconServer} size={12} className="text-chatbox-tint-gray" />
      ) : (
        <ProviderIcon size={12} provider={providerId} className="opacity-50" />
      )}
      <Text size="xs" fw={500} c="dimmed">
        {name}
      </Text>
    </Flex>
  )
}

export type ImageModelSelectProps = PropsWithChildren<
  {
    modelGroups: ImageModelGroup[]
    opened?: boolean
    onChange?: (opened: boolean) => void
    onSelect?: (provider: ModelProvider, model: string) => void
  } & ComboboxProps
>

export const ImageModelSelect = forwardRef<HTMLButtonElement, ImageModelSelectProps>(
  ({ modelGroups, opened, onChange, onSelect, children, ...comboboxProps }, ref) => {
    const { t } = useTranslation()
    const selectorId = useId()
    const isMobile = useIsSmallScreen()
    const [targetNode, setTargetNode] = useState<HTMLElement | null>(null)
    const [dropdownNode, setDropdownNode] = useState<HTMLDivElement | null>(null)
    const [mobileDetail, setMobileDetail] = useState<DetailModel | null>(null)
    const [detailResetKey, setDetailResetKey] = useState(0)
    const openingDetailRef = useRef(false)
    const modalContent = isMobile ? targetNode?.closest<HTMLElement>('.mantine-Modal-content') : null

    const combobox = useCombobox({
      opened,
      onOpenedChange: onChange,
      onDropdownClose: () => {
        combobox.resetSelectedOption()
        if (!openingDetailRef.current) combobox.focusTarget()
        openingDetailRef.current = false
      },
    })

    useEffect(() => {
      if (!combobox.dropdownOpened) setDetailResetKey((key) => key + 1)
    }, [combobox.dropdownOpened])

    const handleOptionSubmit = (val: string) => {
      const { provider, modelId } = JSON.parse(val) as { provider: string; modelId: string }
      onSelect?.(provider as ModelProvider, modelId)
      combobox.closeDropdown()
    }

    return (
      <Combobox
        store={combobox}
        width={280}
        position="top"
        withinPortal={true}
        {...comboboxProps}
        portalProps={{ ...comboboxProps.portalProps, target: modalContent ?? comboboxProps.portalProps?.target }}
        onOptionSubmit={handleOptionSubmit}
      >
        <Combobox.Target ref={setTargetNode} targetType="button">
          <button ref={ref} onClick={() => combobox.toggleDropdown()} className="border-none bg-transparent p-0 flex">
            {children}
          </button>
        </Combobox.Target>

        <Combobox.Dropdown
          ref={setDropdownNode}
          className="!rounded-lg !border-[var(--chatbox-border-primary)] !shadow-lg"
          style={{ overflow: 'visible' }}
        >
          <Combobox.Options mah={400} style={{ overflowY: 'auto' }} className="p-1">
            {modelGroups.length === 0 ? (
              <Text size="sm" c="dimmed" px="sm" py="xs">
                {t('No models available')}
              </Text>
            ) : (
              modelGroups.map((group) => (
                <div key={group.providerId}>
                  <ProviderGroupLabel providerId={group.providerId} name={group.label} isCustom={group.isCustom} />
                  {group.models.map((model) => {
                    const detail = getImageModelDetail(group, model)
                    const option = (
                      <Combobox.Option
                        key={`${group.providerId}:${model.modelId}`}
                        value={JSON.stringify({ provider: group.providerId, modelId: model.modelId })}
                        className="!rounded-lg flex items-center gap-2"
                      >
                        <ModelIcon
                          providerId={group.providerId}
                          modelId={model.modelId}
                          size={16}
                          className="shrink-0"
                        />
                        <Text size="sm" className="min-w-0 flex-1 break-words">
                          {model.displayName}
                        </Text>
                        {isMobile && detail.description && (
                          <ActionIcon
                            aria-label={t('Model details') as string}
                            data-mantine-stop-propagation
                            variant="transparent"
                            size="sm"
                            className="shrink-0 text-chatbox-tint-tertiary hover:text-chatbox-tint-secondary"
                            onKeyDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation()
                              openingDetailRef.current = true
                              combobox.closeDropdown()
                              setMobileDetail(detail)
                            }}
                          >
                            <ScalableIcon icon={IconInfoCircle} size={15} />
                          </ActionIcon>
                        )}
                      </Combobox.Option>
                    )
                    if (isMobile || !detail.description) return option
                    return (
                      <HoverCard
                        key={`${group.providerId}:${model.modelId}:${detailResetKey}`}
                        id={`${selectorId}-${encodeURIComponent(JSON.stringify([group.providerId, model.modelId]))}`}
                        width={DESKTOP_DETAIL_CARD_OUTER_WIDTH}
                        position="right"
                        offset={DESKTOP_DETAIL_CARD_GAP}
                        openDelay={0}
                        closeDelay={120}
                        withinPortal
                        portalProps={{ target: dropdownNode || undefined }}
                      >
                        <HoverCard.Target>{option}</HoverCard.Target>
                        <HoverCard.Dropdown
                          className="!border-0 !bg-transparent !p-0 !shadow-none"
                          data-native-view-overlay
                        >
                          <DetailCard model={detail} />
                        </HoverCard.Dropdown>
                      </HoverCard>
                    )
                  })}
                </div>
              ))
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
        <ImageModelDetailDrawer
          model={mobileDetail}
          onClose={() => setMobileDetail(null)}
          onRestoreFocus={() => {
            if (targetNode?.isConnected) targetNode.focus({ preventScroll: true })
          }}
        />
      </Combobox>
    )
  }
)

ImageModelSelect.displayName = 'ImageModelSelect'

export default ImageModelSelect
