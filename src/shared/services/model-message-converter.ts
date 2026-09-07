import type { JSONValue } from '@ai-sdk/provider'
import type { ReasoningPart } from '@ai-sdk/provider-utils'
import type { FilePart, ImagePart, ModelMessage, TextPart, ToolCallPart } from 'ai'
import { compact } from 'lodash'
import { pickPersistableProviderMetadata } from '../models/provider-part-metadata'
import { DEFAULT_TOOL_RESULT_IMAGE_INLINE_LIMIT, getToolResultImageReference } from '../tool-result-image'
import {
  buildViewImageToolResultContent,
  buildViewImageUserMessage,
  type ViewImageInjection,
  viewImageAttachmentNotice,
} from '../tools/view-image'
import type { Message, MessageContentParts, MessageContentToolCallPart } from '../types'
import { getMessageText } from '../utils/message'

/**
 * Resolve a stored image (by storage key) to a data URL (e.g. `data:image/png;base64,...`)
 * or `null` when the image is unavailable. Each shell injects its own implementation:
 * renderer wraps `ModelDependencies.storage.getImage`, native wraps `readNativeImageAsDataUrl`.
 */
export type ModelImageResolver = (storageKey: string) => Promise<string | null>

export interface ConvertToModelMessagesOptions {
  modelSupportVision: boolean
  /**
   * Whether historical assistant reasoning survives conversion.
   * - `false`/omitted: reasoning is dropped (most providers reject or mangle it).
   * - `true` / `'all-turns'` (equivalent): reasoning is kept on every assistant
   *   turn (DeepSeek thinking mode, and Anthropic Messages signed replay —
   *   the documented pattern: send everything back, the API filters per model).
   */
  preserveReasoning?: boolean | 'all-turns'
  /**
   * When true, only reasoning parts that carry whitelisted replay metadata
   * (Anthropic `signature` / `redactedData`) go on the wire. This is the
   * Cherry-style source filter: Kimi/DeepSeek/Gemini thoughts have no
   * Anthropic signature and are omitted, while Claude signatures survive a
   * same-realm model or host switch (Claude API / Bedrock Messages / Vertex
   * signatures are cross-compatible).
   */
  signedReasoningOnly?: boolean
  ensureGoogleFunctionCallSignatures?: boolean
  /**
   * The model's wire protocol accepts images inside tool results (see
   * `supportsToolResultImages`). Explicit true embeds stored `view_image` results
   * in tool output; explicit false injects follow-up user image messages. Omission
   * keeps compact JSON for auxiliary callers such as naming and summarization.
   */
  supportToolResultImages?: boolean
  /** Maximum number of most-recent stored tool images to inline into one request. */
  maxInlineToolResultImages?: number
}

export const DEFAULT_MAX_INLINE_TOOL_RESULT_IMAGES = DEFAULT_TOOL_RESULT_IMAGE_INLINE_LIMIT

const GOOGLE_THOUGHT_SIGNATURE_VALIDATOR_BYPASS = 'skip_thought_signature_validator'

async function resolveImageData(
  storageKey: string,
  resolveImage: ModelImageResolver
): Promise<{ base64Data: string; mediaType: string } | null> {
  try {
    const imageData = await resolveImage(storageKey)
    if (!imageData) return null
    return {
      base64Data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
      mediaType: imageData.match(/^data:([^;]+)/)?.[1] || 'image/png',
    }
  } catch {
    return null
  }
}

/**
 * Coerce an arbitrary tool result into a value the AI SDK accepts as a `json` tool output.
 * Tool results may carry non-serializable values (Error instances, circular refs, functions,
 * `undefined`) — e.g. when an MCP/tool execution fails and the raw error leaks into history.
 * Feeding those into `{ type: 'json', value }` makes the AI SDK's `ModelMessage[]` schema
 * validation throw `AI_InvalidPromptError`, blocking the whole request. This defensive net
 * guarantees the value is plain JSON before it reaches the SDK.
 */
function toSafeJSONValue(result: unknown): JSONValue {
  if (result == null) return null
  if (result instanceof Error) {
    return { error: result.message || String(result) }
  }
  try {
    // Round-trip through JSON to strip anything non-serializable. The replacer coerces the
    // values JSON.stringify would otherwise lose silently (nested Errors → `{}`) or throw on
    // (BigInt); JSON.stringify still drops `undefined`/functions and throws on circular refs
    // (caught below).
    return JSON.parse(
      JSON.stringify(result, (_key, value) => {
        if (value instanceof Error) return { error: value.message || String(value) }
        if (typeof value === 'bigint') return value.toString()
        return value
      })
    ) as JSONValue
  } catch {
    return stringifyErrorResult(result)
  }
}

