import { ChatboxAIAPIError } from '@shared/models/errors'
import type { ImageGeneration } from '../../types'

export function getImageGenerationErrorDetail(record: Pick<ImageGeneration, 'errorCode'>) {
  return typeof record.errorCode === 'number' ? ChatboxAIAPIError.getDetail(record.errorCode) : null
}
