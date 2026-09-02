import { readRasterImageBounds } from '@shared/image-dimensions'
import type { SandboxProvider } from '@shared/sandbox-provider'
import { DEFAULT_TOOL_RESULT_IMAGE_INLINE_LIMIT } from '@shared/tool-result-image'
import {
  buildViewImageToolResultContent,
  buildViewImageUserMessage,
  parseViewImageToolResult,
  VIEW_IMAGE_MAX_READ_BYTES,
  VIEW_IMAGE_MAX_SOURCE_DIMENSION,
  VIEW_IMAGE_MAX_SOURCE_PIXELS,
  VIEW_IMAGE_TOOL_NAME,
  type ViewImageInjection,
  type ViewImageToolResult,
  viewImageAttachmentNotice,
} from '@shared/tools/view-image'
import { jsonSchema, type ModelMessage, type ToolSet } from 'ai'
import { getImageBase64AndResize, MODEL_IMAGE_MAX_DIMENSION, svgToPngBase64 } from '@/packages/pic_utils'
import platform from '@/platform'
import { saveImage } from '@/utils/image'
import { isAbsolutePath, normalizeToolPathForPlatform } from './filesystem'
import { asRecord, stringField } from './model-output'
import { remapPhantomHomePathForProvider } from './sandbox-paths'

export interface ViewImageContext {
  sessionId?: string
  provider?: SandboxProvider
  /**
   * The model's wire protocol can embed images inside tool results
   * (see supportsToolResultImages). When false, the tool result is a text notice and the
   * image is injected as a follow-up user message via injectImagesIntoStepMessages —
   * the same shape as a user-uploaded image, so it works for every vision model.
   */
  toolResultImages: boolean
}

interface ViewImageResultEntry {
  toolCallId: string
  result: ViewImageToolResult
  image?: ViewImageInjection
}

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

function mediaTypeFromExtension(filePath: string): string | null {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex < 0) return null
  return IMAGE_MEDIA_TYPES[filePath.slice(dotIndex).toLowerCase()] ?? null
}

/** Sniff common raster formats from the first bytes for files with missing/wrong extensions. */
function mediaTypeFromMagicBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  return null
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)))
  }
  return btoa(chunks.join(''))
}

function fileNameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'image'
}

function parseDataUrl(dataUrl: string): { base64Data: string; mediaType: string } | null {
  const prefix = 'data:'
  const separator = ';base64,'
  if (!dataUrl.startsWith(prefix)) return null
  const separatorIndex = dataUrl.indexOf(separator, prefix.length)
  if (separatorIndex <= prefix.length) return null
  return {
    mediaType: dataUrl.slice(prefix.length, separatorIndex),
    base64Data: dataUrl.slice(separatorIndex + separator.length),
  }
}

async function readImageBytes(
  context: ViewImageContext,
  filePath: string
): Promise<{ bytes: ArrayBuffer } | { error: string }> {
  if (!isAbsolutePath(filePath)) {
    // Relative paths resolve inside the session sandbox working directory.
    if (!context.provider || !context.sessionId) {
      return { error: 'Relative paths require an active session sandbox. Use an absolute path instead.' }
    }
    if (context.provider.type !== 'local') {
      return { error: 'view_image only supports the local sandbox. Use an absolute path on the user filesystem.' }
    }
    const setup = await context.provider.init(context.sessionId)
    if (!setup.success) return { error: setup.error ?? 'Sandbox is not available' }
    const status = await context.provider.getStatus().catch(() => null)
    const workingDirectory = status?.workingDirectory
    if (!workingDirectory) return { error: 'Sandbox working directory is unavailable' }
    if (!platform.sandboxReadFileBytes) return { error: 'Image viewing is not available on this platform' }
    const joinedPath = `${workingDirectory.replace(/[\\/]+$/, '')}/${filePath}`
    return toReadOutcome(
      await platform.sandboxReadFileBytes({ filePath: joinedPath, maxBytes: VIEW_IMAGE_MAX_READ_BYTES })
    )
  }
  // Absolute paths read the host filesystem (read-only, same policy as list_files /
  // search_files). Sandbox working dirs and persisted artifacts are host paths too.
  if (platform.fsReadImage) {
    return toReadOutcome(await platform.fsReadImage({ filePath }))
  }
  if (platform.sandboxReadFileBytes) {
    return toReadOutcome(await platform.sandboxReadFileBytes({ filePath, maxBytes: VIEW_IMAGE_MAX_READ_BYTES }))
  }
  return { error: 'Image viewing is not available on this platform' }
}

