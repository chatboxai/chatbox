import type { ModelStreamPart } from '@shared/models/types'
import type {
  Message,
  MessageContentParts,
  MessageReasoningPart,
  MessageTextPart,
  MessageToolCallPart,
} from '@shared/types'
import type { ToolSet } from 'ai'

export interface StreamProcessorCallbacks {
  onFileReceived: (mediaType: string, base64: string) => Promise<string>
}

export interface StreamProcessorState {
  contentParts: MessageContentParts
  currentTextPart: MessageTextPart | undefined
  currentReasoningPart: MessageReasoningPart | undefined
  usage: Message['usage']
  finishReason: string | undefined
}

export function createInitialState(initialParts?: MessageContentParts): StreamProcessorState {
  return {
    contentParts: initialParts ? [...initialParts] : [],
    currentTextPart: undefined,
    currentReasoningPart: undefined,
    usage: undefined,
    finishReason: undefined,
  }
}

export function finalizeReasoningDuration(part: MessageReasoningPart | undefined): void {
  if (part?.startTime && !part.duration) {
    part.duration = Date.now() - part.startTime
  }
}

export async function processStreamChunk(
  chunk: ModelStreamPart<ToolSet>,
  state: StreamProcessorState,
  callbacks: StreamProcessorCallbacks
): Promise<{ state: StreamProcessorState; skipUpdate: boolean; statusChunk?: ModelStreamPart<ToolSet> }> {
  const { contentParts } = state
  let { currentTextPart, currentReasoningPart, usage, finishReason } = state

  switch (chunk.type) {
    case 'text-delta': {
      finalizeReasoningDuration(currentReasoningPart)
      currentReasoningPart = undefined
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
    case 'tool-call': {
      finalizeReasoningDuration(currentReasoningPart)
      currentTextPart = undefined
      currentReasoningPart = undefined
      const args = 'args' in chunk ? chunk.args : chunk.input
      const toolCallPart: MessageToolCallPart = {
        type: 'tool-call',
        state: 'call',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        args,
      }
      contentParts.push(toolCallPart)
      break
    }
    case 'tool-result': {
      const existing = contentParts.find((part) => part.type === 'tool-call' && part.toolCallId === chunk.toolCallId) as
        | MessageToolCallPart
        | undefined
      if (existing) {
        existing.state = 'result'
        existing.result = 'result' in chunk ? chunk.result : chunk.output
      }
      break
    }
    case 'tool-error': {
      finalizeReasoningDuration(currentReasoningPart)
      const existing = contentParts.find((part) => part.type === 'tool-call' && part.toolCallId === chunk.toolCallId) as
        | MessageToolCallPart
        | undefined
      if (existing) {
        existing.state = 'error'
        existing.result = {
          error: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
          input: chunk.input,
          toolName: chunk.toolName,
        }
      }
      break
    }
    case 'file': {
      if (chunk.file.mediaType?.startsWith('image/') && chunk.file.base64) {
        finalizeReasoningDuration(currentReasoningPart)
        const storageKey = await callbacks.onFileReceived(chunk.file.mediaType, chunk.file.base64)
        contentParts.push({ type: 'image', storageKey })
        currentTextPart = undefined
        currentReasoningPart = undefined
      }
      break
    }
    case 'status': {
      return {
        state: { contentParts, currentTextPart, currentReasoningPart, usage, finishReason },
        skipUpdate: true,
        statusChunk: chunk,
      }
    }
    case 'finish': {
      finishReason = 'finishReason' in chunk ? chunk.finishReason : finishReason
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
    state: { contentParts, currentTextPart, currentReasoningPart, usage, finishReason },
    skipUpdate: false,
  }
}
