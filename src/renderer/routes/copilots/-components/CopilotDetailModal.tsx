import NiceModal from '@ebay/nice-modal-react'
import { Avatar, Button, CloseButton, Flex, ScrollArea, Stack, Text } from '@mantine/core'
import type { CopilotDetail, ImageSource } from '@shared/types'
import { IconEdit, IconMessageCircle2Filled } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Gallery, Item as GalleryItem } from 'react-photoswipe-gallery'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { ImageInStorage } from '@/components/Image'
import { useFetchBlob } from '@/hooks/useBlob'
import { useMyCopilots } from '@/hooks/useCopilots'

function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = reject
    img.src = src
  })
}

function CopilotScreenshotGalleryItem({
  source,
  alt,
  className,
}: {
  source: ImageSource
  alt?: string
  className?: string
}) {
  if (source.type === 'storage-key') {
    return <StorageKeyGalleryItem storageKey={source.storageKey} className={className} />
  }
  return <UrlGalleryItem url={source.url} alt={alt} className={className} />
}

function UrlGalleryItem({ url, alt, className }: { url: string; alt?: string; className?: string }) {
  const { data: size } = useQuery({
    queryKey: ['copilot-screenshot-url-size', url],
    queryFn: () => loadImageSize(url),
    staleTime: Infinity,
    gcTime: 60 * 1000,
  })

  return (
    <GalleryItem original={url} thumbnail={url} width={size?.width ?? 1024} height={size?.height ?? 1024}>
      {({ ref, open }) => (
        <img ref={ref} src={url} alt={alt} className={`cursor-pointer ${className || ''}`} onClick={open} />
      )}
    </GalleryItem>
  )
}

function StorageKeyGalleryItem({ storageKey, className }: { storageKey: string; className?: string }) {
  const fetchBlob = useFetchBlob()
  const { data: pic } = useQuery({
    queryKey: ['copilot-screenshot-gallery', storageKey],
    queryFn: async () => {
      const blob = await fetchBlob(storageKey)
      if (!blob) return null
      const base64 = blob.startsWith('data:image/') ? blob : `data:image/png;base64,${blob}`
      const size = await loadImageSize(base64)
      return { data: base64, ...size }
    },
    staleTime: Infinity,
    gcTime: 60 * 1000,
  })

  if (!pic) return <ImageInStorage storageKey={storageKey} className={className} />

  return (
    <GalleryItem original={pic.data} thumbnail={pic.data} width={pic.width} height={pic.height}>
      {({ ref, open }) => (
        <img ref={ref} src={pic.data} className={`cursor-pointer ${className || ''}`} onClick={open} />
      )}
    </GalleryItem>
  )
}

interface CopilotDetailModalProps {
  opened: boolean
  onClose: () => void
  type: 'local' | 'remote'
  copilot: CopilotDetail | null
  onUse?: (copilot: CopilotDetail) => void
}

