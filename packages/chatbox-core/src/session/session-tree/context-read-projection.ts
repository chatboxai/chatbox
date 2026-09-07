import type { SessionContextBeforeTarget, SessionContextSeedAttachment } from '../../ports/session-context-source'
import type { CompactionPoint } from '../../types/session'

export interface ContextCheckpointEndpoint {
  messageId: string
  seq: number
  subtreeEnd: number
  eligible: boolean
}

export interface SessionContextCheckpoint {
  point: CompactionPoint
  boundary: ContextCheckpointEndpoint
  summary: ContextCheckpointEndpoint
  systemMessageId?: string
  /** Facts through and including the boundary. */
  prefix: Omit<SessionContextBeforeTarget, 'sandboxSeedAttachments'>
}

/** Sparse, reconstructible facts; no message bodies or complete topology. */
export interface SessionContextReadProjection {
  version: 1
  threads: Record<
    string,
    {
      rootMessageId: string | null
      hasSteeredMessages: boolean
      checkpoints: SessionContextCheckpoint[]
      attachments: Array<{ owner: ContextCheckpointEndpoint; files: SessionContextSeedAttachment[] }>
    }
  >
}
