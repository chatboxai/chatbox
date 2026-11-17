import type { MessagePicture } from '@shared/types'
import { concat } from 'lodash'
import type PhotoSwipe from 'photoswipe'
import type { UIElementData } from 'photoswipe'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Gallery, Item as GalleryItem } from 'react-photoswipe-gallery'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import platform from '@/platform'

const DOWNLOAD_ICON = {
  isCustomSVG: true,
  inner: '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
  outlineID: 'pswp__icn-download',
} as const

const REPORT_ICON = {
  isCustomSVG: true,
  inner:
    '<path d="M 16 6 A 10 10 0 0 1 16 26 L 16 24 A 8 8 0 0 0 16 8 L 16 6 A 10 10 0 0 0 16 26 L 16 24 A 8 8 0 0 1 16 8 M 15 11 A 1 1 0 0 1 17 11 L 17 16 A 1 1 0 0 1 15 16 M 16 19 A 1.5 1.5 0 0 1 16 22 A 1.5 1.5 0 0 1 16 19 Z" id="pswp__icn-report">',
  outlineID: 'pswp__icn-report',
} as const

export type FetchPictureBlob = (storageKey: string) => Promise<string | null>

const fetchPictureBlob: FetchPictureBlob = (storageKey) => {
  return currentBlobStorage.get(storageKey).catch(() => null)
}

export async function downloadPicture(
  picture: MessagePicture,
  fetchBlob: FetchPictureBlob = fetchPictureBlob
): Promise<void> {
  if (picture.storageKey) {
    const base64 = await fetchBlob(picture.storageKey)
    if (!base64) return

    // Android cannot save names containing colons and silently ignores duplicate names.
    const filename =
      platform.type === 'mobile'
        ? `${picture.storageKey.replaceAll(':', '_')}_${Math.random().toString(36).substring(7)}`
        : picture.storageKey
    await platform.exporter.exportImageFile(filename, base64)
    return
  }

  if (!picture.url) return

  const basename = `image_${Math.random().toString(36).substring(7)}`
  if (picture.url.startsWith('data:image/')) {
    await platform.exporter.exportImageFile(basename, picture.url)
    return
  }
  await platform.exporter.exportByUrl(basename, picture.url)
}

function pictureFromActiveSlide(pswp: PhotoSwipe): MessagePicture | undefined {
  const src = pswp.currSlide?.data.src
  return typeof src === 'string' && src ? { url: src } : undefined
}

export function ImageViewer({
  children,
  pictures,
  onReport,
}: {
  children: ReactNode
  pictures?: readonly MessagePicture[]
  onReport?(picture: MessagePicture): void
}) {
  const { t } = useTranslation()
  const downloadLabel = String(t('Download'))
  const reportLabel = String(t('report'))
  const uiElements = useMemo<UIElementData[]>(
    () =>
      concat(
        [
          {
            name: 'custom-download-button',
            ariaLabel: downloadLabel,
            order: 9,
            isButton: true,
            html: DOWNLOAD_ICON,
            appendTo: 'bar',
            onClick: async (_e: MouseEvent, _el: HTMLElement, pswp: PhotoSwipe) => {
              const picture = pictures?.[pswp.currIndex] ?? pictureFromActiveSlide(pswp)
              if (picture) await downloadPicture(picture)
            },
          },
        ],
        onReport
          ? [
              {
                name: 'report-button',
                ariaLabel: reportLabel,
                order: 8,
                isButton: true,
                html: REPORT_ICON,
                appendTo: 'bar',
                onClick: (_e: MouseEvent, _el: HTMLElement, pswp: PhotoSwipe) => {
                  const picture = pictures?.[pswp.currIndex] ?? pictureFromActiveSlide(pswp)
                  if (!picture) return
                  pswp.close()
                  onReport(picture)
                },
              },
            ]
          : []
      ),
    [downloadLabel, onReport, pictures, reportLabel]
  )

  return <Gallery uiElements={uiElements}>{children}</Gallery>
}

export { GalleryItem as ImageViewerItem }
