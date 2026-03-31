import { ActionIcon, Button, Flex, Image, Popover, Skeleton, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import type { ImageGeneration } from '@shared/types'
import { IconPhoto, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import storage from '@/storage'
import { blobToDataUrl, IMAGE_MODEL_FALLBACK_NAMES } from './constants'

export interface HistoryItemProps {
  record: ImageGeneration
  isActive: boolean
  isMobile?: boolean
  onClick: () => void
  onDelete: (id: string) => void
}

export function HistoryItem({ record, isActive, isMobile, onClick, onDelete }: HistoryItemProps) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const [deletePopoverOpened, setDeletePopoverOpened] = useState(false)
  const firstImage = record.generatedImages[0]
  const modelName = IMAGE_MODEL_FALLBACK_NAMES[record.model.modelId] || record.model.modelId || 'Unknown'

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isMobile) {
        if (window.confirm(String(t('Delete this record?')))) {
          onDelete(record.id)
        }
      } else {
        setDeletePopoverOpened(true)
      }
    },
    [isMobile, onDelete, record.id, t]
  )

  const handleConfirmDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete(record.id)
      setDeletePopoverOpened(false)
    },
    [onDelete, record.id]
  )

  const handleCancelDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletePopoverOpened(false)
  }, [])

  return (
    <UnstyledButton
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`
        w-full p-2 rounded-lg transition-all duration-150
        ${
          isActive
            ? 'bg-[var(--chatbox-background-brand-secondary)] ring-1 ring-[var(--chatbox-tint-brand)]'
            : isMobile
              ? ''
              : 'hover:bg-[var(--chatbox-background-secondary)]'
        }
      `}
    >
      <Flex gap="sm" align="center">
        <div className="w-12 h-12 rounded-md overflow-hidden shrink-0 bg-[var(--chatbox-background-secondary)]">
          {firstImage ? (
            <HistoryThumbnail storageKey={firstImage} size={48} />
          ) : (
            <Flex align="center" justify="center" h="100%">
              <IconPhoto size={16} className="opacity-30" />
            </Flex>
          )}
        </div>

        <Stack gap={2} flex={1} style={{ overflow: 'hidden' }}>
          <Text size="xs" lineClamp={2} fw={isActive ? 500 : 400} lh={1.3}>
            {record.prompt}
          </Text>
          <Flex align="center" gap={4}>
            <Text size="xs" c="dimmed">
              {new Date(record.createdAt).toLocaleDateString()}
            </Text>
            <Text size="xs" c="dimmed" className="opacity-40">
              ·
            </Text>
            <Text size="xs" c="dimmed">
              {modelName}
            </Text>
          </Flex>
        </Stack>

        {isMobile ? (
          <ActionIcon
            variant="transparent"
            color="gray"
            size="sm"
            onClick={handleDeleteClick}
            className="shrink-0 opacity-40 hover:opacity-100 transition-opacity"
          >
            <IconTrash size={14} />
          </ActionIcon>
        ) : (
          <Popover
            opened={deletePopoverOpened}
            onClose={() => setDeletePopoverOpened(false)}
            position="left"
            withArrow
            shadow="md"
            radius="md"
          >
            <Popover.Target>
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                radius="md"
                onClick={handleDeleteClick}
                className={`shrink-0 transition-opacity duration-150 ${
                  hovered || deletePopoverOpened ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown onClick={(e) => e.stopPropagation()}>
              <Stack gap="xs">
                <Text size="sm">{t('Delete this record?')}</Text>
                <Flex gap="xs" justify="flex-end">
                  <Button size="xs" variant="default" onClick={handleCancelDelete}>
                    {t('Cancel')}
                  </Button>
                  <Button size="xs" color="red" onClick={handleConfirmDelete}>
                    {t('Delete')}
                  </Button>
                </Flex>
              </Stack>
            </Popover.Dropdown>
          </Popover>
        )}
      </Flex>
    </UnstyledButton>
  )
}

interface HistoryThumbnailProps {
  storageKey: string
  size?: number
}

function HistoryThumbnail({ storageKey, size = 48 }: HistoryThumbnailProps) {
  const { data: imageUrl } = useQuery({
    queryKey: ['history-thumbnail', storageKey],
    queryFn: async () => {
      const blob = await storage.getBlob(storageKey)
      return blob ? blobToDataUrl(blob) : null
    },
  })

  if (!imageUrl) {
    return <Skeleton h={size} w={size} radius={0} />
  }

  return <Image src={imageUrl} h={size} w={size} fit="cover" radius={0} />
}
