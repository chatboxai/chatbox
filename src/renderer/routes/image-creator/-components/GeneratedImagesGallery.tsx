import { ActionIcon, Flex, Image, Paper, Skeleton, Text, Tooltip } from '@mantine/core'
import { IconDownload, IconMaximize, IconPhoto, IconPhotoOff } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import type PhotoSwipe from 'photoswipe'
import type { UIElementData } from 'photoswipe'
import { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gallery, Item as GalleryItem } from 'react-photoswipe-gallery'
import { useFetchBlob } from '@/hooks/useBlob'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'

import { blobToDataUrl, getBase64ImageSize, getImageSizeFromUrl } from './constants'

export interface GeneratedImagesGalleryProps {
  images: string[] // CDN URLs or local storage keys
  onUseAsReference: (urlOrKey: string) => void
}

export const GeneratedImagesGallery = memo(function GeneratedImagesGallery({
  images,
  onUseAsReference,
}: GeneratedImagesGalleryProps) {
  const imageKeys = images
  const imageKeysRef = useRef(imageKeys)
  imageKeysRef.current = imageKeys
  const isSmallScreen = useIsSmallScreen()
  const fetchBlob = useFetchBlob()

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
      onClick: async (_e: MouseEvent, _el: HTMLElement, pswp: PhotoSwipe) => {
        const keyOrUrl = imageKeysRef.current[pswp.currIndex]
        if (!keyOrUrl) return

        // If it's a URL, download it directly
        if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
          const filename = `image_${Date.now()}.png`
          platform.exporter.exportByUrl(filename, keyOrUrl)
          return
        }

        // Otherwise read from storage
        const base64 = await fetchBlob(keyOrUrl)
        if (!base64) return
        platform.exporter.exportImageFile(keyOrUrl, base64)
      },
    },
  ]

  return (
    <Gallery uiElements={uiElements}>
      <Flex gap="md" wrap="wrap" justify="center" className="w-full">
        {imageKeys.map((keyOrUrl) => (
          <GeneratedImageGalleryItem
            key={keyOrUrl}
            keyOrUrl={keyOrUrl}
            onUseAsReference={() => onUseAsReference(keyOrUrl)}
            isSmallScreen={isSmallScreen}
          />
        ))}
      </Flex>
    </Gallery>
  )
})

interface GeneratedImageGalleryItemProps {
  keyOrUrl: string
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

function GeneratedImageGalleryItem({ keyOrUrl, onUseAsReference, isSmallScreen }: GeneratedImageGalleryItemProps) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const isUrl = keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')
  const fetchBlob = useFetchBlob()

  const {
    data: imageData,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['generated-image-gallery', keyOrUrl],
    queryFn: async () => {
      if (isUrl) {
        // For URLs, we need to load the image to get dimensions
        const size = await getImageSizeFromUrl(keyOrUrl)
        const displaySize = calculateDisplaySize(size.width, size.height)
        return { data: keyOrUrl, ...size, ...displaySize, isUrl: true }
      }
      // For storage keys, read from local storage
      const blob = await fetchBlob(keyOrUrl)
      if (!blob) return null
      const base64 = blobToDataUrl(blob)
      const size = await getBase64ImageSize(base64)
      const displaySize = calculateDisplaySize(size.width, size.height)
      return { data: base64, ...size, ...displaySize, isUrl: false }
    },
    staleTime: Infinity,
    gcTime: 60 * 1000,
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
      if (imageData.isUrl) {
        void platform.exporter.exportByUrl(`${filename}.png`, imageData.data)
      } else {
        void platform.exporter.exportImageFile(filename, imageData.data)
      }
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

  // Error state: show error placeholder with retry option
  if (isError) {
    return (
      <Paper
        radius="lg"
        h={displayHeight}
        w={displayWidth}
        className="bg-[var(--workspaice-background-tertiary)] flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-[var(--workspaice-background-secondary)] transition-colors"
        onClick={() => void refetch()}
      >
        <IconPhotoOff size={32} className="text-[var(--workspaice-tint-tertiary)]" />
        <Text size="xs" c="dimmed">
          {t('Failed to load')}
        </Text>
        <Text size="xs" c="dimmed" className="underline">
          {t('Click to retry')}
        </Text>
      </Paper>
    )
  }

  // Loading state
  if (!imageData) {
    return (
      <Skeleton
        h={displayHeight}
        w={displayWidth}
        radius="lg"
        className="bg-[var(--workspaice-background-tertiary)]"
        animate
      />
    )
  }

  return (
    <GalleryItem original={imageData.data} thumbnail={imageData.data} width={imageData.width} height={imageData.height}>
      {({ ref, open }: { ref: React.RefCallback<HTMLImageElement>; open: (e: React.MouseEvent) => void }) => (
        <Paper
          radius="lg"
          className="group relative overflow-hidden bg-[var(--workspaice-background-secondary)] shadow-sm hover:shadow-lg transition-shadow duration-300 cursor-pointer"
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

          {/* Hover Overlay (always visible on small screens) */}
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
