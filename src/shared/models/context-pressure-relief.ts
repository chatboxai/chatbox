import type { ModelMessage } from 'ai'

/** In-run relief activates at this fraction of the compaction threshold. */
export const MID_RUN_RELIEF_ACTIVATION_RATIO = 0.9
/** How many of the most recent tool-result messages stay intact when relieving. */
export const MID_RUN_KEEP_RECENT_TOOL_MESSAGES = 2
/** Outputs smaller than this are not worth rewriting (mutation without meaningful savings). */
const MIN_STUB_OUTPUT_CHARS = 400
/** chars-per-token heuristic; matches the estimation used for the compaction threshold. */
const CHARS_PER_TOKEN = 4
const PER_MESSAGE_OVERHEAD_TOKENS = 4

const TOOL_RESULT_STUB_TEXT =
  '[Old tool result cleared to save context space. Call the tool again if this result is needed.]'

// Step messages accumulate append-only within one run; earlier message objects
// keep their identity across steps, so identity-keyed memoization avoids
// re-serializing the whole transcript on every step.
const messageTokenCache = new WeakMap<object, number>()

function estimateModelMessageTokens(message: ModelMessage): number {
  const cached = messageTokenCache.get(message)
  if (cached !== undefined) {
    return cached
  }
  let chars = 0
  try {
    chars = JSON.stringify(message.content)?.length ?? 0
  } catch {
    chars = 0
  }
  const tokens = Math.ceil(chars / CHARS_PER_TOKEN) + PER_MESSAGE_OVERHEAD_TOKENS
  messageTokenCache.set(message, tokens)
  return tokens
}

type ToolMessage = Extract<ModelMessage, { role: 'tool' }>
type ToolResultItem = Extract<ToolMessage['content'][number], { type: 'tool-result' }>
type ToolOutput = ToolResultItem['output']

function isStubbableOutput(output: ToolOutput): boolean {
  // Errors and denials stay: they are small and their diagnostics matter.
  return output.type === 'text' || output.type === 'json' || output.type === 'content'
}

function serializedOutputLength(output: ToolOutput): number {
  try {
    return JSON.stringify(output)?.length ?? 0
  } catch {
    return 0
  }
}

function stubToolMessage(message: ToolMessage): { message: ToolMessage; savedChars: number } {
  let savedChars = 0
  const content = message.content.map((part) => {
    if (part.type !== 'tool-result' || !isStubbableOutput(part.output)) {
      return part
    }
    const originalLength = serializedOutputLength(part.output)
    if (originalLength <= MIN_STUB_OUTPUT_CHARS) {
      return part
    }
    savedChars += originalLength - TOOL_RESULT_STUB_TEXT.length
    return { ...part, output: { type: 'text' as const, value: TOOL_RESULT_STUB_TEXT } }
  })
  if (savedChars === 0) {
    return { message, savedChars: 0 }
  }
  return { message: { ...message, content }, savedChars }
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
      let savedChars = 0
      let changed = false
      const next = messages.map((message, index) => {
        if (index >= stubbedUpTo || message.role !== 'tool') {
          return message
        }
        const stubbed = stubToolMessage(message)
        if (stubbed.savedChars > 0) {
          savedChars += stubbed.savedChars
          changed = true
        }
        return stubbed.message
      })
      return {
        messages: changed ? next : messages,
        savedTokens: Math.floor(savedChars / CHARS_PER_TOKEN),
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
