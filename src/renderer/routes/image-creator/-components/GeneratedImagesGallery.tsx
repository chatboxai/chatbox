import { ActionIcon, Button, Flex, Image, Paper, Skeleton, Text } from '@mantine/core'
import { IconDownload, IconMaximize, IconMessageReport, IconPhoto, IconPhotoOff } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import type PhotoSwipe from 'photoswipe'
import type { UIElementData } from 'photoswipe'
import { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gallery, Item as GalleryItem } from 'react-photoswipe-gallery'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useFetchBlob } from '@/hooks/useBlob'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'

import { blobToDataUrl, getImageSizeFromUrl, isDirectImageSource, isHttpImageSource } from './constants'

export interface GeneratedImagesGalleryProps {
  images: string[] // CDN URLs or local storage keys
  thumbnails?: string[]
  onUseAsReference: (urlOrKey: string) => void
  onReport?: () => void
}

export const GeneratedImagesGallery = memo(function GeneratedImagesGallery({
  images,
  thumbnails,
  onUseAsReference,
  onReport,
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
        if (isHttpImageSource(keyOrUrl)) {
          const filename = `image_${Date.now()}.png`
          platform.exporter.exportByUrl(filename, keyOrUrl)
          return
        }

        // Otherwise read from storage
        const base64 = await fetchBlob(keyOrUrl)
        if (!base64) return
        const filename =
          platform.type === 'mobile'
            ? `${keyOrUrl.replaceAll(':', '_')}_${Math.random().toString(36).substring(7)}`
            : keyOrUrl
        platform.exporter.exportImageFile(filename, base64)
      },
    },
  ]

  return (
    <Gallery uiElements={uiElements}>
      <Flex gap="md" wrap="wrap" justify="center" className="w-full">
        {imageKeys.map((keyOrUrl, index) => (
          <GeneratedImageGalleryItem
            key={keyOrUrl}
            keyOrUrl={keyOrUrl}
            thumbnailUrl={thumbnails?.[index]}
            onUseAsReference={() => onUseAsReference(keyOrUrl)}
            onReport={onReport}
            isSmallScreen={isSmallScreen}
          />
        ))}
      </Flex>
    </Gallery>
  )
})

interface GeneratedImageGalleryItemProps {
  keyOrUrl: string
  thumbnailUrl?: string
  onUseAsReference: () => void
  onReport?: () => void
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

function GeneratedImageGalleryItem({
  keyOrUrl,
  thumbnailUrl,
  onUseAsReference,
  onReport,
  isSmallScreen,
}: GeneratedImageGalleryItemProps) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const [failedSources, setFailedSources] = useState<string[]>([])
  const isDirectSource = isDirectImageSource(keyOrUrl)
  const fetchBlob = useFetchBlob()