function toReadOutcome(result: {
  success: boolean
  bytes?: ArrayBuffer
  error?: string
}): { bytes: ArrayBuffer } | { error: string } {
  return result.success && result.bytes ? { bytes: result.bytes } : { error: result.error ?? 'Failed to read file' }
}

/** view_image is only useful when the host can read image bytes at all. */
export function isViewImageAvailable(): boolean {
  return Boolean(platform.fsReadImage || platform.sandboxReadFileBytes)
}

export interface ViewImageToolSetResult {
  tools: ToolSet
  description: string
  /**
   * Rewrites step messages inside the running generation to keep only the most recent
   * image results inline. Protocols without tool-result media additionally receive those
   * images as user messages. Wire it into prepareStep.
   */
  injectImagesIntoStepMessages?: (messages: ModelMessage[]) => Promise<ModelMessage[]>
}

async function resolveStoredImage(storageKey: string): Promise<{ base64Data: string; mediaType: string } | null> {
  const blob = await platform.getStoreBlob(storageKey).catch(() => null)
  if (!blob) return null
  return parseDataUrl(blob.startsWith('data:') ? blob : `data:image/png;base64,${blob}`)
}

const VIEW_IMAGE_LABEL_PREFIX = '[Image from view_image tool: '

function viewImageLabelFilePath(part: { type: string; text?: string }): string | undefined {
  if (part.type !== 'text' || !part.text?.startsWith(VIEW_IMAGE_LABEL_PREFIX) || !part.text.endsWith(']')) {
    return undefined
  }
  return part.text.slice(VIEW_IMAGE_LABEL_PREFIX.length, -1)
}

function followsToolImageResult(messages: ModelMessage[], messageIndex: number): boolean {
  const previousMessage = messageIndex > 0 ? messages[messageIndex - 1] : undefined
  return previousMessage?.role === 'tool'
}

function boundToolResultImages(messages: ModelMessage[], limit: number): ModelMessage[] {
  let remainingImages = Math.max(0, Math.floor(limit))
  const reversedMessages: ModelMessage[] = []
  const omittedFilePathsByToolMessage = new Map<number, string[]>()

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message.role === 'user' && Array.isArray(message.content) && followsToolImageResult(messages, messageIndex)) {
      const boundedContent = [] as typeof message.content
      for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = message.content[partIndex]
        const label = partIndex > 0 ? message.content[partIndex - 1] : undefined
        const filePath = label ? viewImageLabelFilePath(label) : undefined
        if (part.type === 'image' && label && filePath !== undefined) {
          if (remainingImages > 0) {
            boundedContent.unshift(label, part)
            remainingImages -= 1
          } else {
            const omittedFilePaths = omittedFilePathsByToolMessage.get(messageIndex - 1) ?? []
            omittedFilePaths.push(filePath)
            omittedFilePathsByToolMessage.set(messageIndex - 1, omittedFilePaths)
          }
          partIndex -= 1
          continue
        }
        boundedContent.unshift(part)
      }
      if (boundedContent.length > 0) reversedMessages.push({ ...message, content: boundedContent })
      continue
    }

    if (message.role === 'tool') {
      const boundedContent = [] as typeof message.content
      const omittedFilePaths = omittedFilePathsByToolMessage.get(messageIndex) ?? []
      for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = message.content[partIndex]
        // Tool messages also carry approval responses, which have no output to bound.
        if (part.type !== 'tool-result') {
          boundedContent.unshift(part)
          continue
        }
        const output = part.output
        if (output.type !== 'content') {
          if (output.type === 'text') {
            const outputText = output.value
            const omittedPathIndex = omittedFilePaths.findIndex((filePath) =>
              outputText.startsWith(`Viewed image: ${filePath}. The image is attached`)
            )
            if (omittedPathIndex >= 0) {
              const [filePath] = omittedFilePaths.splice(omittedPathIndex, 1)
              boundedContent.unshift({
                ...part,
                output: {
                  type: 'text',
                  value: `Viewed image: ${filePath}. Image omitted from this replay to keep the request payload bounded.`,
                },
              })
              continue
            }
          }
          boundedContent.unshift(part)
          continue
        }
        const boundedValue = [] as typeof output.value
        for (let valueIndex = output.value.length - 1; valueIndex >= 0; valueIndex -= 1) {
          const valuePart = output.value[valueIndex]
          if (valuePart.type !== 'image-data') {
            boundedValue.unshift(valuePart)
            continue
          }
          if (remainingImages > 0) {
            boundedValue.unshift(valuePart)
            remainingImages -= 1
          }
        }
        boundedContent.unshift({ ...part, output: { ...output, value: boundedValue } })
      }
      reversedMessages.push({ ...message, content: boundedContent })
      continue
    }

    reversedMessages.push(message)
  }

  return reversedMessages.reverse()
}