function stringifyErrorResult(result: unknown): string {
  if (result == null) return 'Tool call failed'
  if (typeof result === 'string') return result
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    try {
      return JSON.stringify(result)
    } catch {
      /* fall through */
    }
  }
  return String(result)
}

/**
 * Coerce a tool-call's stored `args` into a JSON object for the wire `tool_use.input`.
 * Anthropic (and strict OpenAI-compatible) upstreams require `input` to be an object and reject
 * a string with HTTP 422 ("Input should be a valid dictionary"). Malformed model output can leave
 * `args` as an unparseable string — e.g. two concatenated JSON objects `{"q":"a"}{"q":"b"}` — which
 * was previously serialized verbatim, so every history resend of that turn 422'd. Parse strings
 * back into an object, falling back to `{}` when the string is not a JSON object.
 */
function toToolCallInput(args: unknown): unknown {
  if (typeof args !== 'string') return args
  try {
    const parsed = JSON.parse(args)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    /* malformed JSON — fall through to an empty object */
  }
  return {}
}

function hasGoogleThoughtSignature(part: MessageContentToolCallPart): boolean {
  const google = part.providerMetadata?.google
  return Boolean(
    google && typeof google === 'object' && 'thoughtSignature' in google && typeof google.thoughtSignature === 'string'
  )
}

function withGoogleThoughtSignatureBypass(part: MessageContentToolCallPart): MessageContentToolCallPart {
  return {
    ...part,
    providerMetadata: {
      ...part.providerMetadata,
      google: {
        ...part.providerMetadata?.google,
        thoughtSignature: GOOGLE_THOUGHT_SIGNATURE_VALIDATOR_BYPASS,
      },
    },
  }
}

function isCompletedToolCall(part: MessageContentParts[number]): part is MessageContentToolCallPart {
  return part.type === 'tool-call' && (part.state === 'result' || part.state === 'error')
}

function isSameToolCallBatch(first: MessageContentToolCallPart, next: MessageContentToolCallPart): boolean {
  // stepIndex is the provider-level step boundary; parts without one (legacy messages)
  // keep the old one-call-per-batch serialization.
  return first.stepIndex !== undefined && first.stepIndex === next.stepIndex
}

async function convertContentParts<T extends TextPart | ImagePart | FilePart>(
  contentParts: MessageContentParts,
  imageType: 'image' | 'file',
  resolveImage: ModelImageResolver,
  options?: { modelSupportVision: boolean }
): Promise<T[]> {
  return compact(
    await Promise.all(
      contentParts.map(async (c) => {
        if (c.type === 'text') {
          return { type: 'text', text: c.text } as T
        } else if (c.type === 'image') {
          if (options?.modelSupportVision === false) {
            return { type: 'text', text: `This is an image, OCR Result: \n${c.ocrResult}` } as T
          }
          const resolved = await resolveImageData(c.storageKey, resolveImage)
          if (!resolved) return null
          if (imageType === 'image') {
            return { type: 'image', image: resolved.base64Data, mediaType: resolved.mediaType } as T
          }
          return { type: 'file', data: resolved.base64Data, mediaType: resolved.mediaType } as T
        }
        return null
      })
    )
  )
}

function convertUserContentParts(
  contentParts: MessageContentParts,
  resolveImage: ModelImageResolver,
  options?: { modelSupportVision: boolean }
): Promise<Array<TextPart | ImagePart>> {
  return convertContentParts<TextPart | ImagePart>(contentParts, 'image', resolveImage, options)
}

/**
 * Reasoning replay mode after option resolution: `'text'` keeps reasoning text
 * with optional metadata (DeepSeek all-turns), `'signed-only'` keeps only
 * blocks carrying whitelisted replay metadata (Anthropic Messages signature
 * replay), `false` drops reasoning.
 */
type EffectiveReasoningReplay = false | 'text' | 'signed-only'

