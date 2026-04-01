import { ActionIcon, Flex, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core'
import type { ImageGeneration } from '@shared/types'
import { IconPlus } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { AccessibleDrawerContent } from '@/components/common/AccessibleDrawerContent'
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
        <AccessibleDrawerContent
          accessibleTitle={t('History')}
          accessibleDescription={t('Review recent image generations and reopen a previous result.')}
          className="flex flex-col rounded-t-xl h-[70vh] fixed bottom-0 left-0 right-0 outline-none bg-[var(--chatbox-background-primary)]"
        >
          <Drawer.Handle />
          <Flex
            align="center"
            justify="space-between"
            px="md"
            py="sm"
            className="border-b border-[var(--chatbox-border-primary)]"
          >
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
              {t('History')}
            </Text>
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

          <ScrollArea flex={1} type="auto" offsetScrollbars>
            <HistoryListContent
              historyCache={historyCache}
              historyLoading={historyLoading}
              currentRecordId={currentRecordId}
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
          </ScrollArea>
        </AccessibleDrawerContent>
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
  modelGroups: { label: string; providerId: string; models: { modelId: string; displayName: string }[] }[]
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

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} noBodyStyles>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
        <AccessibleDrawerContent
          accessibleTitle={t('Select Model')}
          accessibleDescription={t('Choose the provider model that should be used for image generation.')}
          className="flex flex-col rounded-t-xl max-h-[70vh] fixed bottom-0 left-0 right-0 outline-none bg-[var(--chatbox-background-primary)]"
        >
          <Drawer.Handle />
          <Flex
            align="center"
            justify="space-between"
            px="md"
            py="sm"
            className="border-b border-[var(--chatbox-border-primary)]"
          >
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
              {t('Select Model')}
            </Text>
          </Flex>

          <ScrollArea flex={1} type="auto" offsetScrollbars>
            <Stack gap="md" p="xs" pb="xl">
              {modelGroups.map((group, groupIndex) => (
                <Stack key={group.providerId} gap={2}>
                  <Text size="xs" fw={600} c="dimmed" px="sm" tt="uppercase" style={{ letterSpacing: 0.5 }}>
                    {group.label}
                  </Text>
                  {group.models.map((model) => {
                    const isSelected = selectedProvider === group.providerId && selectedModel === model.modelId
                    return (
                      <UnstyledButton
                        key={`${group.providerId}:${model.modelId}`}
                        onClick={() => {
                          onSelect(group.providerId, model.modelId)
                          onOpenChange(false)
                        }}
                        className={`
                          w-full px-4 py-3 rounded-lg transition-colors
                          ${isSelected ? 'bg-[var(--chatbox-background-brand-secondary)]' : 'hover:bg-[var(--chatbox-background-secondary)]'}
                        `}
                      >
                        <Text size="sm" fw={isSelected ? 600 : 400}>
                          {model.displayName}
                        </Text>
                      </UnstyledButton>
                    )
                  })}
                  {groupIndex < modelGroups.length - 1 && (
                    <div className="h-px bg-[var(--chatbox-border-primary)] mx-2 mt-2" />
                  )}
                </Stack>
              ))}
            </Stack>
          </ScrollArea>
        </AccessibleDrawerContent>
      </Drawer.Portal>
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
        <AccessibleDrawerContent
          accessibleTitle={t('Aspect Ratio')}
          accessibleDescription={t('Choose the aspect ratio for the image generation result.')}
          className="flex flex-col rounded-t-xl fixed bottom-0 left-0 right-0 outline-none bg-[var(--chatbox-background-primary)]"
        >
          <Drawer.Handle />
          <Flex
            align="center"
            justify="space-between"
            px="md"
            py="sm"
            className="border-b border-[var(--chatbox-border-primary)]"
          >
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
              {t('Aspect Ratio')}
            </Text>
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
        </AccessibleDrawerContent>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
