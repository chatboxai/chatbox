import type { BlobStoragePort } from '@chatbox/core/ports'
import { type ModelMessage, type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { readRasterImageBounds } from '../image-dimensions'
import { DEFAULT_TOOL_RESULT_IMAGE_INLINE_LIMIT } from '../tool-result-image'
import {
  buildViewImageToolResultContent,
  buildViewImageUserMessage,
  parseViewImageToolResult,
  VIEW_IMAGE_MAX_READ_BYTES,
  VIEW_IMAGE_MAX_SOURCE_DIMENSION,
  VIEW_IMAGE_MAX_SOURCE_PIXELS,
  VIEW_IMAGE_TOOL_NAME,
  viewImageAttachmentNotice,
} from '../tools/view-image'
import {
  createViewImageBatchBudget,
  lastAssistantMessageIndex,
  VIEW_IMAGE_BATCH_GUIDANCE,
  VIEW_IMAGE_MAX_NORMALIZED_LENGTH,
} from '../tools/view-image-batch'
import { boundToolResultImages } from '../tools/view-image-replay'
import { throwIfWorkAborted } from './abort'
import { workspacePath } from './workspace-path'
import type { LocalWorkspacePort } from './workspace-port'

export type NormalizeWorkImage = (
  dataUrl: string,
  signal: AbortSignal,
  size: { width: number; height: number }
) => Promise<string>

function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  return null
}

const parseImage = (data: string) => /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(data)

export function buildLocalViewImage(options: {
  workspace: LocalWorkspacePort
  blobs: BlobStoragePort
  sessionId: string
  signal: AbortSignal
  normalize: NormalizeWorkImage
  toolResultImages: boolean
}) {
  const reserveImageCall = createViewImageBatchBudget()
  const tools: ToolSet = {
    [VIEW_IMAGE_TOOL_NAME]: tool({
      description: `View a local workspace image as real visual input. Supports PNG, JPEG, GIF, WebP and BMP; automatically downsizes images. Use after creating an image to verify it. Paths must be relative to this conversation workspace. ${VIEW_IMAGE_BATCH_GUIDANCE}`,
      inputSchema: z.object({ file_path: z.string().min(1).max(240) }).strict(),
      execute: async ({ file_path }, toolOptions) => {
        reserveImageCall(toolOptions.messages)
        const signal = toolOptions.abortSignal ?? options.signal
        throwIfWorkAborted(signal)
        const path = workspacePath(file_path)
        const base64 = await options.workspace.readBase64(options.sessionId, path)
        throwIfWorkAborted(signal)
        if (base64.length > Math.ceil(VIEW_IMAGE_MAX_READ_BYTES / 3) * 4) throw new Error('Image file is too large')
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
        const type = imageType(bytes)
        if (!type) throw new Error('Unsupported image format. Use PNG, JPEG, GIF, WebP or BMP.')
        const bounds = readRasterImageBounds(bytes, type)
        if (!bounds) throw new Error('Unable to safely read image dimensions')
        if (
          bounds.maxWidth > VIEW_IMAGE_MAX_SOURCE_DIMENSION ||
          bounds.maxHeight > VIEW_IMAGE_MAX_SOURCE_DIMENSION ||
          bounds.maxPixels > VIEW_IMAGE_MAX_SOURCE_PIXELS
        )
          throw new Error('Image dimensions are too large')
        const scale = Math.min(
          1,
          1568 / Math.max(bounds.maxWidth, bounds.maxHeight),
          768 / Math.min(bounds.maxWidth, bounds.maxHeight)
        )
        const normalized = await options.normalize(`data:${type};base64,${base64}`, signal, {
          width: Math.max(1, Math.floor(bounds.maxWidth * scale)),
          height: Math.max(1, Math.floor(bounds.maxHeight * scale)),
        })
        throwIfWorkAborted(signal)
        const parsed = parseImage(normalized)
        if (!parsed || normalized.length > VIEW_IMAGE_MAX_NORMALIZED_LENGTH)
          throw new Error('Normalized image exceeds the request image limit')
        const key = `picture:work-view:${Date.now()}-${Math.random().toString(36).slice(2)}`
        await options.blobs.set(key, normalized)
        if (signal.aborted) {
          await options.blobs.remove(key)
          throwIfWorkAborted(signal)
        }
        return { file_path: path, image_storage_key: key, media_type: parsed[1] }
      },
      toModelOutput: ({ output }) => ({ type: 'json', value: output }),
    }),
  }
  const prepareStepMessages = async (messages: ModelMessage[]): Promise<ModelMessage[]> => {
    // History conversion already resolves saved image references. Resolve current-step
    // compact outputs here, before any protocol serializes them into a request.
    throwIfWorkAborted(options.signal)
    const lastAssistant = lastAssistantMessageIndex(messages)
    let remaining = DEFAULT_TOOL_RESULT_IMAGE_INLINE_LIMIT
    const reversed: ModelMessage[] = []
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex]
      if (message.role !== 'tool') {
        reversed.push(message)
        continue
      }
      const images: Parameters<typeof buildViewImageUserMessage>[0] = []
      const content = [] as typeof message.content
      for (const part of [...message.content].reverse()) {
        const result =
          part.type === 'tool-result' && part.toolName === VIEW_IMAGE_TOOL_NAME && part.output.type === 'json'
            ? parseViewImageToolResult(part.output.value)
            : null
        if (!result || part.type !== 'tool-result') {
          content.unshift(part)
          continue
        }
        const data =
          messageIndex > lastAssistant || remaining > 0 ? await options.blobs.get(result.image_storage_key) : null
        throwIfWorkAborted(options.signal)
        const parsed = data && data.length <= VIEW_IMAGE_MAX_NORMALIZED_LENGTH && parseImage(data)
        if (!parsed) {
          content.unshift({
            ...part,
            output: {
              type: 'text',
              value: `Viewed image: ${result.file_path}. Image unavailable or omitted to keep this request bounded.`,
            },
          })
          continue
        }
        if (messageIndex <= lastAssistant) remaining -= 1
        const image = { filePath: result.file_path, mediaType: parsed[1], base64Data: parsed[2] }
        if (!options.toolResultImages) images.unshift(image)
        content.unshift({
          ...part,
          output: options.toolResultImages
            ? buildViewImageToolResultContent(image)
            : { type: 'text', value: viewImageAttachmentNotice(result.file_path) },
        })
      }
      if (images.length) reversed.push(buildViewImageUserMessage(images))
      reversed.push({ ...message, content })
    }
    return boundToolResultImages(reversed.reverse(), DEFAULT_TOOL_RESULT_IMAGE_INLINE_LIMIT)
  }
  return { tools, prepareStepMessages }
}
