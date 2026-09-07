import type { MessageContentToolCallPart } from './types'

export const DEFAULT_TOOL_RESULT_IMAGE_INLINE_LIMIT = 5

export interface ToolResultImageReference {
  storageKey: string
  mediaType?: string
  filePath?: string
}

export interface ExtractedToolResultImage {
  reference: ToolResultImageReference
  /** Result safe to persist in session JSON, with the storage key promoted to the tool-call part. */
  storedResult: Record<string, unknown>
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Promote the standard image reference returned by image-producing tools out of private result JSON. */
export function extractToolResultImage(result: unknown): ExtractedToolResultImage | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const record = result as Record<string, unknown>
  const storageKey = nonEmptyString(record.image_storage_key)
  if (!storageKey) return null
  const { image_storage_key: _storageKey, ...storedResult } = record
  return {
    reference: {
      storageKey,
      mediaType: nonEmptyString(record.media_type),
      filePath: nonEmptyString(record.file_path),
    },
    storedResult,
  }
}

/** Read the first-class image reference, with a generic fallback for sessions created before it existed. */
export function getToolResultImageReference(
  part: Pick<MessageContentToolCallPart, 'result' | 'resultImageStorageKey' | 'resultImageMediaType'>
): ToolResultImageReference | null {
  const resultRecord =
    part.result && typeof part.result === 'object' && !Array.isArray(part.result)
      ? (part.result as Record<string, unknown>)
      : undefined
  const storageKey = nonEmptyString(part.resultImageStorageKey)
  if (storageKey) {
    return {
      storageKey,
      mediaType: nonEmptyString(part.resultImageMediaType) ?? nonEmptyString(resultRecord?.media_type),
      filePath: nonEmptyString(resultRecord?.file_path),
    }
  }
  return extractToolResultImage(part.result)?.reference ?? null
}