function matchResultEntriesToMessagePositions(
  messages: ModelMessage[],
  resultEntries: ViewImageResultEntry[]
): ReadonlyMap<number, ReadonlyMap<number, ViewImageResultEntry>> {
  const unmatchedResultsByToolCallId = new Map<string, ViewImageResultEntry[]>()
  for (const entry of resultEntries) {
    const entries = unmatchedResultsByToolCallId.get(entry.toolCallId) ?? []
    entries.push(entry)
    unmatchedResultsByToolCallId.set(entry.toolCallId, entries)
  }

  let unmatchedResultCount = resultEntries.length
  const matchedResults = new Map<number, Map<number, ViewImageResultEntry>>()
  for (let messageIndex = messages.length - 1; messageIndex >= 0 && unmatchedResultCount > 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue
    for (let partIndex = message.content.length - 1; partIndex >= 0 && unmatchedResultCount > 0; partIndex -= 1) {
      const part = message.content[partIndex]
      if (part.type !== 'tool-result' || part.toolName !== VIEW_IMAGE_TOOL_NAME) continue
      const unmatchedResults = unmatchedResultsByToolCallId.get(part.toolCallId)
      const matchedResult = unmatchedResults?.pop()
      if (!matchedResult) continue
      const messageMatches = matchedResults.get(messageIndex) ?? new Map<number, ViewImageResultEntry>()
      messageMatches.set(partIndex, matchedResult)
      matchedResults.set(messageIndex, messageMatches)
      unmatchedResultCount -= 1
    }
  }
  return matchedResults
}

