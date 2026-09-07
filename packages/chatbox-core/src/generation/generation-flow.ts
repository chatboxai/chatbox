import type { ModelStreamPart } from '@shared/models/types'
import type {
  AppActionApprovalDetails,
  FileMutationApprovalStats,
  Message,
  MessageContentParts,
  MessageContentToolCallPart,
  MessageToolCallPart,
} from '@shared/types'
import type { ToolSet } from 'ai'
import { isApprovalPauseReason } from '../message-approval'
import type { StreamProcessorState } from './stream-chunk-processor'

export { isApprovalPauseReason } from '../message-approval'

type ExecutableTool = {
  execute?: (
    input: unknown,
    context: {
      toolCallId?: string
      approved?: boolean
      approvalWorkdir?: string
      approvalRetryOf?: string
      approvalDetails?: AppActionApprovalDetails
      abortSignal?: AbortSignal
    }
  ) => unknown
}

export function createPausedToolCallExecutionContext(
  part: Pick<MessageContentToolCallPart, 'toolCallId' | 'pauseReason'>,
  approvedToolCallId: string | undefined,
  abortSignal?: AbortSignal
): {
  toolCallId: string
  approved: boolean
  approvalWorkdir?: string
  approvalRetryOf?: string
  approvalDetails?: AppActionApprovalDetails
  abortSignal?: AbortSignal
} {
  // Approval is scoped to the exact call the user reviewed. Never infer authorization
  // from batch membership: a sibling call must pass through its own approval gate.
  const approved = part.toolCallId === approvedToolCallId
  return {
    toolCallId: part.toolCallId,
    approved,
    ...(abortSignal ? { abortSignal } : {}),
    ...(approved &&
    (part.pauseReason?.type === 'user_exec_approval' || part.pauseReason?.type === 'command_escalation_approval') &&
    part.pauseReason.workdir
      ? { approvalWorkdir: part.pauseReason.workdir }
      : {}),
    ...(approved && part.pauseReason?.type === 'command_escalation_approval'
      ? { approvalRetryOf: part.pauseReason.retryOf }
      : {}),
    approvalDetails:
      approved && part.pauseReason?.type === 'app_action_approval' ? part.pauseReason.details : undefined,
  }
}

export class ToolCallLimitPausedError extends Error {
  constructor(
    readonly toolCallId: string,
    readonly toolName: string,
    readonly maxToolCalls: number
  ) {
    super(`Tool call limit reached before executing ${toolName}`)
    this.name = 'ToolCallLimitPausedError'
  }
}

interface ToolCallLimitPauseError {
  name: 'ToolCallLimitPausedError'
  toolCallId: string
  maxToolCalls: number
}

interface UserExecPauseError {
  name: 'UserExecApprovalPausedError'
  toolCallId: string
  command: string
  explanation?: string
  explanationError?: boolean
  workdir?: string
}

interface FileMutationPauseError {
  name: 'FileMutationApprovalPausedError'
  toolCallId: string
  title: string
  preview: string
  stats?: unknown
}

/** Narrow the optional stats an older or third-party tool may omit or malform. */
function toFileMutationStats(value: unknown): FileMutationApprovalStats | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { mode, edits, addedLines, removedLines } = value as Record<string, unknown>
  if (mode !== 'write' && mode !== 'edit') return undefined
  if (typeof addedLines !== 'number' || typeof removedLines !== 'number') return undefined
  return {
    mode,
    edits: typeof edits === 'number' ? edits : undefined,
    addedLines,
    removedLines,
  }
}

interface CommandEscalationPauseError {
  name: 'CommandEscalationApprovalPausedError'
  toolCallId: string
  command: string
  retryOf: string
  justification: string
  workdir: string
}

function isCommandEscalationApprovalPausedError(error: unknown): error is CommandEscalationPauseError {
  return (
    isRecordWithName(error, 'CommandEscalationApprovalPausedError') &&
    typeof error.toolCallId === 'string' &&
    typeof error.command === 'string' &&
    typeof error.retryOf === 'string' &&
    typeof error.justification === 'string' &&
    typeof error.workdir === 'string'
  )
}

interface AppActionPauseError {
  name: 'AppActionApprovalPausedError'
  toolCallId: string
  action: string
  title: string
  preview: string
  details?: AppActionApprovalDetails
}

function isRecordWithName(error: unknown, name: string): error is Record<string, unknown> & { name: string } {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === name)
}

function isToolCallLimitPausedError(error: unknown): error is ToolCallLimitPauseError {
  return (
    isRecordWithName(error, 'ToolCallLimitPausedError') &&
    typeof error.toolCallId === 'string' &&
    typeof error.maxToolCalls === 'number'
  )
}

function isUserExecApprovalPausedError(error: unknown): error is UserExecPauseError {
  return (
    isRecordWithName(error, 'UserExecApprovalPausedError') &&
    typeof error.toolCallId === 'string' &&
    typeof error.command === 'string'
  )
}

function isFileMutationApprovalPausedError(error: unknown): error is FileMutationPauseError {
  return (
    isRecordWithName(error, 'FileMutationApprovalPausedError') &&
    typeof error.toolCallId === 'string' &&
    typeof error.title === 'string' &&
    typeof error.preview === 'string'
  )
}