async function convertAssistantContentParts(
  contentParts: MessageContentParts,
  resolveImage: ModelImageResolver,
  options?: { preserveReasoning?: EffectiveReasoningReplay }
): Promise<Array<TextPart | FilePart | ToolCallPart | ReasoningPart>> {
  const results: Array<TextPart | FilePart | ToolCallPart | ReasoningPart | null> = await Promise.all(
    contentParts.map(async (c) => {
      if (c.type === 'tool-call') {
        if (c.state === 'call' || c.state === 'paused') return null
        return {
          type: 'tool-call' as const,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: toToolCallInput(c.args),
          providerExecuted: c.providerExecuted,
          providerOptions: c.providerMetadata,
        } satisfies ToolCallPart
      }
      if (c.type === 'text') {
        // Empty text parts never reach the wire: the Anthropic Messages API rejects
        // empty text blocks outright, and no other protocol needs them. Blocks kept
        // only for structure (`protocolOnly`) are equally invisible to providers
        // until a route that requires them (Bedrock Converse) opts in explicitly.
        if (!c.text || c.protocolOnly) return null
        return { type: 'text', text: c.text } as TextPart
      }
      // Reasoning is opt-in per provider. DeepSeek thinking mode requires it on follow-up
      // requests, including when routed through an OpenAI-compatible provider, but other
      // providers reject it (xAI Grok 400s on unknown `reasoning_content`) or merge it into
      // text content (Mistral concatenates without a separator). Default off keeps prior
      // behavior; orchestration enables it only for positively identified DeepSeek and
      // Anthropic Messages routes that require reasoning history on follow-up requests.
      if (c.type === 'reasoning') {
        const mode = options?.preserveReasoning
        if (!mode) return null
        // Only whitelisted replay metadata (Anthropic signature / redactedData) goes
        // back out; anything else persisted on the part must not leak onto the wire.
        const replayMetadata = pickPersistableProviderMetadata(c.providerMetadata)
        // The signed-replay channel (Anthropic Messages) carries only blocks
        // that can pass upstream signature validation; unsigned reasoning —
        // e.g. saved by app versions predating metadata capture — is omitted,
        // matching Cherry-style "skip foreign thinking, keep it in the UI".
        if (mode === 'signed-only' && !replayMetadata) return null
        if (!c.text && !replayMetadata) return null
        return {
          type: 'reasoning',
          text: c.text,
          ...(replayMetadata ? { providerOptions: replayMetadata } : {}),
        } satisfies ReasoningPart
      }
      if (c.type === 'image') {
        const resolved = await resolveImageData(c.storageKey, resolveImage)
        if (!resolved) return null
        return { type: 'file', data: resolved.base64Data, mediaType: resolved.mediaType } as FilePart
      }
      return null
    })
  )
  return results.filter((r): r is TextPart | FilePart | ToolCallPart | ReasoningPart => r !== null)
}

/**
 * Split assistant contentParts into segments around tool-call boundaries and emit
 * the correct message sequence: assistant(pre-tool + tool-call) → tool(result) → assistant(post-tool).
 * This preserves the ordering that providers expect for multi-turn tool use.
 */
type ToolResultModelOutput =
  | { type: 'error-text'; value: string }
  | { type: 'text'; value: string }
  | { type: 'json'; value: JSONValue }
  | {
      type: 'content'
      value: Array<{ type: 'text'; text: string } | { type: 'image-data'; data: string; mediaType: string }>
    }

function truncatedToolResultOutput(toolCallPart: MessageContentToolCallPart): ToolResultModelOutput {
  return {
    type: 'json',
    value: {
      _truncated: true,
      preview: String(toolCallPart.result ?? ''),
      fullResultFileKey: toolCallPart.resultStorageKey,
      hint: 'Result was too large and has been truncated. Use the read_file tool with the fullResultFileKey above to read the complete result.',
    } as JSONValue,
  }
}

function appendTruncatedResultNotice(
  output: ToolResultModelOutput,
  toolCallPart: MessageContentToolCallPart
): ToolResultModelOutput {
  const notice = `Additional tool result data was truncated. Preview: ${String(toolCallPart.result ?? '')}. Full result file key: ${toolCallPart.resultStorageKey}.`
  if (output.type === 'content') {
    return { ...output, value: [...output.value, { type: 'text', text: notice }] }
  }
  if (output.type === 'text') {
    return { ...output, value: `${output.value}\n${notice}` }
  }
  return output
}

