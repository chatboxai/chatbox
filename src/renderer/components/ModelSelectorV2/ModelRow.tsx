import { ActionIcon, Flex, Text } from '@mantine/core'
import { AutomationAdjacentAttr, TestId } from '@shared/automation/testids'
import type { ProviderModelInfo } from '@shared/types'
import { IconBulb, IconEye, IconInfoCircle, IconLock, IconStar, IconStarFilled } from '@tabler/icons-react'
import clsx from 'clsx'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '../common/ScalableIcon'
import { ModelIcon } from '../icons/ModelIcon'
import { CAPABILITY_ICON_COLOR_CLASSES } from './CapabilityIconRow'
import { HOVER_CLASS, MOBILE_TAP_RESET_STYLE, SELECTED_CLASS } from './constants'
import type { DetailModel } from './types'

export function ModelRow({
  detail,
  providerModel,
  selected,
  favorited,
  locked,
  mobile,
  hideFavorite,
  brandedInset,
  onSelect,
  onFavorite,
  onShowDetail,
  onDesktopDetailOpen,
  onDesktopDetailClose,
  onDisabledSelect,
}: {
  detail: DetailModel
  providerModel: ProviderModelInfo
  selected: boolean
  favorited: boolean
  locked?: boolean
  mobile?: boolean
  hideFavorite?: boolean
  brandedInset?: boolean
  onSelect: () => void
  onFavorite: () => void
  onShowDetail?: () => void
  onDesktopDetailOpen?: (anchor: HTMLElement) => void
  onDesktopDetailClose?: () => void
  onDisabledSelect?: () => void
}) {
  const { t } = useTranslation()
  const isDisabled = !!detail.disabledReason && !locked
  const handleRowAction = () => {
    if (isDisabled) {
      onDisabledSelect?.()
      // Desktop reveals the reason via the hover detail card; on mobile, open it on tap.
      if (mobile) onShowDetail?.()
      return
    }
    if (locked) {
      onShowDetail?.()
      return
    }
    onSelect()
  }
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleRowAction()
  }
  const handleMouseEnter = (event: MouseEvent<HTMLDivElement>) => {
    onDesktopDetailOpen?.(event.currentTarget)
  }
  return (
    <div
      data-testid={TestId.model.option}
      data-provider-id={detail.providerId}
      {...{ [AutomationAdjacentAttr.modelId]: detail.modelId }}
      data-selected={selected ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      aria-disabled={isDisabled}
      className={clsx(
        'w-full flex items-center border-0 bg-transparent text-left cursor-pointer text-chatbox-tint-primary focus:outline-none focus-visible:outline-none',
        mobile
          ? clsx('min-h-11 pr-3 gap-2.5', brandedInset ? 'pl-4' : 'pl-3')
          : clsx('h-9 pr-2.5 gap-1.5', brandedInset ? 'pl-4' : 'pl-2.5'),
        selected ? SELECTED_CLASS : HOVER_CLASS,
        isDisabled && 'opacity-50 cursor-not-allowed'
      )}
      style={mobile ? MOBILE_TAP_RESET_STYLE : undefined}
      onClick={handleRowAction}
      onKeyDown={handleRowKeyDown}
      onMouseEnter={mobile ? undefined : handleMouseEnter}
      onMouseLeave={mobile ? undefined : onDesktopDetailClose}
    >
      <ModelIcon
        providerId={detail.providerId}
        modelId={detail.modelId}
        size={mobile ? 20 : 18}
        className="flex-shrink-0"
      />
      <Text
        data-testid={TestId.model.optionName}
        span
        size="sm"
        fw={500}
        lh={1.15}
        className="min-w-0 flex-shrink truncate"
      >
        {detail.name}
      </Text>
      <Flex align="center" gap={mobile ? 6 : 4} className="min-w-0 flex-shrink-0">
        {providerModel.capabilities?.includes('vision') && (
          <ScalableIcon
            icon={IconEye}
            size={mobile ? 16 : 14}
            aria-label={t('Vision') as string}
            className={CAPABILITY_ICON_COLOR_CLASSES.vision}
          />
        )}
        {providerModel.capabilities?.includes('reasoning') && (
          <ScalableIcon
            icon={IconBulb}
            size={mobile ? 16 : 14}
            aria-label={t('Reasoning') as string}
            className={CAPABILITY_ICON_COLOR_CLASSES.reasoning}
          />
        )}
        {mobile && (
          <ActionIcon
            aria-label={t('Model details') as string}
            variant="transparent"
            size="sm"
            className="text-chatbox-tint-tertiary hover:text-chatbox-tint-secondary"
            onClick={(event) => {
              event.stopPropagation()
              onShowDetail?.()
            }}
          >
            <ScalableIcon icon={IconInfoCircle} size={15} />
          </ActionIcon>
        )}
      </Flex>
      <Flex align="center" gap={4} ml="auto" className="flex-shrink-0">
        {locked && <ScalableIcon icon={IconLock} size={mobile ? 16 : 15} className="text-chatbox-tint-tertiary" />}
        {!hideFavorite && (
          <ActionIcon
            aria-label={favorited ? t('Remove from favorites') : t('Add to favorites')}
            variant="transparent"
            size="sm"
            className={
              favorited ? 'text-chatbox-tint-brand' : 'text-chatbox-tint-tertiary hover:text-chatbox-tint-brand'
            }
            onClick={(event) => {
              event.stopPropagation()
              onFavorite()
            }}
          >
            <ScalableIcon icon={favorited ? IconStarFilled : IconStar} size={mobile ? 19 : 17} />
          </ActionIcon>
        )}
      </Flex>
    </div>
  )
}
