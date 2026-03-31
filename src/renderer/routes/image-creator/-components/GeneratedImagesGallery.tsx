import { ActionIcon, Flex, Image, Paper, Skeleton, Tooltip } from '@mantine/core'
import { IconDownload, IconMaximize, IconPhoto } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import type PhotoSwipe from 'photoswipe'
import type { UIElementData } from 'photoswipe'
import { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gallery, Item as GalleryItem } from 'react-photoswipe-gallery'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'
import storage from '@/storage'
import { blobToDataUrl, getBase64ImageSize } from './constants'

export interface GeneratedImagesGalleryProps {
  storageKeys: string[]
  onUseAsReference: (storageKey: string) => void
}

export const GeneratedImagesGallery = memo(function GeneratedImagesGallery({
  storageKeys,
  onUseAsReference,
}: GeneratedImagesGalleryProps) {
  const storageKeysRef = useRef(storageKeys)
  storageKeysRef.current = storageKeys
  const isSmallScreen = useIsSmallScreen()

  const uiElements: UIElementData[] = [
    {
      name: 'custom-download-button',
      ariaLabel: 'Download',
      order: 9,
      isButton: true,
      html: {
        isCustomSVG: true,
        inner:
          '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
        outlineID: 'pswp__icn-download',
      },
      appendTo: 'bar',
      onClick: (_e: MouseEvent, _el: HTMLElement, pswp: PhotoSwipe) => {
        const storageKey = storageKeysRef.current[pswp.currIndex]
        if (storageKey) {
          void (async () => {
            const base64 = await storage.getBlob(storageKey)
            if (!base64) return
            const filename =
              platform.type === 'mobile'
                ? `${storageKey.replaceAll(':', '_')}_${Math.random().toString(36).substring(7)}`
                : storageKey
            platform.exporter.exportImageFile(filename, base64)
          })()
        }
      },
    },
  ]

  return (
    <Gallery uiElements={uiElements}>
      <Flex gap="md" wrap="wrap" justify="center" className="w-full">
        {storageKeys.map((storageKey) => (
          <GeneratedImageGalleryItem
            key={storageKey}
            storageKey={storageKey}
            onUseAsReference={() => onUseAsReference(storageKey)}
            isSmallScreen={isSmallScreen}
          />
        ))}
      </Flex>
    </Gallery>
  )
})

interface GeneratedImageGalleryItemProps {
  storageKey: string
  onUseAsReference: () => void
  isSmallScreen: boolean
}

// Calculate display dimensions based on image aspect ratio
// Fixed height for standard ratios, adjusted for extreme ratios
const MAX_HEIGHT = 600
const MAX_WIDTH = 840
const MIN_WIDTH = 320
const MOBILE_SIZE = 320 // Fixed 1:1 size for mobile

function calculateDisplaySize(width: number, height: number): { displayWidth: number; displayHeight: number } {
  const aspectRatio = width / height

  // Start with max height and calculate width
  let displayHeight = MAX_HEIGHT
  let displayWidth = displayHeight * aspectRatio

  // If width exceeds max, scale down
  if (displayWidth > MAX_WIDTH) {
    displayWidth = MAX_WIDTH
    displayHeight = displayWidth / aspectRatio
  }

  // If width is too small, scale up (for very tall images)
  if (displayWidth < MIN_WIDTH) {
    displayWidth = MIN_WIDTH
    displayHeight = displayWidth / aspectRatio
  }

  return { displayWidth: Math.round(displayWidth), displayHeight: Math.round(displayHeight) }
}

function GeneratedImageGalleryItem({ storageKey, onUseAsReference, isSmallScreen }: GeneratedImageGalleryItemProps) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)

  const { data: imageData } = useQuery({
    queryKey: ['generated-image-gallery', storageKey],
    queryFn: async () => {
      const blob = await storage.getBlob(storageKey)
      if (!blob) return null
      const base64 = blobToDataUrl(blob)
      const size = await getBase64ImageSize(base64)
      const displaySize = calculateDisplaySize(size.width, size.height)
      return { data: base64, ...size, ...displaySize }
    },
    staleTime: Infinity,
  })

  // Mobile: fixed 1:1 square with cover fit
  // Desktop: dynamic size based on actual aspect ratio with contain fit
  const displayWidth = isSmallScreen ? MOBILE_SIZE : (imageData?.displayWidth ?? 320)
  const displayHeight = isSmallScreen ? MOBILE_SIZE : (imageData?.displayHeight ?? MAX_HEIGHT)
  const imageFit = isSmallScreen ? 'cover' : 'contain'

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!imageData) return
      const filename = `image_${Date.now()}`
      void platform.exporter.exportImageFile(filename, imageData.data)
    },
    [imageData]
  )

  const handleUseRef = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onUseAsReference()
    },
    [onUseAsReference]
  )

  if (!imageData) {
    return (
      <Skeleton
        h={displayHeight}
        w={displayWidth}
        radius="lg"
        className="bg-[var(--chatbox-background-tertiary)]"
        animate
      />
    )
  }

  return (
    <GalleryItem original={imageData.data} thumbnail={imageData.data} width={imageData.width} height={imageData.height}>
      {({ ref, open }: { ref: React.RefCallback<HTMLImageElement>; open: (e: React.MouseEvent) => void }) => (
        <Paper
          radius="lg"
          className="group relative overflow-hidden bg-[var(--chatbox-background-secondary)] shadow-sm hover:shadow-lg transition-shadow duration-300 cursor-pointer"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={open}
        >
          <Image
            src={imageData.data}
            h={displayHeight}
            w={displayWidth}
            fit={imageFit}
            radius="lg"
            ref={ref}
            styles={{
              root: {
                border: '1px solid var(--mantine-color-gray-3)',
              },
            }}
          />

          {/* Hover Overlay (always visible on mobile) */}
          <div
            className={`
              absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent
              flex items-end justify-center pb-4 gap-2
              transition-opacity duration-200 pointer-events-none
              ${isSmallScreen || hovered ? 'opacity-100' : 'opacity-0'}
            `}
          >
            <Tooltip label={t('View')} withArrow disabled={isSmallScreen}>
              <ActionIcon
                variant="white"
                size="lg"
                radius="xl"
                onClick={open}
                className="shadow-lg hover:scale-105 transition-transform pointer-events-auto"
              >
                <IconMaximize size={18} />
              </ActionIcon>
            </Tooltip>

            <Tooltip label={t('Use as Reference')} withArrow disabled={isSmallScreen}>
              <ActionIcon
                variant="white"
                size="lg"
                radius="xl"
                onClick={handleUseRef}
                className="shadow-lg hover:scale-105 transition-transform pointer-events-auto"
              >
                <IconPhoto size={18} />
              </ActionIcon>
            </Tooltip>

            <Tooltip label={t('Download')} withArrow disabled={isSmallScreen}>
              <ActionIcon
                variant="white"
                size="lg"
                radius="xl"
                onClick={handleDownload}
                className="shadow-lg hover:scale-105 transition-transform pointer-events-auto"
              >
                <IconDownload size={18} />
              </ActionIcon>
            </Tooltip>
          </div>
        </Paper>
      )}
    </GalleryItem>
  )
}
