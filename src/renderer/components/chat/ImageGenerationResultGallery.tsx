import { memo, useMemo } from 'react'
import { imageGenerationSourcesToPictures } from './image-generation-result'
import { PictureGallery } from './PictureGallery'

export const ImageGenerationResultGallery = memo(function ImageGenerationResultGallery({
  images,
  compact = false,
}: {
  images: readonly string[]
  compact?: boolean
}) {
  const pictures = useMemo(() => imageGenerationSourcesToPictures(images), [images])
  return pictures.length > 0 ? <PictureGallery pictures={pictures} compact={compact} /> : null
})