function isAppActionApprovalPausedError(error: unknown): error is AppActionPauseError {
  return (
    isRecordWithName(error, 'AppActionApprovalPausedError') &&
    typeof error.toolCallId === 'string' &&
    typeof error.action === 'string' &&
    typeof error.title === 'string' &&
    typeof error.preview === 'string'
  )
}

export function getToolCallPause(error: unknown): {
  toolCallId: string
  pauseReason: MessageToolCallPart['pauseReason']
} | null {
  if (isToolCallLimitPausedError(error)) {
    return {
      toolCallId: error.toolCallId,
      pauseReason: { type: 'tool_call_limit', maxToolCalls: error.maxToolCalls },
    }
  }
  if (isUserExecApprovalPausedError(error)) {
    return {
      toolCallId: error.toolCallId,
      pauseReason: {
        type: 'user_exec_approval',
        command: error.command,
        explanation: typeof error.explanation === 'string' ? error.explanation : undefined,
        explanationError: typeof error.explanationError === 'boolean' ? error.explanationError : undefined,
        workdir: typeof error.workdir === 'string' ? error.workdir : undefined,
      },
    }
  }
  if (isCommandEscalationApprovalPausedError(error)) {
    return {
      toolCallId: error.toolCallId,
      pauseReason: {
        type: 'command_escalation_approval',
        command: error.command,
        retryOf: error.retryOf,
        justification: error.justification,
        workdir: error.workdir,
      },
    }
  }
  if (isFileMutationApprovalPausedError(error)) {
    return {
      toolCallId: error.toolCallId,
      pauseReason: {
        type: 'file_mutation_approval',
        title: error.title,
        preview: error.preview,
        stats: toFileMutationStats(error.stats),
      },
    }
  }
  if (isAppActionApprovalPausedError(error)) {
    return {
      toolCallId: error.toolCallId,
      pauseReason: {
        type: 'app_action_approval',
        action: error.action,
        title: error.title,
        preview: error.preview,
        details: error.details,
      },
    }
  }
  return null
}

export function applyPersistentToolCallPause(state: StreamProcessorState, error: unknown): StreamProcessorState {
  const pause = getToolCallPause(error)
  if (!pause) throw error
  return {
    ...state,
    contentParts: markToolCallPaused(state.contentParts, pause.toolCallId, pause.pauseReason),
  }
}

export function withToolCallLimitPause(tools: ToolSet, maxToolCalls: number): ToolSet {
  let toolCallsSinceConfirmation = 0
  const wrappedTools: Record<string, unknown> = {}

  for (const [toolName, toolValue] of Object.entries(tools as Record<string, unknown>)) {
    if (!toolValue || typeof toolValue !== 'object') {
      wrappedTools[toolName] = toolValue
      continue
    }

    const executableTool = toolValue as ExecutableTool
    if (typeof executableTool.execute !== 'function') {
      wrappedTools[toolName] = toolValue
      continue
    }

    const originalExecute = executableTool.execute
    wrappedTools[toolName] = {
      ...toolValue,
      execute: (input: unknown, context: { toolCallId?: string; approved?: boolean }) => {
        if (toolCallsSinceConfirmation >= maxToolCalls) {
          const toolCallId = context.toolCallId
          if (!toolCallId) {
            return { error: `Tool call limit reached (${maxToolCalls}). Please continue manually.` }
          }
          throw new ToolCallLimitPausedError(toolCallId, toolName, maxToolCalls)
        }

        toolCallsSinceConfirmation += 1
        return originalExecute(input, context)
      },
    }
  }

  return wrappedTools as ToolSet
}

export function markToolCallPaused(
  contentParts: MessageContentParts,
  toolCallId: string,
  pauseReason: MessageToolCallPart['pauseReason']
): MessageContentParts {
  // A tool-call-limit pause freezes the whole in-flight batch, while approval
  // pauses remain scoped to the call that requested authorization.
  const pausesBatch = pauseReason?.type === 'tool_call_limit'
  return contentParts.map((part) => {
    if (part.type !== 'tool-call') return part
    if (part.toolCallId !== toolCallId && !(pausesBatch && part.state === 'call')) return part
    return {
      ...part,
      state: 'paused',
      pauseReason,
    } satisfies MessageToolCallPart
  })
}

export function updateToolCallParts(
  message: Message,
  shouldUpdate: (part: MessageContentToolCallPart) => boolean,
  updater: (part: MessageContentToolCallPart) => MessageContentToolCallPart
): Message {
  return {
    ...message,
    contentParts: message.contentParts.map((part) =>
      part.type === 'tool-call' && shouldUpdate(part) ? updater(part) : part
    ),
  }
}

export function updateToolCallPart(
  message: Message,
  toolCallId: string,
  updater: (part: MessageContentToolCallPart) => MessageContentToolCallPart
): Message {
  return updateToolCallParts(message, (part) => part.toolCallId === toolCallId, updater)
}

