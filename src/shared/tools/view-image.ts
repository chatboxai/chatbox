import type { ImagePart, ModelMessage, TextPart } from 'ai'
import type { ProviderModelInfo } from '../types'

/**
 * Shared contract for the agent-mode `view_image` tool. The renderer toolset produces
 * results in this shape, the model-message converter re-inlines the stored image when
 * resending history, and the UI renders a thumbnail from the storage key.
 */
export const VIEW_IMAGE_TOOL_NAME = 'view_image'

/**
 * Upper bound for reading raw image bytes into memory, shared by the
 * host read handler and the sandbox read path. The renderer downscales before anything
 * is stored or sent, so this only guards against loading a huge file into memory.
 */
export const VIEW_IMAGE_MAX_READ_BYTES = 20 * 1024 * 1024
export const VIEW_IMAGE_MAX_SOURCE_DIMENSION = 16_384
export const VIEW_IMAGE_MAX_SOURCE_PIXELS = 32 * 1024 * 1024

export interface ViewImageToolResult {
  file_path: string
  /** Blob-storage key of the stored (downscaled) image data URL. */
  image_storage_key: string
  /** Media type of the stored image after normalization, e.g. image/png. */
  media_type: string
}

export interface ViewImageInjection {
  filePath: string
  base64Data: string
  mediaType: string
}

export function parseViewImageToolResult(result: unknown): ViewImageToolResult | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const record = result as Record<string, unknown>
  if (
    typeof record.file_path !== 'string' ||
    typeof record.image_storage_key !== 'string' ||
    record.image_storage_key === '' ||
    typeof record.media_type !== 'string'
  ) {
    return null
  }
  return {
    file_path: record.file_path,
    image_storage_key: record.image_storage_key,
    media_type: record.media_type,
  }
}

/**
 * Whether the model's wire protocol can carry images inside tool results.
 * Chat-completions style upstreams (`openai` and unset apiStyle, covering most
 * OpenAI-compatible providers) JSON-stringify `content` tool outputs, which would dump
 * base64 into the text context. For those, the image is delivered instead as a follow-up
 * user message with a real image part — the same shape as a user-uploaded image.
 */
export function supportsToolResultImages(apiStyle: ProviderModelInfo['apiStyle']): boolean {
  return apiStyle === 'anthropic' || apiStyle === 'google' || apiStyle === 'openai-responses'
}

/**
 * Tool-result text used when the image cannot be embedded in the tool result itself and
 * is delivered as a follow-up user message instead. Shared by the live toolset and the
 * history converter so both paths tell the model the same thing.
 */
export function viewImageAttachmentNotice(filePath: string): string {
  return `Viewed image: ${filePath}. The image is attached in the user message directly after this tool result.`
}

/** Label prefix for the injected user message carrying a view_image result. */
export function viewImageUserMessageLabel(filePath: string): string {
  return `[Image from view_image tool: ${filePath}]`
}

/** Build the native tool-result media shape shared by live execution and history resend. */
export function buildViewImageToolResultContent(injection: ViewImageInjection) {
  return {
    type: 'content' as const,
    value: [
      { type: 'text' as const, text: `Viewed image: ${injection.filePath}` },
      {
        type: 'image-data' as const,
        data: injection.base64Data,
        mediaType: injection.mediaType,
      },
    ],
  }
}

/** Build the follow-up user message that carries view_image images as real image parts. */
export function buildViewImageUserMessage(injections: ViewImageInjection[]): ModelMessage {
  return {
    role: 'user',
    content: injections.flatMap(
      (injection): Array<TextPart | ImagePart> => [
        { type: 'text', text: viewImageUserMessageLabel(injection.filePath) },
        { type: 'image', image: injection.base64Data, mediaType: injection.mediaType },
      ]
    ),
  }
}
