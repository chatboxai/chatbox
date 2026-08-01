import { BaseError } from '@shared/models/errors'
import { isPersistentToolCallPauseError } from '@shared/models/persistent-tool-call-pause'
import type { ModelStreamPart } from '@shared/models/types'
import type {
  Message,
  MessageContentParts,
  MessageContentToolCallPart,
  MessageReasoningPart,
  MessageStatus,
  MessageTextPart,
  MessageToolCallPart,
} from '@shared/types'
import { type ProviderMetadata, parsePartialJson, type ToolSet } from 'ai'

/** Maximum serialized size (in characters) before a tool result is offloaded to blob storage. */
export const TOOL_RESULT_SIZE_LIMIT = 30_000
/** Number of leading characters kept as an inline preview when a result is offloaded. */
export const TOOL_RESULT_PREVIEW_LENGTH = 1_500
const PREPARING_PROGRESS_MIN_DURATION_MS = 800
const PREPARING_PROGRESS_MIN_SIZE_KB = 1
const PREPARING_PROGRESS_MIN_LINES = 10

export interface StreamProcessorCallbacks {
  onFileReceived: (mediaType: string, base64: string) => Promise<string>
  /**
   * Called when a tool result exceeds TOOL_RESULT_SIZE_LIMIT.
   * Should persist the full result string and return a storage key.
   */
  onLargeToolResult?: (toolCallId: string, serialized: string) => Promise<string>
}

export interface StreamProcessorState {
  contentParts: MessageContentParts
  currentTextPart: MessageTextPart | undefined
  currentReasoningPart: MessageReasoningPart | undefined
  preparingToolInput: PreparingToolInputState | undefined
  usage: Message['usage']
  finishReason: string | undefined
  /**
   * Current generation step index. Tool calls emitted in the same step are a
   * provider-level parallel batch; Gemini 3 signs only the first functionCall
   * in such a batch.
   */
  stepIndex: number
}

interface PreparingToolInputState {
  toolCallId?: string
  toolName?: string
  providerMetadata?: ProviderMetadata
  inputText: string
  startedAt: number
  progress?: PreparingToolCallProgress
}

type PreparingToolCallProgress = Extract<
  Extract<MessageStatus, { type: 'preparing_tool_call' }>['progress'],
  { kind: 'size_kb' | 'lines' }
>

export function createInitialState(initialParts?: MessageContentParts): StreamProcessorState {
  let stepIndex = 0
  for (const part of initialParts ?? []) {
    if (part.type === 'tool-call' && part.stepIndex !== undefined && part.stepIndex >= stepIndex) {
      stepIndex = part.stepIndex + 1
    }
  }

  return {
    contentParts: initialParts ? [...initialParts] : [],
    currentTextPart: undefined,
    currentReasoningPart: undefined,
    preparingToolInput: undefined,
    usage: undefined,
    finishReason: undefined,
    stepIndex,
  }
}

export function finalizeReasoningDuration(part: MessageReasoningPart | undefined): void {
  if (part?.startTime && !part.duration) {
    part.duration = Date.now() - part.startTime
  }
}

export function finalizeToolCallDuration(part: MessageToolCallPart | undefined): void {
  if (part?.startTime && !part.duration) {
    part.duration = Date.now() - part.startTime
  }
}