export function buildViewImageToolSet(context: ViewImageContext): ViewImageToolSetResult {
  // Keep occurrence order as well as the downscaled data. Some providers reuse tool-call
  // IDs across turns, so IDs alone cannot identify or bound historical image occurrences.
  const resultEntries: ViewImageResultEntry[] = []
  const resultEntriesByStorageKey = new Map<string, ViewImageResultEntry>()
  const resolvedImagesByStorageKey = new Map<string, ViewImageInjection>()

  const resolveToolCallImage = async (
    result: ViewImageToolResult,
    entry?: ViewImageResultEntry
  ): Promise<ViewImageInjection | null> => {
    if (entry?.image) return entry.image
    const cachedImage = resolvedImagesByStorageKey.get(result.image_storage_key)
    if (cachedImage) return cachedImage
    const stored = await resolveStoredImage(result.image_storage_key)
    if (!stored) return null
    const image = { filePath: result.file_path, ...stored }
    if (entry) entry.image = image
    else resolvedImagesByStorageKey.set(result.image_storage_key, image)
    return image
  }

  const view_image: ToolSet[string] = {
    description:
      'View an image file so you can actually see its contents (screenshots, charts, photos, generated images). ' +
      'Relative paths are resolved in the session sandbox; absolute paths read the user filesystem (read-only). ' +
      'Supported formats: png, jpg, webp, gif, bmp, svg. Large images are downscaled automatically.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path of the image file to view',
        },
      },
      required: ['file_path'],
      additionalProperties: false,
    }),
    execute: async (input, toolOptions) => {
      const viewInput = input as { file_path: string }
      let filePath = await remapPhantomHomePathForProvider(viewInput.file_path, context.provider)
      filePath = normalizeToolPathForPlatform(filePath)

      const readResult = await readImageBytes(context, filePath)
      if ('error' in readResult) return { error: readResult.error }
      const sourceBytes = new Uint8Array(readResult.bytes)

      const mediaType = mediaTypeFromMagicBytes(sourceBytes.subarray(0, 12)) ?? mediaTypeFromExtension(filePath)
      if (!mediaType) {
        return { error: 'Unsupported or unrecognized image format. Supported: png, jpg, webp, gif, bmp, svg.' }
      }
      if (mediaType !== 'image/svg+xml') {
        const sourceBounds = readRasterImageBounds(sourceBytes, mediaType)
        if (!sourceBounds) {
          return { error: 'Failed to inspect image dimensions safely. The file may be corrupted.' }
        }
        if (
          sourceBounds.maxWidth > VIEW_IMAGE_MAX_SOURCE_DIMENSION ||
          sourceBounds.maxHeight > VIEW_IMAGE_MAX_SOURCE_DIMENSION ||
          sourceBounds.maxPixels > VIEW_IMAGE_MAX_SOURCE_PIXELS
        ) {
          return {
            error: `Image dimensions are too large (${sourceBounds.maxWidth}x${sourceBounds.maxHeight}, up to ${sourceBounds.maxPixels} pixels)`,
          }
        }
      }

      // Downscale to mainstream vision-model limits and normalize exotic formats to
      // png/jpeg before storing — keeps blobs and request payloads bounded.
      let dataUrl: string
      try {
        let file: File
        if (mediaType === 'image/svg+xml') {
          const convertedSvg = await svgToPngBase64(`data:image/svg+xml;base64,${bytesToBase64(sourceBytes)}`, {
            maxOutputDimension: MODEL_IMAGE_MAX_DIMENSION,
            strictResourceIsolation: true,
          })
          const convertedImage = parseDataUrl(convertedSvg)
          if (!convertedImage?.base64Data) throw new Error('SVG conversion produced an empty image')
          const convertedBlob = await fetch(convertedSvg).then((response) => response.blob())
          file = new File([convertedBlob], fileNameOf(filePath), { type: convertedImage.mediaType })
        } else {
          file = new File([readResult.bytes], fileNameOf(filePath), { type: mediaType })
        }
        dataUrl = await getImageBase64AndResize(file, { outputType: 'image/webp', quality: 0.85 })
      } catch {
        return { error: 'Failed to decode image. The file may be corrupted or not a valid image.' }
      }

      const parsedImage = parseDataUrl(dataUrl)
      if (!parsedImage) {
        return { error: 'Failed to process image into a model-compatible format.' }
      }
      const imageStorageKey = await saveImage(`view-image:${context.sessionId ?? 'session'}`, dataUrl)
      const result: ViewImageToolResult = {
        file_path: viewInput.file_path,
        image_storage_key: imageStorageKey,
        media_type: parsedImage.mediaType,
      }
      const entry: ViewImageResultEntry = {
        toolCallId: toolOptions.toolCallId,
        result,
        image: { filePath: result.file_path, ...parsedImage },
      }
      resultEntries.push(entry)
      resultEntriesByStorageKey.set(result.image_storage_key, entry)
      return result
    },
    // Within the running generation, later steps must receive the actual image — never
    // base64-as-text. Media-capable protocols embed it in the tool result; others get a
    // text notice here and the image via injectImagesIntoStepMessages (user message).
    // History resends are handled by the shared model-message converter the same way.
    toModelOutput: async ({ toolCallId, output }: { toolCallId: string; output: unknown }) => {
      const record = asRecord(output)
      const error = stringField(record, 'error')
      if (error) return { type: 'text' as const, value: `Error: ${error}` }
      const result = parseViewImageToolResult(output)
      if (!result) return { type: 'text' as const, value: 'Error: view_image returned an unexpected result.' }
      const entry = resultEntriesByStorageKey.get(result.image_storage_key)
      const parsed = await resolveToolCallImage(result, entry?.toolCallId === toolCallId ? entry : undefined)
      if (!parsed) {
        return { type: 'text' as const, value: `Viewed image: ${result.file_path} (image data is no longer available)` }
      }
      if (!context.toolResultImages) {
        return { type: 'text' as const, value: viewImageAttachmentNotice(result.file_path) }
      }
      return buildViewImageToolResultContent(parsed)
    },
  }

  // Keep current-generation replay bounded. Older image outputs become compact JSON;
  // selected images are either already embedded in tool output or injected as user parts.
  // Runs per step (prepareStep), so it never mutates the input messages.
  const injectImagesIntoStepMessages = async (messages: ModelMessage[]): Promise<ModelMessage[]> => {
    if (resultEntries.length === 0) return messages

    // Match current-generation executions to tool-result positions from newest to oldest.
    // This prevents a reused call ID from capturing older history or duplicating one image.
    const matchedResults = matchResultEntriesToMessagePositions(messages, resultEntries)

    const recentResults = new Set(resultEntries.slice(-DEFAULT_TOOL_RESULT_IMAGE_INLINE_LIMIT))
    const output: ModelMessage[] = []
    for (const [messageIndex, message] of messages.entries()) {
      if (message.role !== 'tool' || !Array.isArray(message.content)) {
        output.push(message)
        continue
      }
      const imageInjections: ViewImageInjection[] = []
      const boundedContent = [] as typeof message.content
      for (const [partIndex, part] of message.content.entries()) {
        if (part.type !== 'tool-result' || part.toolName !== VIEW_IMAGE_TOOL_NAME) {
          boundedContent.push(part)
          continue
        }
        const cached = matchedResults.get(messageIndex)?.get(partIndex)
        if (!cached) {
          boundedContent.push(part)
          continue
        }
        if (!recentResults.has(cached)) {
          boundedContent.push({ ...part, output: { type: 'json' as const, value: { ...cached.result } } })
          continue
        }
        if (context.toolResultImages) {
          boundedContent.push(part)
          continue
        }
        const parsed = await resolveToolCallImage(cached.result, cached)
        if (parsed) imageInjections.push(parsed)
        boundedContent.push(part)
      }
      output.push({ ...message, content: boundedContent })
      if (imageInjections.length > 0) {
        output.push(buildViewImageUserMessage(imageInjections))
      }
    }
    for (const entry of resultEntries) {
      if (!recentResults.has(entry)) entry.image = undefined
    }
    return boundToolResultImages(output, DEFAULT_TOOL_RESULT_IMAGE_INLINE_LIMIT)
  }

  return {
    tools: { [VIEW_IMAGE_TOOL_NAME]: view_image },
    description: `
## Viewing Images
Use the view_image tool to look at image files — you will see the actual image, not a text description. Use it to inspect screenshots, rendered charts, downloaded pictures, and images you generated or modified in the sandbox.
- Relative paths read from the session sandbox working directory; absolute paths read the user's filesystem (read-only).
- After generating or editing an image in the sandbox, view it to verify the result before presenting it to the user.${
      context.toolResultImages
        ? ''
        : '\n- The viewed image arrives in a user message immediately after the tool result. It is real image input, not text.'
    }
`,
    injectImagesIntoStepMessages,
  }
}
