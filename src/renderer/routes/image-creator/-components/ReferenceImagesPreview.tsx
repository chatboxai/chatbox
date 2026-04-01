import { ActionIcon, Flex, Image, Skeleton, Tooltip, UnstyledButton } from '@mantine/core'
import { IconPlus, IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useBlob } from '@/hooks/useBlob'
import { blobToDataUrl, MAX_REFERENCE_IMAGES } from './constants'

export interface ReferenceImagesPreviewProps {
  images: { storageKey: string }[]
  onRemove: (storageKey: string) => void
  onAddClick: () => void
}

export function ReferenceImagesPreview({ images, onRemove, onAddClick }: ReferenceImagesPreviewProps) {
  const { t } = useTranslation()

  if (images.length === 0) return null

  const canAddMore = images.length < MAX_REFERENCE_IMAGES

  return (
    <Flex gap="sm" className="overflow-x-auto pt-2 pb-1 -mt-2" wrap="nowrap">
      {images.map((img) => (
        <div key={img.storageKey} className="shrink-0 pt-2 pr-2">
          <ReferenceImageItem storageKey={img.storageKey} onRemove={onRemove} />
        </div>
      ))}
      {canAddMore && (
        <div className="shrink-0 pt-2">
          <Tooltip label={t('Add Reference Image')}>
            <UnstyledButton
              onClick={onAddClick}
              className="w-[64px] h-[64px] rounded-md border border-dashed border-[var(--chatbox-border-primary)] hover:border-[var(--chatbox-tint-tertiary)] flex items-center justify-center transition-colors"
            >
              <IconPlus size={18} className="text-[var(--chatbox-tint-tertiary)]" />
            </UnstyledButton>
          </Tooltip>
        </div>
      )}
    </Flex>
  )
}

function ReferenceImageItem({ storageKey, onRemove }: { storageKey: string; onRemove: (key: string) => void }) {
  const isUrl = storageKey.startsWith('http://') || storageKey.startsWith('https://')
  const { data: blob } = useBlob(isUrl ? undefined : storageKey)
  const url = isUrl ? storageKey : blob ? blobToDataUrl(blob) : null

  return (
    <div className="relative group">
      {url ? (
        <Image
          src={url}
          h={64}
          w={64}
          fit="cover"
          radius="md"
          className="border border-[var(--chatbox-border-primary)]"
        />
      ) : (
        <Skeleton h={64} w={64} radius="md" />
      )}
      <ActionIcon
        size="xs"
        variant="filled"
        color="dark"
        radius="xl"
        className="absolute -top-2 -right-2 shadow-md opacity-90"
        onClick={() => onRemove(storageKey)}
      >
        <IconX size={10} />
      </ActionIcon>
    </div>
  )
}