  const {
    data: originalData,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['generated-image-gallery', keyOrUrl],
    queryFn: async ({ signal }) => {
      if (isDirectSource) {
        // For URLs, we need to load the image to get dimensions
        const size = await getImageSizeFromUrl(keyOrUrl, signal)
        const displaySize = calculateDisplaySize(size.width, size.height)
        return {
          data: keyOrUrl,
          ...size,
          ...displaySize,
          isDirectSource: true,
          isHttpSource: isHttpImageSource(keyOrUrl),
        }
      }
      // For storage keys, read from local storage
      const blob = await fetchBlob(keyOrUrl)
      if (!blob) throw new Error('Generated image is missing from storage')
      const base64 = blobToDataUrl(blob)
      const size = await getImageSizeFromUrl(base64, signal)
      const displaySize = calculateDisplaySize(size.width, size.height)
      return { data: base64, ...size, ...displaySize, isDirectSource: false, isHttpSource: false }
    },
    retry: false,
    networkMode: 'always',
    staleTime: Infinity,
    gcTime: 60 * 1000,
  })

  const thumbnail = useQuery({
    queryKey: ['generated-image-thumbnail', thumbnailUrl],
    enabled: !!thumbnailUrl && thumbnailUrl !== keyOrUrl && isHttpImageSource(thumbnailUrl),
    queryFn: async ({ signal }) => {
      if (!thumbnailUrl) throw new Error('Thumbnail URL is missing')
      const size = await getImageSizeFromUrl(thumbnailUrl, signal)
      return { data: thumbnailUrl, ...size, ...calculateDisplaySize(size.width, size.height) }
    },
    retry: false,
    networkMode: 'always',
    staleTime: Infinity,
    gcTime: 60 * 1000,
  })
  const imageData =
    originalData && !failedSources.includes(originalData.data)
      ? originalData
      : thumbnail.data && !failedSources.includes(thumbnail.data.data)
        ? thumbnail.data
        : undefined
  const loadFailed = isError || (!!originalData && failedSources.includes(originalData.data))
  const originalReady = !!originalData && !loadFailed
  const reload = () => {
    void refetch().then((result) => {
      if (!result.isError) setFailedSources((sources) => sources.filter((source) => source !== result.data?.data))
    })
    if (thumbnail.isError || (thumbnail.data && failedSources.includes(thumbnail.data.data))) {
      void thumbnail.refetch().then((result) => {
        if (!result.isError) setFailedSources((sources) => sources.filter((source) => source !== result.data?.data))
      })
    }
  }
  const loadingNotice = (
    <Flex direction="column" align="center" gap="xs" p="md" role={loadFailed ? 'alert' : 'status'}>
      <Text size="sm" ta="center">
        {loadFailed ? t('Image generated, but failed to load') : t('Loading full-size image...')}
      </Text>
      {loadFailed && (
        <Button variant="light" size="xs" loading={isFetching} onClick={reload}>
          {t('Reload image')}
        </Button>
      )}
    </Flex>
  )

  // Mobile: fixed 1:1 square with cover fit
  // Desktop: dynamic size based on actual aspect ratio with contain fit
  const displayWidth = isSmallScreen ? MOBILE_SIZE : (imageData?.displayWidth ?? 320)
  const displayHeight = isSmallScreen ? MOBILE_SIZE : (imageData?.displayHeight ?? MAX_HEIGHT)
  const imageFit = isSmallScreen ? 'cover' : 'contain'

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!originalData && !isHttpImageSource(keyOrUrl)) return
      const filename = `image_${Date.now()}`
      if (isHttpImageSource(keyOrUrl)) {
        void platform.exporter.exportByUrl(`${filename}.png`, keyOrUrl)
      } else if (originalData) {
        void platform.exporter.exportImageFile(filename, originalData.data)
      }
    },
    [keyOrUrl, originalData]
  )

  const handleUseRef = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onUseAsReference()
    },
    [onUseAsReference]
  )

  const handleReport = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onReport?.()
    },
    [onReport]
  )

  if (loadFailed && !imageData) {
    return (
      <Paper
        radius="lg"
        h={displayHeight}
        w={displayWidth}
        maw="100%"
        className="bg-[var(--chatbox-background-tertiary)] flex flex-col items-center justify-center"
      >
        <IconPhotoOff size={32} className="text-[var(--chatbox-tint-tertiary)]" />
        {loadingNotice}
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
        className="bg-[var(--chatbox-background-tertiary)]"
        animate
      />
    )
  }

  return (
    <GalleryItem
      original={originalData?.data ?? keyOrUrl}
      thumbnail={imageData.data}
      width={imageData.width}
      height={imageData.height}
    >
      {({ ref, open }: { ref: React.RefCallback<HTMLImageElement>; open: (e: React.MouseEvent) => void }) => (
        <Paper
          radius="lg"
          className="group overflow-hidden bg-[var(--chatbox-background-secondary)] shadow-sm hover:shadow-lg transition-shadow duration-300 cursor-pointer"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={originalReady ? open : undefined}
        >
          <div className="relative">
            <Image
              src={imageData.data}
              alt={t('Generated image')}
              onError={() => setFailedSources((sources) => [...sources, imageData.data])}
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

            {onReport && (
              <Tooltip label={t('report')} withArrow disabled={isSmallScreen}>
                <ActionIcon
                  aria-label={t('report')}
                  color="red"
                  variant="white"
                  size="sm"
                  radius="lg"
                  onClick={handleReport}
                  className="absolute right-3 bottom-3 z-[1] !bg-white/70 !text-red-500 shadow-sm opacity-65 transition-opacity hover:opacity-100 pointer-events-auto"
                >
                  <IconMessageReport size={14} />
                </ActionIcon>
              </Tooltip>
            )}

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
                  radius="lg"
                  disabled={!originalReady}
                  onClick={originalReady ? open : undefined}
                  className="shadow-lg hover:scale-105 transition-transform pointer-events-auto"
                >
                  <IconMaximize size={18} />
                </ActionIcon>
              </Tooltip>

              <Tooltip label={t('Use as Reference')} withArrow disabled={isSmallScreen}>
                <ActionIcon
                  variant="white"
                  size="lg"
                  radius="lg"
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
                  radius="lg"
                  onClick={handleDownload}
                  className="shadow-lg hover:scale-105 transition-transform pointer-events-auto"
                >
                  <IconDownload size={18} />
                </ActionIcon>
              </Tooltip>
            </div>
          </div>
          {!originalReady && loadingNotice}
        </Paper>
      )}
    </GalleryItem>
  )
}
