import { Badge, Button, Flex, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import type { ProviderModelInfo } from '@shared/types'
import { formatNumber } from '@shared/utils'
import {
  IconBulb,
  IconCircleMinus,
  IconCirclePlus,
  IconDatabase,
  IconEye,
  IconLogout,
  IconSearch,
  IconSettings,
  IconTool,
} from '@tabler/icons-react'
import { capitalize } from 'lodash'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from './common/ScalableIcon'

interface ModelListProps {
  models: ProviderModelInfo[]
  showActions?: boolean
  onEditModel?: (model: ProviderModelInfo) => void
  onDeleteModel?: (modelId: string) => void
  onAddModel?: (model: ProviderModelInfo) => void
  onRemoveModel?: (modelId: string) => void
  displayedModelIds?: string[]
  showSearch?: boolean
  className?: string
}

export function ModelList({
  models,
  showActions = true,
  onEditModel,
  onDeleteModel,
  onAddModel,
  onRemoveModel,
  displayedModelIds,
  showSearch = true,
  className,
}: ModelListProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models

    const query = searchQuery.toLowerCase()
    return models.filter((model) => {
      const displayName = (model.nickname || model.modelId).toLowerCase()
      return displayName.includes(query)
    })
  }, [models, searchQuery])

  const formatTokenCount = (count?: number) => {
    if (!count) return null
    return formatNumber(count)
  }

  // Legend only earns its row when at least one model shows capability icons (FABLE §9.7)
  const showCapabilityLegend = useMemo(
    () => models.some((model) => model.capabilities?.length || model.contextWindow || model.maxOutput),
    [models]
  )

  return (
    <Stack gap="sm" className={className}>
      {showSearch && models.length > 0 && (
        <TextInput
          placeholder={t('Search models...') as string}
          leftSection={<ScalableIcon icon={IconSearch} size={16} />}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          className="px-xxs pt-xxs"
        />
      )}

      <Stack
        gap={0}
        px="xxs"
        className={`border-solid border rounded-sm min-h-[100px] max-h-[80vh] overflow-y-auto border-workspaice-border-primary`}
      >
        {filteredModels.length > 0 ? (
          filteredModels.map((model) => (
            <Flex
              key={model.modelId}
              gap="xs"
              align="center"
              py="sm"
              px="xs"
              className="border-solid border-0 border-b last:border-b-0 border-workspaice-border-primary"
            >
              <Stack gap={4} flex="1 1 0" miw={0}>
                <Flex gap="xs" align="center" miw={0}>
                  <Text
                    component="span"
                    size="sm"
                    flex="1 1 auto"
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={model.nickname || model.modelId}
                    c={model.labels?.includes('recommended') ? 'workspaice-brand' : undefined}
                  >
                    {model.nickname || model.modelId}
                  </Text>
                  {model.labels?.includes('pro') && (
                    <Badge color="workspaice-brand" size="xs" variant="light">
                      Pro
                    </Badge>
                  )}
                  {model.labels?.includes('new') && (
                    <Badge color="teal" size="xs" variant="light">
                      New
                    </Badge>
                  )}
                </Flex>

                {(model.type !== 'chat' || model.capabilities?.length || model.contextWindow || model.maxOutput) && (
                  <Flex gap="xs" align="center" wrap="wrap">
                    {model.type && model.type !== 'chat' && <Badge color="blue">{t(capitalize(model.type))}</Badge>}

                    {model.capabilities?.includes('reasoning') && (
                      <Tooltip label={t('Reasoning')} events={{ hover: true, focus: true, touch: true }}>
                        <Text span c="workspaice-warning" className="flex items-center" style={{ opacity: 0.7 }}>
                          <ScalableIcon icon={IconBulb} size={14} />
                        </Text>
                      </Tooltip>
                    )}
                    {model.capabilities?.includes('vision') && (
                      <Tooltip label={t('Vision')} events={{ hover: true, focus: true, touch: true }}>
                        <Text span c="workspaice-brand" className="flex items-center" style={{ opacity: 0.7 }}>
                          <ScalableIcon icon={IconEye} size={14} />
                        </Text>
                      </Tooltip>
                    )}
                    {model.capabilities?.includes('tool_use') && (
                      <Tooltip label={t('Tool Use')} events={{ hover: true, focus: true, touch: true }}>
                        <Text span c="workspaice-success" className="flex items-center" style={{ opacity: 0.7 }}>
                          <ScalableIcon icon={IconTool} size={14} />
                        </Text>
                      </Tooltip>
                    )}

                    {model.contextWindow && (
                      <Tooltip
                        label={`${t('Context Window')}: ${formatTokenCount(model.contextWindow)} ${t('tokens')}`}
                        events={{ hover: true, focus: true, touch: true }}
                      >
                        <Flex gap={2} align="center" c="dimmed" style={{ flexShrink: 0, opacity: 0.8 }}>
                          <ScalableIcon icon={IconDatabase} size={12} />
                          <Text size="xs" style={{ whiteSpace: 'nowrap' }}>
                            {formatTokenCount(model.contextWindow)}
                          </Text>
                        </Flex>
                      </Tooltip>
                    )}
                    {model.maxOutput && (
                      <Tooltip
                        label={`${t('Max Output')}: ${formatTokenCount(model.maxOutput)} ${t('tokens')}`}
                        events={{ hover: true, focus: true, touch: true }}
                      >
                        <Flex gap={2} align="center" c="dimmed" style={{ flexShrink: 0, opacity: 0.8 }}>
                          <ScalableIcon icon={IconLogout} size={12} />
                          <Text size="xs" style={{ whiteSpace: 'nowrap' }}>
                            {formatTokenCount(model.maxOutput)}
                          </Text>
                        </Flex>
                      </Tooltip>
                    )}
                  </Flex>
                )}
              </Stack>

              {showActions && (
                <Flex flex="0 0 auto" gap="xs" align="center" className="ml-auto">
                  {onEditModel && (
                    <Button
                      variant="transparent"
                      c="workspaice-tertiary"
                      p={0}
                      h="auto"
                      size="xs"
                      bd={0}
                      onClick={() => onEditModel(model)}
                    >
                      <ScalableIcon icon={IconSettings} size={20} />
                    </Button>
                  )}

                  {onDeleteModel && (
                    <Button
                      variant="transparent"
                      c="workspaice-error"
                      p={0}
                      h="auto"
                      size="compact-xs"
                      bd={0}
                      onClick={() => onDeleteModel(model.modelId)}
                    >
                      <ScalableIcon icon={IconCircleMinus} size={20} />
                    </Button>
                  )}

                  {onAddModel &&
                    onRemoveModel &&
                    displayedModelIds &&
                    (displayedModelIds.includes(model.modelId) ? (
                      <Button
                        variant="transparent"
                        p={0}
                        h="auto"
                        size="xs"
                        bd={0}
                        onClick={() => onRemoveModel(model.modelId)}
                      >
                        <ScalableIcon icon={IconCircleMinus} size={20} className="text-workspaice-tint-error" />
                      </Button>
                    ) : (
                      <Button variant="transparent" p={0} h="auto" size="xs" bd={0} onClick={() => onAddModel(model)}>
                        <ScalableIcon icon={IconCirclePlus} size={20} className="text-workspaice-tint-success" />
                      </Button>
                    ))}
                </Flex>
              )}
            </Flex>
          ))
        ) : (
          <Flex align="center" justify="center" py="lg" px="xs">
            <Text component="span" size="sm" c="workspaice-tertiary">
              {searchQuery.trim() ? t('No models found matching your search') : t('No models available')}
            </Text>
          </Flex>
        )}
      </Stack>

      {showCapabilityLegend && (
        <Flex gap="md" align="center" wrap="wrap" px="xxs" style={{ opacity: 0.8 }}>
          <Flex gap={4} align="center" c="workspaice-warning">
            <ScalableIcon icon={IconBulb} size={12} />
            <Text size="xs" c="dimmed">
              {t('Reasoning')}
            </Text>
          </Flex>
          <Flex gap={4} align="center" c="workspaice-brand">
            <ScalableIcon icon={IconEye} size={12} />
            <Text size="xs" c="dimmed">
              {t('Vision')}
            </Text>
          </Flex>
          <Flex gap={4} align="center" c="workspaice-success">
            <ScalableIcon icon={IconTool} size={12} />
            <Text size="xs" c="dimmed">
              {t('Tool Use')}
            </Text>
          </Flex>
          <Flex gap={4} align="center" c="dimmed">
            <ScalableIcon icon={IconDatabase} size={12} />
            <Text size="xs" c="dimmed">
              {t('Context Window')}
            </Text>
          </Flex>
          <Flex gap={4} align="center" c="dimmed">
            <ScalableIcon icon={IconLogout} size={12} />
            <Text size="xs" c="dimmed">
              {t('Max Output')}
            </Text>
          </Flex>
        </Flex>
      )}
    </Stack>
  )
}