export function CopilotDetailModal({ opened, onClose, type, copilot, onUse }: CopilotDetailModalProps) {
  const { t, i18n } = useTranslation()
  const { addOrUpdate } = useMyCopilots()
  const galleryOpenRef = useRef(false)

  const handleClose = useCallback(() => {
    if (galleryOpenRef.current) return
    onClose()
  }, [onClose])

  if (!copilot) return null

  const { name, avatar, picUrl, description, prompt, tags, screenshots, createdAt } = copilot

  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <AdaptiveModal
      opened={opened}
      onClose={handleClose}
      centered
      size="lg"
      trapFocus={false}
      withCloseButton={false}
      padding={0}
    >
      <Stack gap="xl" p="sm">
        <Stack gap="md">
          {/* Header: Avatar + Title + Tags + Date + Close */}
          <Flex align="center" gap="sm">
            {avatar?.type === 'storage-key' || avatar?.type === 'url' || picUrl ? (
              <Avatar
                src={avatar?.type === 'storage-key' ? '' : avatar?.url || picUrl}
                alt={name}
                size={48}
                radius="xl"
                className="flex-shrink-0 border border-solid border-chatbox-border-primary"
              >
                {avatar?.type === 'storage-key' ? (
                  <ImageInStorage storageKey={avatar.storageKey} className="object-cover object-center w-full h-full" />
                ) : (
                  name?.charAt(0)?.toUpperCase()
                )}
              </Avatar>
            ) : (
              <Stack
                w={48}
                h={48}
                align="center"
                justify="center"
                className="flex-shrink-0 rounded-full bg-chatbox-background-brand-secondary"
              >
                <ScalableIcon icon={IconMessageCircle2Filled} size={24} className="text-chatbox-tint-brand" />
              </Stack>
            )}

            <Stack gap={0} className="flex-1">
              <Text fw={600} size="lg" lineClamp={1}>
                {name}
              </Text>
              <Flex align="center" gap="xs" wrap="wrap">
                {tags?.map((tag) => (
                  <Text
                    key={tag}
                    span
                    size="xxs"
                    c="chatbox-brand"
                    px={8}
                    py={2}
                    className="block rounded-full bg-chatbox-background-brand-secondary"
                  >
                    {t(tag)}
                  </Text>
                ))}
                {formattedDate && (
                  <Text size="xxs" c="chatbox-tertiary" className="whitespace-nowrap">
                    {type === 'remote'
                      ? t('Published on {{date}}', { date: formattedDate })
                      : t('Created on {{date}}', { date: formattedDate })}
                  </Text>
                )}
              </Flex>
            </Stack>

            <CloseButton onClick={onClose} className="self-start max-md:hidden" />
          </Flex>

          {/* Description */}
          {description && (
            <Stack gap="xxs">
              <Text size="sm" c="chatbox-secondary">
                {t('Description')}
              </Text>
              <Text size="sm" c="chatbox-secondary" py={6} className="whitespace-pre-wrap">
                {description}
              </Text>
            </Stack>
          )}

          {/* Prompt Content */}
          {prompt && (
            <Stack gap="xxs" my="xs">
              <Text size="sm" c="chatbox-secondary">
                {t('Prompt Content')}
              </Text>
              <ScrollArea.Autosize mah="40vh" className="rounded-sm border border-solid border-chatbox-border-primary ">
                <Text size="sm" c="chatbox-primary" p="xs" className="whitespace-pre-wrap">
                  {prompt}
                </Text>
              </ScrollArea.Autosize>
            </Stack>
          )}

          {/* Screenshots */}
          {screenshots && screenshots.length > 0 && (
            <Stack gap="xxs">
              <Text size="sm" c="chatbox-secondary">
                {t('Screenshots')}
              </Text>
              <Gallery
                onOpen={(pswp) => {
                  galleryOpenRef.current = true
                  pswp.on('close', () => {
                    setTimeout(() => {
                      galleryOpenRef.current = false
                    }, 100)
                  })
                }}
              >
                <Flex gap="xs" wrap="wrap" className="overflow-x-auto pb-xs">
                  {screenshots.map((screenshot) => {
                    const key = screenshot.type === 'storage-key' ? screenshot.storageKey : screenshot.url
                    return (
                      <CopilotScreenshotGalleryItem
                        key={key}
                        source={screenshot}
                        alt={name}
                        className="h-[120px] w-[120px] rounded-sm border border-solid border-chatbox-border-primary object-cover"
                      />
                    )
                  })}
                </Flex>
              </Gallery>
            </Stack>
          )}
        </Stack>

        {/* Footer Actions */}
        <Flex justify="flex-end" gap="xs">
          {type === 'local' && (
            <Button
              variant="outline"
              leftSection={<ScalableIcon icon={IconEdit} size={16} />}
              onClick={() => {
                onClose()
                void NiceModal.show('copilot-settings', {
                  copilot,
                  mode: 'edit',
                  onSave: (updated: CopilotDetail) => {
                    addOrUpdate(updated)
                  },
                })
              }}
            >
              {t('Edit')}
            </Button>
          )}
          {type === 'remote' && (
            <Button
              variant="outline"
              onClick={() => {
                addOrUpdate({
                  id: copilot.id,
                  name: copilot.name,
                  prompt: copilot.prompt,
                  avatar: copilot.avatar,
                  backgroundImage: copilot.backgroundImage,
                  description: copilot.description,
                })
                onClose()
              }}
            >
              {t('Add to My Copilots')}
            </Button>
          )}
          <Button
            variant="filled"
            onClick={() => {
              onUse?.(copilot)
              onClose()
            }}
          >
            {t('Use this Copilot')}
          </Button>
        </Flex>
      </Stack>
    </AdaptiveModal>
  )
}

export default CopilotDetailModal