export async function processStreamChunk(
  chunk: ModelStreamPart<ToolSet>,
  state: StreamProcessorState,
  callbacks: StreamProcessorCallbacks
): Promise<{
  state: StreamProcessorState
  skipUpdate: boolean
  statusChunk?: ModelStreamPart<ToolSet>
  persistentToolCallPause?: unknown
}> {
  const { contentParts } = state
  let { currentTextPart, currentReasoningPart, preparingToolInput, usage, finishReason, stepIndex } = state

  const nextState = (): StreamProcessorState => ({
    contentParts,
    currentTextPart,
    currentReasoningPart,
    preparingToolInput,
    usage,
    finishReason,
    stepIndex,
  })

  switch (chunk.type) {
    case 'text-delta': {
      finalizeReasoningDuration(currentReasoningPart)
      currentReasoningPart = undefined
      preparingToolInput = undefined
      if (currentTextPart) {
        currentTextPart.text += chunk.text
      } else {
        currentTextPart = { type: 'text', text: chunk.text }
        contentParts.push(currentTextPart)
      }
      break
    }
    case 'reasoning-delta': {
      if (chunk.text.trim()) {
        currentTextPart = undefined
        if (currentReasoningPart) {
          currentReasoningPart.text += chunk.text
        } else {
          currentReasoningPart = {
            type: 'reasoning',
            text: chunk.text,
            startTime: Date.now(),
          }
          contentParts.push(currentReasoningPart)
        }
      }
      break
    }
    case 'reasoning-end': {
      finalizeReasoningDuration(currentReasoningPart)
      currentReasoningPart = undefined
      preparingToolInput = { inputText: '', startedAt: Date.now() }
      return {
        state: nextState(),
        skipUpdate: true,
        statusChunk: {
          type: 'status',
          status: { type: 'preparing_tool_call' },
        },
      }
    }
    case 'tool-input-start': {
      finalizeReasoningDuration(currentReasoningPart)
      currentTextPart = undefined
      currentReasoningPart = undefined
      preparingToolInput = {
        toolCallId: getToolInputId(chunk),
        toolName: chunk.toolName,
        providerMetadata: chunk.providerMetadata,
        inputText: '',
        startedAt: Date.now(),
      }
      return {
        state: nextState(),
        skipUpdate: true,
        statusChunk: {
          type: 'status',
          status: { type: 'preparing_tool_call', toolName: chunk.toolName },
        },
      }
    }
    case 'tool-input-delta': {
      finalizeReasoningDuration(currentReasoningPart)
      currentTextPart = undefined
      currentReasoningPart = undefined
      const delta = getToolInputDelta(chunk)
      if (!preparingToolInput) {
        preparingToolInput = {
          toolCallId: getToolInputId(chunk),
          providerMetadata: chunk.providerMetadata,
          inputText: '',
          startedAt: Date.now(),
        }
      }
      preparingToolInput.providerMetadata = preparingToolInput.providerMetadata ?? chunk.providerMetadata
      preparingToolInput.inputText += delta
      const progress = await getPreparingToolCallProgress(
        preparingToolInput.toolName,
        preparingToolInput.inputText,
        Date.now() - preparingToolInput.startedAt
      )
      const previousProgress = preparingToolInput.progress
      preparingToolInput.progress = progress

      const statusChunk =
        progress && !isSamePreparingProgress(previousProgress, progress)
          ? ({
              type: 'status',
              status: {
                type: 'preparing_tool_call',
                toolName: preparingToolInput.toolName,
                progress,
              },
            } satisfies ModelStreamPart<ToolSet>)
          : undefined
      return {
        state: nextState(),
        skipUpdate: true,
        statusChunk,
      }
    }
    case 'tool-input-end': {
      finalizeReasoningDuration(currentReasoningPart)
      currentTextPart = undefined
      currentReasoningPart = undefined
      if (preparingToolInput) {
        preparingToolInput.providerMetadata = preparingToolInput.providerMetadata ?? chunk.providerMetadata
      }
      return {
        state: nextState(),
        skipUpdate: true,
      }
    }
    case 'tool-call': {
      finalizeReasoningDuration(currentReasoningPart)
      currentTextPart = undefined
      currentReasoningPart = undefined
      // preparingToolInput is single-slot state: with parallel tool calls it may belong to a
      // different, still-streaming call, so only consume it when the toolCallId matches (or when
      // it's the anonymous placeholder created at reasoning-end, which carries no metadata).
      const ownsPreparingToolInput = preparingToolInput?.toolCallId === chunk.toolCallId
      const providerMetadata =
        chunk.providerMetadata ?? (ownsPreparingToolInput ? preparingToolInput?.providerMetadata : undefined)
      if (ownsPreparingToolInput || !preparingToolInput?.toolCallId) {
        preparingToolInput = undefined
      }
      const args = 'args' in chunk ? chunk.args : chunk.input
      const toolCallPart: MessageContentToolCallPart = {
        type: 'tool-call',
        state: 'call',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        args,
        providerMetadata,
        providerExecuted: 'providerExecuted' in chunk ? chunk.providerExecuted : undefined,
        stepIndex,
        startTime: Date.now(),
      }
      contentParts.push(toolCallPart)
      break
    }
    case 'tool-result': {
      // A tool-result can interleave while another call's input is still streaming — only touch
      // preparingToolInput when it belongs to this toolCallId, otherwise a sibling call's
      // thoughtSignature would be stamped onto this part and the sibling's pending metadata wiped.
      const ownsPreparingToolInput = preparingToolInput?.toolCallId === chunk.toolCallId
      const providerMetadata = ownsPreparingToolInput ? preparingToolInput?.providerMetadata : undefined
      const existing = contentParts.find(
        (part): part is MessageContentToolCallPart => part.type === 'tool-call' && part.toolCallId === chunk.toolCallId
      )
      if (existing) {
        if (ownsPreparingToolInput) {
          preparingToolInput = undefined
        }
        existing.providerMetadata = existing.providerMetadata ?? providerMetadata
        existing.state = 'result'
        finalizeToolCallDuration(existing)
        const rawResult = 'result' in chunk ? chunk.result : chunk.output
        existing.resultProviderMetadata = chunk.providerMetadata

        // Check if the result is too large and should be offloaded to blob storage
        if (callbacks.onLargeToolResult) {
          let serialized: string
          try {
            serialized = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult)
          } catch {
            serialized = String(rawResult)
          }

          if (serialized.length > TOOL_RESULT_SIZE_LIMIT) {
            try {
              const storageKey = await callbacks.onLargeToolResult(chunk.toolCallId, serialized)
              existing.resultStorageKey = storageKey
              existing.result = serialized.slice(0, TOOL_RESULT_PREVIEW_LENGTH)
              break
            } catch {
              // Blob storage failed — fall through to store the raw result in the message
            }
          }
        }

        existing.result = rawResult
      }
      break
    }
    case 'tool-error': {
      finalizeReasoningDuration(currentReasoningPart)
      // Same single-slot caveat as tool-result: only consume preparingToolInput for this call.
      const ownsPreparingToolInput = preparingToolInput?.toolCallId === chunk.toolCallId
      const preparedProviderMetadata = ownsPreparingToolInput ? preparingToolInput?.providerMetadata : undefined
      if (ownsPreparingToolInput) {
        preparingToolInput = undefined
      }
      const existing = contentParts.find(
        (part): part is MessageContentToolCallPart => part.type === 'tool-call' && part.toolCallId === chunk.toolCallId
      )
      // Input-parse failures (formerly the dedicated `tool-input-error` chunk, removed in AI SDK v6)
      // now arrive here without a preceding `tool-call`, so create the part if it's missing.
      const toolCallPart: MessageContentToolCallPart =
        existing ??
        ({
          type: 'tool-call',
          state: 'call',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input,
          providerMetadata: chunk.providerMetadata ?? preparedProviderMetadata,
          providerExecuted: 'providerExecuted' in chunk ? chunk.providerExecuted : undefined,
          stepIndex,
        } satisfies MessageContentToolCallPart)
      if (existing) {
        // Existing parts only backfill call metadata captured while this call's input streamed;
        // the error chunk's own metadata is result-side and stored after the pause check below.
        existing.providerMetadata = existing.providerMetadata ?? preparedProviderMetadata
      } else {
        currentTextPart = undefined
        currentReasoningPart = undefined
        contentParts.push(toolCallPart)
      }
      if (isPersistentToolCallPauseError(chunk.error)) {
        return {
          state: nextState(),
          skipUpdate: false,
          persistentToolCallPause: chunk.error,
        }
      }
      toolCallPart.state = 'error'
      finalizeToolCallDuration(toolCallPart)
      toolCallPart.result = {
        error: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
        errorCode: chunk.error instanceof BaseError ? chunk.error.code : undefined,
        input: chunk.input,
        toolName: chunk.toolName,
      }
      if (existing) {
        toolCallPart.resultProviderMetadata = chunk.providerMetadata
      }
      break
    }
    case 'file': {
      if (chunk.file.mediaType?.startsWith('image/') && chunk.file.base64) {
        finalizeReasoningDuration(currentReasoningPart)
        preparingToolInput = undefined
        const storageKey = await callbacks.onFileReceived(chunk.file.mediaType, chunk.file.base64)
        contentParts.push({ type: 'image', storageKey })
        currentTextPart = undefined
        currentReasoningPart = undefined
      }
      break
    }
    case 'status': {
      return {
        state: nextState(),
        skipUpdate: true,
        statusChunk: chunk,
      }
    }
    case 'finish-step': {
      stepIndex += 1
      return {
        state: nextState(),
        skipUpdate: true,
      }
    }
    case 'finish': {
      finishReason = 'finishReason' in chunk ? chunk.finishReason : finishReason
      preparingToolInput = undefined
      if ('totalUsage' in chunk && chunk.totalUsage) {
        usage = chunk.totalUsage as Message['usage']
      }
      break
    }
    case 'error': {
      break
    }
    default:
      break
  }

  return {
    state: nextState(),
    skipUpdate: false,
  }
}