/**
 * Re-deliver a stored tool result image as an actual image on history resends.
 * Protocols that accept media in tool results get it embedded there; other vision models
 * get a text tool output plus a follow-up user message with a real image part (the same
 * shape as a user-uploaded image — never base64-as-text). Returns null when the part is
 * not a usable image result, the model has no vision, or the stored blob is gone
 * (callers fall back to the plain JSON output, which still carries the file path).
 */
async function toToolResultImageOutput(
  toolCallPart: MessageContentToolCallPart,
  resolveImage: ModelImageResolver,
  options?: {
    modelSupportVision?: boolean
    supportToolResultImages?: boolean
    inlineImage?: boolean
  }
): Promise<{ output: ToolResultModelOutput; injection?: ViewImageInjection } | null> {
  if (options?.modelSupportVision === false) return null
  // Re-inlining tool image data is agent-generation behavior. Auxiliary callers such as
  // summaries and naming omit this option and must retain the compact JSON result.
  if (options?.supportToolResultImages === undefined) return null
  if (!options.inlineImage) return null
  const imageReference = getToolResultImageReference(toolCallPart)
  if (!imageReference) return null
  const resolved = await resolveImageData(imageReference.storageKey, resolveImage)
  if (!resolved) return null
  if (options?.supportToolResultImages) {
    return {
      output: buildViewImageToolResultContent({
        filePath: imageReference.filePath ?? toolCallPart.toolName,
        ...resolved,
      }),
    }
  }
  return {
    output: {
      type: 'text',
      value: viewImageAttachmentNotice(imageReference.filePath ?? toolCallPart.toolName),
    },
    injection: {
      filePath: imageReference.filePath ?? toolCallPart.toolName,
      base64Data: resolved.base64Data,
      mediaType: resolved.mediaType,
    },
  }
}

function collectRecentToolResultImagePositions(
  messages: Message[],
  limit: number
): ReadonlyMap<number, ReadonlySet<number>> {
  const selected = new Map<number, Set<number>>()
  const normalizedLimit = Math.max(0, Math.floor(limit))
  if (normalizedLimit === 0) return selected

  let selectedCount = 0
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = messages[messageIndex].contentParts ?? []
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]
      if (part.type !== 'tool-call' || part.state !== 'result') continue
      if (!getToolResultImageReference(part)) continue
      const selectedPartIndexes = selected.get(messageIndex) ?? new Set<number>()
      selectedPartIndexes.add(partIndex)
      selected.set(messageIndex, selectedPartIndexes)
      selectedCount += 1
      if (selectedCount >= normalizedLimit) return selected
    }
  }

  return selected
}

