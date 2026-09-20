import { getAcceptedImageBackgroundTaskResult } from './image-background-task-result'
import { workExecutionFeedback } from './mobile-work/execution-feedback'
import { ChatboxAIAPIError } from './models/errors'
import { SANDBOX_EXEC_ERROR_CODES } from './sandbox-provider'
import type { Message, MessageReasoningPart, MessageTextPart, MessageToolCallPart } from './types'

export type StepTimelinePart = MessageToolCallPart | MessageReasoningPart | MessageTextPart
export type IndexedTimelinePart = { part: StepTimelinePart; index: number }
export type StepTimelineEntry =
  | ({ type: 'part' } & IndexedTimelinePart)
  | { type: 'cluster'; steps: IndexedTimelinePart[] }

export interface StepTimelineOptions {
  generating?: boolean
  /** The active part of the whole message, not the last part of a display group. */
  activePart?: Message['contentParts'][number] | null
  /**
   * The last work step of the whole message, not the last step of a display group.
   * `parts` can be a slice of the message — a step group is cut wherever an image or
   * an answer follows a run — so the step to single out has to come from the message.
   * Only matched by identity, so it does not have to be a `StepTimelinePart`.
   * `undefined` falls back to the last step of `parts`.
   */
  lastStep?: object | null
  /**
   * Whether the user stopped this message. A command the user stops settles as a
   * plain result whose `cancelled` marker sits at the end of its payload, and a
   * payload over the size limit is offloaded to blob storage, leaving only a
   * truncated prefix the fold cannot parse. The message's own marker covers that.
   */
  canceled?: boolean
}

/** Activity rows sit close together; narration keeps a paragraph's room around it. */
export const WORK_TIMELINE_ROW_GAP = 4
export const WORK_TIMELINE_TEXT_GAP = 12

function isProtocolOnlyPart(part: { type: string; protocolOnly?: boolean }): boolean {
  return (part.type === 'text' || part.type === 'reasoning') && part.protocolOnly === true
}

/** The last visible tool call or thinking block of a message's parts, or `null` for none. */
export function getLastWorkStep<T extends { type: string; protocolOnly?: boolean }>(parts: readonly T[]): T | null {
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index]
    if (isProtocolOnlyPart(part)) continue
    if (part.type === 'tool-call' || part.type === 'reasoning') return part
  }
  return null
}

export function getActiveWorkPart(message: Pick<Message, 'contentParts' | 'generating'>) {
  if (!message.generating) return null
  return message.contentParts.findLast((part) => !isProtocolOnlyPart(part)) ?? null
}

/** Stable identity for rows and their expansion state as streaming groups change. */
export function getTimelinePartKey(part: StepTimelinePart, index: number): string {
  if (part.type === 'tool-call') return `tool-call:${part.toolCallId}`
  if (part.type === 'reasoning' && part.startTime !== undefined) return `reasoning:${part.startTime}`
  return `${part.type}:${index}`
}

function parseToolCallResult(value: unknown): Record<string, unknown> | null {
  let result: unknown = value
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result) as unknown
    } catch {
      return null
    }
  }
  if (!result || typeof result !== 'object') return null
  return result as Record<string, unknown>
}

/**
 * Whether a failed step leaves the user something to do — Bash is missing, the run
 * stopped because the app left the foreground, or the error carries a code the app
 * explains. Such a step keeps its own row and opens its guidance without a tap.
 */
export function stepNeedsUserAction(part: StepTimelinePart): boolean {
  if (part.type !== 'tool-call') return false
  // Reads the feedback marker out of a bare string as well as out of an `error` field,
  // so it runs before the object checks below and a text-carried result still reaches it.
  if (workExecutionFeedback(part.result, (key) => key)) return true
  const record = parseToolCallResult(part.result)
  if (!record) return false
  return (
    (part.state === 'result' && record.errorCode === SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE) ||
    (part.state === 'error' &&
      typeof record.errorCode === 'number' &&
      ChatboxAIAPIError.getDetail(record.errorCode) !== null)
  )
}

/**
 * Whether a step must keep its own row: still running, waiting for a decision,
 * stopped as the last step of the message, or failed in a way the user has to act on.
 * A plain failure — a tool error or a command that exited non-zero or timed out — and
 * a stop the agent worked past went back to the agent, which carries on from it, so
 * they fold with the rest of the run.
 */
export function stepNeedsAttention(part: StepTimelinePart, isLastStep: boolean, canceled = false): boolean {
  if (part.type !== 'tool-call') return false
  if (part.state === 'call' || part.state === 'paused') return true
  if (stepNeedsUserAction(part)) return true
  const record = parseToolCallResult(part.result)
  // An offloaded payload only leaves a truncated prefix behind, so the step's own
  // `cancelled` marker is out of reach; the message says whether the user stopped here.
  if (!record) return isLastStep && canceled && part.resultStorageKey !== undefined
  return (record.cancelled === true && isLastStep) || getAcceptedImageBackgroundTaskResult(record) !== null
}

/** Partition settled work without moving steps across narration or interactive cards. */
export function buildWorkTimelineEntries(
  parts: readonly StepTimelinePart[],
  options: StepTimelineOptions = {}
): StepTimelineEntry[] {
  const entries: StepTimelineEntry[] = []
  let run: IndexedTimelinePart[] = []
  let toolCount = 0
  const flush = () => {
    if (toolCount >= 2) entries.push({ type: 'cluster', steps: run })
    else for (const step of run) entries.push({ type: 'part', ...step })
    run = []
    toolCount = 0
  }
  const lastStep = options.lastStep === undefined ? getLastWorkStep(parts) : options.lastStep
  const activePart = options.activePart === undefined ? (options.generating ? parts.at(-1) : null) : options.activePart
  parts.forEach((part, index) => {
    if (part.type === 'text' || stepNeedsAttention(part, part === lastStep, options.canceled) || part === activePart) {
      flush()
      entries.push({ type: 'part', part, index })
    } else {
      run.push({ part, index })
      if (part.type === 'tool-call') toolCount++
    }
  })
  flush()
  return entries
}

export function measureToolCallCluster(steps: readonly IndexedTimelinePart[]): number {
  return steps.reduce((total, { part }) => {
    const duration = part.type === 'text' ? undefined : part.duration
    return total + (duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : 0)
  }, 0)
}