function getToolInputId(chunk: ModelStreamPart<ToolSet>): string | undefined {
  if (!('toolCallId' in chunk) || typeof chunk.toolCallId !== 'string') {
    if ('id' in chunk && typeof chunk.id === 'string') return chunk.id
    return undefined
  }
  return chunk.toolCallId
}

function getToolInputDelta(chunk: ModelStreamPart<ToolSet>): string {
  if ('inputTextDelta' in chunk && typeof chunk.inputTextDelta === 'string') return chunk.inputTextDelta
  if ('delta' in chunk && typeof chunk.delta === 'string') return chunk.delta
  return ''
}

async function getPreparingToolCallProgress(
  toolName: string | undefined,
  inputText: string,
  elapsedMs: number
): Promise<PreparingToolCallProgress | undefined> {
  if (!inputText) return undefined
  if (elapsedMs < PREPARING_PROGRESS_MIN_DURATION_MS) return undefined

  const lineSource = await getPreparingLineSource(toolName, inputText)
  if (lineSource !== undefined) {
    const lines = countLines(lineSource)
    return lines >= PREPARING_PROGRESS_MIN_LINES ? { kind: 'lines', value: lines } : undefined
  }

  const bytes = new TextEncoder().encode(inputText).length
  const sizeKb = Math.round((bytes / 1024) * 10) / 10
  return sizeKb >= PREPARING_PROGRESS_MIN_SIZE_KB ? { kind: 'size_kb', value: sizeKb } : undefined
}

