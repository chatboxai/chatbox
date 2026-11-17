import { ActionIcon, Box, Flex, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core'
import type { ImageGeneration } from '@shared/types'
import { IconInfoCircle, IconPlus, IconServer } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { getImageModelDetail, ImageModelDetailDrawer } from '@/components/ImageModelDetails'
import { ModelIcon } from '@/components/icons/ModelIcon'
import ProviderIcon from '@/components/icons/ProviderIcon'
import type { DetailModel } from '@/components/ModelSelectorV2/types'
import type { ImageModelGroup } from '@/hooks/useImageModelGroups'
import { HistoryListContent } from './HistoryPanel'

/* ============================================
   Mobile History Drawer
   ============================================ */

export interface MobileHistoryDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  historyCache: ImageGeneration[]
  historyLoading: boolean
  currentRecordId: string | null
  getModelDisplayName: (record: ImageGeneration) => string
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onItemClick: (record: ImageGeneration) => void
  onLoadMore: () => void
  onNewCreation: () => void
  onDelete: (id: string) => void
}

export function MobileHistoryDrawer({
  open,
  onOpenChange,
  historyCache,
  historyLoading,
  currentRecordId,
  getModelDisplayName,
  hasNextPage,
  isFetchingNextPage,
  onItemClick,
  onLoadMore,
  onNewCreation,
  onDelete,
}: MobileHistoryDrawerProps) {
  const { t } = useTranslation()

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} noBodyStyles>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
        <Drawer.Content className="flex flex-col rounded-t-xl h-[70vh] fixed bottom-0 left-0 right-0 outline-none bg-[var(--chatbox-background-primary)]">
          <Drawer.Handle />
          <Flex
            align="center"
            justify="space-between"
            px="md"
            py="sm"
            className="border-b border-[var(--chatbox-border-primary)]"
          >
            <Drawer.Title asChild>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
                {t('History')}
              </Text>
            </Drawer.Title>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => {
                onNewCreation()
                onOpenChange(false)
              }}
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Flex>

          <Box flex={1}>
            <HistoryListContent
              historyCache={historyCache}
              historyLoading={historyLoading}
              currentRecordId={currentRecordId}
              getModelDisplayName={getModelDisplayName}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              isMobile
              onItemClick={(record) => {
                onItemClick(record)
                onOpenChange(false)
              }}
              onLoadMore={onLoadMore}
              onDelete={onDelete}
            />
          </Box>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

/* ============================================
   Mobile Model Drawer
   ============================================ */

export interface MobileModelDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelGroups: ImageModelGroup[]
  selectedProvider: string
  selectedModel: string
  onSelect: (provider: string, model: string) => void
}

