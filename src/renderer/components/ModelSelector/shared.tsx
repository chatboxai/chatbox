import { Badge, Combobox, Flex, Text, Tooltip } from '@mantine/core'
import type { ProviderModelInfo } from '@shared/types'
import { IconBulb, IconEye, IconStar, IconStarFilled, IconTool } from '@tabler/icons-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ModelIcon } from '../icons/ModelIcon'
import { ScalableIcon } from '../common/ScalableIcon'

// Common styles
export const SELECTED_BG_CLASS = '!bg-chatbox-background-brand-secondary'
export const TRANSITION_DURATION = 200

// Helper function to group favorite models by provider
export type FavoriteModel = { provider?: { id: string; name: string; isCustom?: boolean }; model?: ProviderModelInfo }
export const groupFavoriteModels = (favoritedModels: FavoriteModel[] | undefined) => {
  if (!favoritedModels) return {}

  return favoritedModels.reduce(
    (acc, fm) => {
      const providerId = fm.provider?.id || 'unknown'
      if (!acc[providerId]) {
        acc[providerId] = {
          provider: fm.provider,
          models: [],
        }
      }
      acc[providerId].models.push(fm)
      return acc
    },
    {} as Record<string, { provider: FavoriteModel['provider']; models: FavoriteModel[] }>
  )
}

export const ModelItem = ({
  providerId,
  providerName,
  model,
  isFavorited,
  isSelected,
  onToggleFavorited,
  hideFavoriteIcon,
}: {
  providerId: string
  providerName?: string
  model: ProviderModelInfo
  isFavorited: boolean
  isSelected?: boolean
  onToggleFavorited(): void
  hideFavoriteIcon?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <Combobox.Option
      value={`${providerId}/${model.modelId}`}
      className={clsx(
        'flex flex-row items-center group -mx-xs px-xs',
        !isSelected && 'hover:bg-chatbox-background-brand-secondary-hover',
        isSelected && SELECTED_BG_CLASS
      )}
    >
      <ModelIcon modelId={model.modelId} providerId={providerId} size={16} className="mr-xs flex-shrink-0" />
      <Text
        span
        className="flex-shrink"
        c={model.labels?.includes('recommended') ? 'chatbox-brand' : 'chatbox-primary'}
      >
        {model.nickname || model.modelId}
      </Text>
      {providerName && (
        <Text span size="xs" c="chatbox-tertiary" className="ml-xxs flex-shrink-0">
          ({providerName})
        </Text>
      )}
      {model.labels?.includes('pro') && (
        <Badge color="chatbox-brand" size="xs" variant="light" ml="xxs" className="flex-shrink-0 flex-grow-0">
          Pro
        </Badge>
      )}
      {model.labels?.includes('new') && (
        <Badge color="teal" size="xs" variant="light" ml="xxs" className="flex-shrink-0 flex-grow-0">
          New
        </Badge>
      )}

      {model.capabilities?.includes('reasoning') && (
        <Tooltip label={t('Reasoning')} events={{ hover: true, focus: true, touch: true }}>
          <Text span c="chatbox-warning" className="flex items-center ml-xxs" style={{ opacity: 0.7 }}>
            <ScalableIcon icon={IconBulb} size={14} />
          </Text>
        </Tooltip>
      )}
      {model.capabilities?.includes('vision') && (
        <Tooltip label={t('Vision')} events={{ hover: true, focus: true, touch: true }}>
          <Text span c="chatbox-brand" className="flex items-center ml-xxs" style={{ opacity: 0.7 }}>
            <ScalableIcon icon={IconEye} size={14} />
          </Text>
        </Tooltip>
      )}
      {model.capabilities?.includes('tool_use') && (
        <Tooltip label={t('Tool Use')} events={{ hover: true, focus: true, touch: true }}>
          <Text span c="chatbox-success" className="flex items-center ml-xxs" style={{ opacity: 0.7 }}>
            <ScalableIcon icon={IconTool} size={14} />
          </Text>
        </Tooltip>
      )}

      {!hideFavoriteIcon && (
        <Flex
          component="span"
          className={clsx(
            'ml-auto -m-xs p-xs',
            isFavorited
              ? 'text-chatbox-tint-brand'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto text-chatbox-border-secondary hover:text-chatbox-tint-brand'
          )}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorited()
          }}
        >
          {isFavorited ? (
            <ScalableIcon icon={IconStarFilled} className="text-inherit" />
          ) : (
            <ScalableIcon icon={IconStar} className="text-inherit" />
          )}
        </Flex>
      )}
    </Combobox.Option>
  )
}