async function getPreparingLineSource(toolName: string | undefined, inputText: string): Promise<string | undefined> {
  if (!toolName || !['code_execution', 'write_file', 'edit_file', 'sandbox_write', 'sandbox_edit'].includes(toolName)) {
    return undefined
  }

  const parsed = await parsePartialJson(inputText).catch(() => null)
  if (!parsed || !parsed.value || typeof parsed.value !== 'object') return undefined

  const value = parsed.value as Record<string, unknown>
  if (toolName === 'code_execution') return getStringValue(value, 'code')
  if (toolName === 'write_file' || toolName === 'sandbox_write') return getStringValue(value, 'content')
  const edits = value.edits
  if (Array.isArray(edits)) {
    const editTexts = edits
      .map((edit) => {
        if (!edit || typeof edit !== 'object') return undefined
        const record = edit as Record<string, unknown>
        return getStringValue(record, 'new_text') ?? getStringValue(record, 'old_text')
      })
      .filter((text): text is string => text !== undefined)
    if (editTexts.length > 0) return editTexts.join('\n')
  }
  return getStringValue(value, 'new_text') ?? getStringValue(value, 'old_text')
}

function getStringValue(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' ? field : undefined
}

function countLines(text: string): number {
  if (!text) return 0
  return text.split(/\r\n|\r|\n/).length
}

function isSamePreparingProgress(
  a: PreparingToolCallProgress | undefined,
  b: PreparingToolCallProgress | undefined
): boolean {
  return a?.kind === b?.kind && a?.value === b?.value
}