export function MobileModelDrawer({
  open,
  onOpenChange,
  modelGroups,
  selectedProvider,
  selectedModel,
  onSelect,
}: MobileModelDrawerProps) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<DetailModel | null>(null)
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null)

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} noBodyStyles>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
        <Drawer.Content className="flex flex-col rounded-t-xl max-h-[70vh] fixed bottom-0 left-0 right-0 outline-none bg-[var(--chatbox-background-primary)]">
          <Drawer.Handle />
          <Flex
            align="center"
            justify="space-between"
            px="md"
            py="sm"
            className="border-b border-[var(--chatbox-border-primary)]"
          >
            <Drawer.Title asChild>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
                {t('Select Model')}
              </Text>
            </Drawer.Title>
          </Flex>

          <ScrollArea flex={1} type="auto" offsetScrollbars>
            <Stack gap="md" p="xs" pb="xl">
              {modelGroups.map((group, groupIndex) => (
                <Stack key={group.providerId} gap={2}>
                  <Flex align="center" gap={6} px="sm">
                    {group.isCustom ? (
                      <ScalableIcon icon={IconServer} size={14} className="text-chatbox-tint-gray" />
                    ) : (
                      <ProviderIcon size={14} provider={group.providerId} className="opacity-50" />
                    )}
                    <Text size="xs" fw={500} c="dimmed">
                      {group.label}
                    </Text>
                  </Flex>
                  {group.models.map((model) => {
                    const isSelected = selectedProvider === group.providerId && selectedModel === model.modelId
                    return (
                      <Flex
                        key={`${group.providerId}:${model.modelId}`}
                        align="center"
                        className={`
                          w-full rounded-lg transition-colors
                          ${isSelected ? 'bg-[var(--chatbox-background-brand-secondary)]' : 'hover:bg-[var(--chatbox-background-secondary)]'}
                        `}
                      >
                        <UnstyledButton
                          className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3"
                          onClick={() => {
                            onSelect(group.providerId, model.modelId)
                            onOpenChange(false)
                          }}
                        >
                          <ModelIcon
                            providerId={group.providerId}
                            modelId={model.modelId}
                            size={20}
                            className="shrink-0"
                          />
                          <Text size="sm" fw={isSelected ? 600 : 400} className="min-w-0 break-words">
                            {model.displayName}
                          </Text>
                        </UnstyledButton>
                        {model.description?.trim() && (
                          <ActionIcon
                            aria-label={t('Model details') as string}
                            variant="transparent"
                            size="sm"
                            className="mr-4 shrink-0 text-chatbox-tint-tertiary hover:text-chatbox-tint-secondary"
                            onClick={(event) => {
                              detailTriggerRef.current = event.currentTarget
                              setDetail(getImageModelDetail(group, model))
                            }}
                          >
                            <ScalableIcon icon={IconInfoCircle} size={15} />
                          </ActionIcon>
                        )}
                      </Flex>
                    )
                  })}
                  {groupIndex < modelGroups.length - 1 && (
                    <div className="h-px bg-[var(--chatbox-border-primary)] mx-2 mt-2" />
                  )}
                </Stack>
              ))}
            </Stack>
          </ScrollArea>
        </Drawer.Content>
      </Drawer.Portal>
      <ImageModelDetailDrawer
        model={detail}
        onClose={() => setDetail(null)}
        onRestoreFocus={() => {
          if (detailTriggerRef.current?.isConnected) detailTriggerRef.current.focus({ preventScroll: true })
        }}
      />
    </Drawer.Root>
  )
}

/* ============================================
   Mobile Ratio Drawer
   ============================================ */

export interface MobileRatioDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: string[]
  selectedRatio: string
  onSelect: (ratio: string) => void
}

export function MobileRatioDrawer({ open, onOpenChange, options, selectedRatio, onSelect }: MobileRatioDrawerProps) {
  const { t } = useTranslation()

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} noBodyStyles>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
        <Drawer.Content className="flex flex-col rounded-t-xl fixed bottom-0 left-0 right-0 outline-none bg-[var(--chatbox-background-primary)]">
          <Drawer.Handle />
          <Flex
            align="center"
            justify="space-between"
            px="md"
            py="sm"
            className="border-b border-[var(--chatbox-border-primary)]"
          >
            <Drawer.Title asChild>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
                {t('Aspect Ratio')}
              </Text>
            </Drawer.Title>
          </Flex>

          <Stack gap={2} p="xs" pb="xl">
            {options.map((ratio) => (
              <UnstyledButton
                key={ratio}
                onClick={() => {
                  onSelect(ratio)
                  onOpenChange(false)
                }}
                className={`
                  w-full px-4 py-3 rounded-lg transition-colors
                  ${selectedRatio === ratio ? 'bg-[var(--chatbox-background-brand-secondary)]' : 'hover:bg-[var(--chatbox-background-secondary)]'}
                `}
              >
                <Text size="sm" fw={selectedRatio === ratio ? 600 : 400} ta="center">
                  {ratio}
                </Text>
              </UnstyledButton>
            ))}
          </Stack>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
