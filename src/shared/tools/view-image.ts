import type { ImagePart, ModelMessage, TextPart } from 'ai'
import { BUILT_IN_BROWSER_TOOL_NAME } from '../built-in-browser'
import type { ProviderModelInfo } from '../types'

/**
 * Shared contract for the agent-mode `view_image` tool. The renderer toolset produces
 * results in this shape, the model-message converter re-inlines the stored image when
 * resending history, and the UI renders a thumbnail from the storage key.
 */
export const VIEW_IMAGE_TOOL_NAME = 'view_image'

const READ_FILE_TOOL_NAME = 'read_file'

// The browser yields an image only for its screenshot command and read_file only for image files;
// their other results carry no image reference.
const IMAGE_VIEWING_TOOL_NAMES: ReadonlySet<string> = new Set([
  VIEW_IMAGE_TOOL_NAME,
  BUILT_IN_BROWSER_TOOL_NAME,
  READ_FILE_TOOL_NAME,
])

/** Raster formats read_file returns as visual input. SVG stays text so it can be read and edited as markup. */
export const READ_FILE_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'] as const

export function isReadFileImagePath(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return READ_FILE_IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/**
 * Tools whose result is an image the model asked to look at. Their pending results are always
 * delivered, while other tool images count against the historical inline limit.
 */
export function isImageViewingToolName(toolName: string | undefined): boolean {
  return toolName !== undefined && IMAGE_VIEWING_TOOL_NAMES.has(toolName)
}

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

/** Leading text of every image-viewing tool result the model sees, embedded or not. */
export function viewedImageLabel(filePath: string): string {
  return `Viewed image: ${filePath}`
}

/**
 * Tool-result text used when the image cannot be embedded in the tool result itself and
 * is delivered as a follow-up user message instead. Shared by the live toolset and the
 * history converter so both paths tell the model the same thing.
 */
export function viewImageAttachmentNotice(filePath: string): string {
  return `${viewedImageLabel(filePath)}. The image is attached in the user message directly after this tool result.`
}

/** Label prefix for the injected user message carrying a view_image result. */
export const VIEW_IMAGE_FOLLOW_UP_LABEL_PREFIX = '[Image from view_image tool: '

export function viewImageUserMessageLabel(filePath: string): string {
  return `${VIEW_IMAGE_FOLLOW_UP_LABEL_PREFIX}${filePath}]`
}

/** Build the native tool-result media shape shared by live execution and history resend. */
export function buildViewImageToolResultContent(injection: ViewImageInjection) {
  return {
    type: 'content' as const,
    value: [
      { type: 'text' as const, text: viewedImageLabel(injection.filePath) },
      {
        type: 'file' as const,
        data: { type: 'data' as const, data: injection.base64Data },
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
