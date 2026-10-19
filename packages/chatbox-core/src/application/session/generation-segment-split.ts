import type { Message } from '../../types'
import type { SessionService } from './SessionService'
import { snapshotStreamingMessage } from './streaming-message-snapshot'
import type { StreamingWriteCoordinator } from './streaming-write-coordinator'

export interface GenerationSegmentSplit {
  prefix: Message
  continuation: Message
  afterMessageId: string
}

/** True means BOTH messages are durable, even if metadata projection rejected. */
export type GenerationSegmentSplitWriter = (
  sessionId: string,
  split: GenerationSegmentSplit,
  signal: AbortSignal
) => Promise<boolean>

function splitSnapshot(message: Message): Message {
  return {
    ...snapshotStreamingMessage(message),
    // Neither half can reuse token/word counts from the unsplit assistant.
    tokenCount: undefined,
    tokenCountMap: undefined,
    tokenCalculatedAt: undefined,
    tokenCountApproximate: undefined,
    wordCount: undefined,
  }
}

/** Terminal serialization drains checkpoints before the atomic row split. */
export function createGenerationSegmentSplitWriter(options: {
  sessions: Pick<SessionService, 'executeStructureCommand'>
  streamingWrites: Pick<StreamingWriteCoordinator, 'persistTerminal'>
}): GenerationSegmentSplitWriter {
  return async (sessionId, input, signal) => {
    if (signal.aborted) return false
    const split = {
      prefix: splitSnapshot(input.prefix),
      continuation: splitSnapshot(input.continuation),
      afterMessageId: input.afterMessageId,
    }
    let committed = false
    try {
      await options.streamingWrites.persistTerminal(`${sessionId}\u0000${split.prefix.id}`, async () => {
        const result = await options.sessions.executeStructureCommand(
          sessionId,
          {
            action: 'generation-segment-split',
            ...split,
            abortSignal: signal,
          },
          (result) => {
            committed = result.applied
          }
        )
        committed = result?.applied ?? committed
      })
    } catch (error) {
      if (!committed) throw error
    }
    return committed
  }
}