async function emitAssistantMessages(
  contentParts: MessageContentParts,
  resolveImage: ModelImageResolver,
  output: ModelMessage[],
  options?: {
    preserveReasoning?: EffectiveReasoningReplay
    ensureGoogleFunctionCallSignatures?: boolean
    modelSupportVision?: boolean
    supportToolResultImages?: boolean
    inlineToolResultImagePartIndexes?: ReadonlySet<number>
  }
): Promise<void> {
  let cursor = 0
  while (cursor < contentParts.length) {
    const tcIdx = contentParts.findIndex((part, index) => index >= cursor && isCompletedToolCall(part))
    if (tcIdx === -1) break

    // Collect the contiguous run of completed tool calls that belong to the same batch.
    const toolCallParts: MessageContentToolCallPart[] = []
    const toolCallPartIndexes: number[] = []
    for (let index = tcIdx; index < contentParts.length; index += 1) {
      const part = contentParts[index]
      if (!isCompletedToolCall(part)) break
      if (toolCallParts.length > 0 && !isSameToolCallBatch(toolCallParts[0], part)) break
      toolCallParts.push(part)
      toolCallPartIndexes.push(index)
    }
    const batchEnd = tcIdx + toolCallParts.length

    // Gemini 3 signs only the first functionCall of a batch, so a missing signature on the
    // batch head is the only case that needs the validator bypass.
    if (options?.ensureGoogleFunctionCallSignatures && !hasGoogleThoughtSignature(toolCallParts[0])) {
      toolCallParts[0] = withGoogleThoughtSignatureBypass(toolCallParts[0])
    }

    const segment = [...contentParts.slice(cursor, tcIdx), ...toolCallParts]
    const converted = await convertAssistantContentParts(segment, resolveImage, options)
    if (converted.length > 0) {
      output.push({ role: 'assistant' as const, content: converted })
    }

    const convertedToolResults = await Promise.all(
      toolCallParts.map(async (tc, index) => {
        let toolOutput: ToolResultModelOutput
        let injection: ViewImageInjection | undefined
        if (tc.state === 'error') {
          toolOutput = { type: 'error-text' as const, value: stringifyErrorResult(tc.result) }
        } else {
          const toolResultImageOutput = await toToolResultImageOutput(tc, resolveImage, {
            modelSupportVision: options?.modelSupportVision,
            supportToolResultImages: options?.supportToolResultImages,
            inlineImage: options?.inlineToolResultImagePartIndexes?.has(toolCallPartIndexes[index]),
          })
          injection = toolResultImageOutput?.injection
          if (toolResultImageOutput) {
            toolOutput = tc.resultStorageKey
              ? appendTruncatedResultNotice(toolResultImageOutput.output, tc)
              : toolResultImageOutput.output
          } else {
            toolOutput = tc.resultStorageKey
              ? truncatedToolResultOutput(tc)
              : ({ type: 'json' as const, value: toSafeJSONValue(tc.result) } as ToolResultModelOutput)
          }
        }
        return {
          toolResult: {
            type: 'tool-result' as const,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: toolOutput,
            providerOptions: tc.resultProviderMetadata,
          },
          injection,
        }
      })
    )

    output.push({
      role: 'tool' as const,
      content: convertedToolResults.map((entry) => entry.toolResult),
    })

    // Vision models on protocols without tool-result media get the image as a follow-up
    // user message with real image parts — the same shape as a user-uploaded image.
    const imageInjections = compact(convertedToolResults.map((entry) => entry.injection))
    if (imageInjections.length > 0) {
      output.push(buildViewImageUserMessage(imageInjections))
    }

    cursor = batchEnd
  }

  if (cursor < contentParts.length) {
    const remaining = contentParts.slice(cursor)
    const converted = await convertAssistantContentParts(remaining, resolveImage, options)
    if (converted.length > 0) {
      output.push({ role: 'assistant' as const, content: converted })
    }
  }
}

/**
 * Convert internal `Message[]` into AI SDK `ModelMessage[]`.
 *
 * Shared between the renderer store and the native chat engine so both shells produce
 * the same wire sequence — crucially preserving assistant tool-call / tool-result history
 * for multi-turn tool conversations. Image resolution is injected via `resolveImage`.
 *
 * Callers are expected to have already applied message sequencing / system→user coercion
 * (e.g. `sequenceMessages`) before calling.
 */
export async function convertToModelMessages(
  messages: Message[],
  resolveImage: ModelImageResolver,
  options?: ConvertToModelMessagesOptions
): Promise<ModelMessage[]> {
  const output: ModelMessage[] = []
  const effectiveReasoningReplay: EffectiveReasoningReplay = !options?.preserveReasoning
    ? false
    : options?.signedReasoningOnly
      ? 'signed-only'
      : 'text'
  const inlineToolResultImagePositions = collectRecentToolResultImagePositions(
    messages,
    options?.supportToolResultImages === undefined
      ? 0
      : (options.maxInlineToolResultImages ?? DEFAULT_MAX_INLINE_TOOL_RESULT_IMAGES)
  )

  for (const [messageIndex, m] of messages.entries()) {
    switch (m.role) {
      case 'system':
        output.push({
          role: 'system' as const,
          content: getMessageText(m),
        })
        break
      case 'user': {
        const contentParts = await convertUserContentParts(m.contentParts || [], resolveImage, options)
        output.push({
          role: 'user' as const,
          content: contentParts,
        })
        break
      }
      case 'assistant':
        await emitAssistantMessages(m.contentParts || [], resolveImage, output, {
          preserveReasoning: effectiveReasoningReplay,
          ensureGoogleFunctionCallSignatures: options?.ensureGoogleFunctionCallSignatures,
          modelSupportVision: options?.modelSupportVision,
          supportToolResultImages: options?.supportToolResultImages,
          inlineToolResultImagePartIndexes: inlineToolResultImagePositions.get(messageIndex),
        })
        break
      case 'tool':
        // Tool results are now handled inline from assistant message tool-call parts
        break
      default: {
        const _exhaustiveCheck: never = m.role
        throw new Error(`Unknown role: ${_exhaustiveCheck}`)
      }
    }
  }

  return output
}
