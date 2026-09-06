import type { ModelMessage } from 'ai'
import { estimateModelMessageTokens, estimateToolOutputTokens } from './context-message-tokens'

/** In-run relief activates at this fraction of the compaction threshold. */
export const MID_RUN_RELIEF_ACTIVATION_RATIO = 0.9
/** How many of the most recent tool-result messages stay intact when relieving. */
export const MID_RUN_KEEP_RECENT_TOOL_MESSAGES = 2
/** Outputs smaller than this are not worth rewriting (mutation without meaningful savings). */
const MIN_STUB_OUTPUT_TOKENS = 100

const TOOL_RESULT_STUB_TEXT =
  '[Old tool result cleared to save context space. Call the tool again if this result is needed.]'

type ToolMessage = Extract<ModelMessage, { role: 'tool' }>
type ToolResultItem = Extract<ToolMessage['content'][number], { type: 'tool-result' }>
type ToolOutput = ToolResultItem['output']

function isStubbableOutput(output: ToolOutput): boolean {
  // Errors and denials stay: they are small and their diagnostics matter.
  return output.type === 'text' || output.type === 'json' || output.type === 'content'
}

const stubbedMessageCache = new WeakMap<ToolMessage, { message: ToolMessage; savedTokens: number }>()
const STUB_OUTPUT: ToolOutput = { type: 'text', value: TOOL_RESULT_STUB_TEXT }
const STUB_OUTPUT_TOKENS = estimateToolOutputTokens(STUB_OUTPUT)

function stubToolMessage(message: ToolMessage): { message: ToolMessage; savedTokens: number } {
  const cached = stubbedMessageCache.get(message)
  if (cached) return cached
  let savedTokens = 0
  const content = message.content.map((part) => {
    if (part.type !== 'tool-result' || !isStubbableOutput(part.output)) {
      return part
    }
    const originalTokens = estimateToolOutputTokens(part.output)
    if (originalTokens <= MIN_STUB_OUTPUT_TOKENS) {
      return part
    }
    savedTokens += originalTokens - STUB_OUTPUT_TOKENS
    return { ...part, output: STUB_OUTPUT }
  })
  const result = { message: savedTokens === 0 ? message : { ...message, content }, savedTokens }
  stubbedMessageCache.set(message, result)
  return result
}

export interface MidRunToolResultReliefOptions {
  /** Compaction threshold for the driving model, in tokens. */
  thresholdTokens: number
  activationRatio?: number
  keepRecentToolMessages?: number
}

/**
 * Per-run mid-stream context pressure relief for long tool loops.
 *
 * Compaction can only run between user turns, but a single agent run may grow
 * by hundreds of tool steps. When the estimated step payload crosses the
 * activation threshold, older tool-result outputs are replaced with a stub
 * (assistant text, reasoning, and tool calls are never touched — thinking
 * signatures must survive verbatim).
 *
 * The stub watermark is a per-run ratchet: it only moves forward, and only
 * when the post-relief estimate is still above threshold. Between ratchet
 * events every step sees an identical prefix, so provider prompt caching keeps
 * working; a moving per-step window would invalidate the cache on every step.
 *
 * Returns the rewritten message array, or undefined when nothing changed.
 */
export function createMidRunToolResultRelief(
  options: MidRunToolResultReliefOptions
): (messages: ModelMessage[]) => ModelMessage[] | undefined {
  const {
    thresholdTokens,
    activationRatio = MID_RUN_RELIEF_ACTIVATION_RATIO,
    keepRecentToolMessages = MID_RUN_KEEP_RECENT_TOOL_MESSAGES,
  } = options
  const activationTokens = Math.floor(thresholdTokens * activationRatio)

  let stubbedUpTo = 0
  // Shrinks (monotonically) under sustained pressure, but never below 1: the
  // newest tool result is what the model just asked for — stubbing it would
  // make the model re-issue the call in a loop. If even keeping only the
  // newest result overflows, there is nothing more this layer can safely shed.
  let protectedTail = Math.max(1, keepRecentToolMessages)

  return (messages) => {
    if (messages.length === 0 || activationTokens <= 0) {
      return undefined
    }

    const applyWatermark = (): { messages: ModelMessage[]; savedTokens: number; changed: boolean } => {
      if (stubbedUpTo === 0) {
        return { messages, savedTokens: 0, changed: false }
      }
      let savedTokens = 0
      let changed = false
      const next = messages.map((message, index) => {
        if (index >= stubbedUpTo || message.role !== 'tool') {
          return message
        }
        const stubbed = stubToolMessage(message)
        if (stubbed.savedTokens > 0) {
          savedTokens += stubbed.savedTokens
          changed = true
        }
        return stubbed.message
      })
      return {
        messages: changed ? next : messages,
        savedTokens,
        changed,
      }
    }

    const watermarkKeepingLast = (keep: number): number => {
      let seenToolMessages = 0
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role !== 'tool') continue
        seenToolMessages += 1
        if (seenToolMessages > keep) {
          return index + 1
        }
      }
      return 0
    }

    let rawTokens = 0
    for (const message of messages) {
      rawTokens += estimateModelMessageTokens(message)
    }

    let applied = applyWatermark()
    if (rawTokens - applied.savedTokens < activationTokens) {
      return applied.changed ? applied.messages : undefined
    }

    // If even removing every eligible result cannot relieve the pressure,
    // advancing the watermark only destroys useful history and the cached
    // prefix. Preserve any existing watermark, but do not chase a moving tail
    // because of oversized user text, media, tool inputs, or error outputs.
    const possibleSavings = messages.reduce(
      (total, message) => total + (message.role === 'tool' ? stubToolMessage(message).savedTokens : 0),
      0
    )
    if (rawTokens - possibleSavings >= activationTokens) {
      return applied.changed ? applied.messages : undefined
    }

    // Ratchet: stub everything older than the protected tail; while still over
    // the activation threshold, shrink the tail (down to the floor of 1) so a
    // pair of giant recent results cannot pin the payload over the window.
    while (rawTokens - applied.savedTokens >= activationTokens) {
      const nextWatermark = watermarkKeepingLast(protectedTail)
      if (nextWatermark > stubbedUpTo) {
        stubbedUpTo = nextWatermark
        applied = applyWatermark()
      } else if (protectedTail > 1) {
        protectedTail -= 1
      } else {
        break
      }
    }

    return applied.changed ? applied.messages : undefined
  }
}