export function cancelRunningToolCallBatch(
  message: Message,
  toolCallIds: ReadonlySet<string>,
  stoppedAt = Date.now()
): Message {
  return updateToolCallParts(
    message,
    (part) => toolCallIds.has(part.toolCallId) && part.state === 'call',
    (part) => {
      const duration = part.startTime ? stoppedAt - part.startTime : undefined
      if (part.toolName === 'user_exec' || part.toolName === 'code_execution') {
        return {
          ...part,
          state: 'result',
          pauseReason: undefined,
          resultStorageKey: undefined,
          resultImageStorageKey: undefined,
          resultImageMediaType: undefined,
          result: { success: false, exitCode: 130, stdout: '', stderr: '', cancelled: true },
          duration,
        }
      }
      return {
        ...part,
        state: 'error',
        pauseReason: undefined,
        resultStorageKey: undefined,
        resultImageStorageKey: undefined,
        resultImageMediaType: undefined,
        result: { error: 'Tool execution stopped by user.', cancelled: true },
        duration,
      }
    }
  )
}

/** Finalize every active step when the user stops the main generation stream. */
export function finishAbortedGeneration(
  message: Message,
  contentParts: MessageContentParts,
  stoppedAt = Date.now()
): Message {
  const runningToolCallIds = new Set<string>()
  const finalizedParts = contentParts.map((part) => {
    if (part.type === 'tool-call' && part.state === 'call') {
      runningToolCallIds.add(part.toolCallId)
    }
    if (part.type === 'reasoning' && part.startTime && !part.duration) {
      return { ...part, duration: stoppedAt - part.startTime }
    }
    return part
  })

  return cancelRunningToolCallBatch(
    {
      ...message,
      generating: false,
      contentParts: finalizedParts,
      status: [],
      finishReason: 'canceled',
    },
    runningToolCallIds,
    stoppedAt
  )
}

export function finishPausedToolCallContinuation(message: Message, finishReason?: string): Message {
  return {
    ...message,
    generating: false,
    finishReason,
  }
}

export function findToolCallPart(message: Message, toolCallId: string): MessageContentToolCallPart | undefined {
  return message.contentParts.find(
    (part): part is MessageContentToolCallPart => part.type === 'tool-call' && part.toolCallId === toolCallId
  )
}

export function findPausedToolCallLimitBatch(message: Message, toolCallId: string): MessageContentToolCallPart[] {
  const selected = findToolCallPart(message, toolCallId)
  if (selected?.pauseReason?.type !== 'tool_call_limit') return []
  return message.contentParts.filter(
    (part): part is MessageContentToolCallPart =>
      part.type === 'tool-call' && part.state === 'paused' && part.pauseReason?.type === 'tool_call_limit'
  )
}

export function getApprovalTrackingTarget(part: MessageToolCallPart) {
  if (part.pauseReason?.type === 'user_exec_approval') return 'user_exec' as const
  if (part.pauseReason?.type !== 'file_mutation_approval') return undefined
  if (part.toolName === 'write_file') return 'file_write' as const
  if (part.toolName === 'edit_file') return 'file_edit' as const
  return undefined
}

export function findPausedApprovalBatch(message: Message, toolCallId: string): MessageContentToolCallPart[] {
  const selected = findToolCallPart(message, toolCallId)
  if (!selected || selected.state !== 'paused' || !isApprovalPauseReason(selected.pauseReason)) return []
  if (selected.stepIndex === undefined) return [selected]
  return message.contentParts.filter(
    (part): part is MessageContentToolCallPart =>
      part.type === 'tool-call' &&
      part.state === 'paused' &&
      part.stepIndex === selected.stepIndex &&
      isApprovalPauseReason(part.pauseReason)
  )
}

export function hasPausedToolCallPart(message: Message): boolean {
  return message.contentParts.some((part) => part.type === 'tool-call' && part.state === 'paused')
}

export function findLastRetryableToolCallPart(message: Message): MessageToolCallPart | undefined {
  for (let index = message.contentParts.length - 1; index >= 0; index -= 1) {
    const part = message.contentParts[index]
    if (part.type === 'tool-call') {
      const toolCallPart = part as MessageToolCallPart
      if (isRetryableToolCallStep(toolCallPart)) {
        return toolCallPart
      }
    }
  }
  return undefined
}

export function isRetryableToolCallStep(part: MessageToolCallPart): boolean {
  return part.state === 'call' || part.state === 'result' || part.state === 'error'
}

export function keepContentPartsThroughToolCall(message: Message, toolCallId: string): MessageContentParts {
  const index = message.contentParts.findIndex((part) => part.type === 'tool-call' && part.toolCallId === toolCallId)
  return index >= 0 ? message.contentParts.slice(0, index + 1) : message.contentParts
}

export function shouldPersistStreamingChunk(
  chunkType: ModelStreamPart<ToolSet>['type'],
  elapsedMs: number,
  persistInterval: number
): boolean {
  // Tool calls can block the stream for a long time while waiting for approval,
  // so checkpoint them immediately instead of relying on the periodic ~2s flush.
  return chunkType === 'tool-call' || elapsedMs >= persistInterval
}