export const ModelItemInDrawer = ({
  providerId,
  providerName,
  model,
  isFavorited,
  isSelected,
  onToggleFavorited,
  onSelect,
  hideFavoriteIcon,
}: {
  providerId: string
  providerName?: string
  model: ProviderModelInfo
  isFavorited?: boolean
  isSelected?: boolean
  onToggleFavorited?(): void
  onSelect?(): void
  hideFavoriteIcon?: boolean
}) => {
  const { t } = useTranslation()
  const isRecommended = model.labels?.includes('recommended')
  return (
    <Flex
      component="button"
      key={model.modelId}
      align="center"
      gap="xs"
      px="sm"
      py="xs"
      c={isRecommended ? 'chatbox-brand' : 'chatbox-secondary'}
      className={clsx(
        'outline-none rounded-md border-0',
        isSelected ? SELECTED_BG_CLASS : 'bg-transparent active:bg-chatbox-background-brand-secondary-hover'
      )}
      onClick={() => {
        onSelect?.()
      }}
    >
      <ModelIcon modelId={model.modelId} providerId={providerId} size={20} className="flex-shrink-0" />

      <Text span size="md" className="flex-grow-0 flex-shrink text-left overflow-hidden break-words !text-inherit">
        {model.nickname || model.modelId}
      </Text>
      {providerName && (
        <Text span size="xs" c="chatbox-tertiary" className="flex-shrink-0">
          ({providerName})
        </Text>
      )}
      {model.labels?.includes('pro') && (
        <Badge color="chatbox-brand" size="xs" variant="light" className="flex-grow-0 flex-shrink-0">
          Pro
        </Badge>
      )}
      {model.labels?.includes('new') && (
        <Badge color="teal" size="xs" variant="light" className="flex-grow-0 flex-shrink-0">
          New
        </Badge>
      )}

      {model.capabilities?.includes('reasoning') && (
        <Tooltip label={t('Reasoning')} events={{ hover: true, focus: true, touch: true }}>
          <Text span c="chatbox-warning" className="flex items-center" style={{ opacity: 0.7 }}>
            <ScalableIcon icon={IconBulb} size={14} />
          </Text>
        </Tooltip>
      )}
      {model.capabilities?.includes('vision') && (
        <Tooltip label={t('Vision')} events={{ hover: true, focus: true, touch: true }}>
          <Text span c="chatbox-brand" className="flex items-center" style={{ opacity: 0.7 }}>
            <ScalableIcon icon={IconEye} size={14} />
          </Text>
        </Tooltip>
      )}
      {model.capabilities?.includes('tool_use') && (
        <Tooltip label={t('Tool Use')} events={{ hover: true, focus: true, touch: true }}>
          <Text span c="chatbox-success" className="flex items-center" style={{ opacity: 0.7 }}>
            <ScalableIcon icon={IconTool} size={14} />
          </Text>
        </Tooltip>
      )}

      {!hideFavoriteIcon && (
        <Flex
          component="span"
          className={clsx(
            'ml-auto -m-xs p-xs',
            isFavorited ? 'text-chatbox-tint-brand' : 'text-chatbox-border-secondary'
          )}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorited?.()
          }}
        >
          {isFavorited ? (
            <ScalableIcon icon={IconStarFilled} className="text-inherit" />
          ) : (
            <ScalableIcon icon={IconStar} className="text-inherit" />
          )}
        </Flex>
      )}
    </Flex>
  )
}
