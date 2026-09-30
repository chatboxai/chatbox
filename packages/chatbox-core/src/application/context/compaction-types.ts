import type { Message } from '../../types'

/** A tool boundary in the active generation, independent of the selected UI branch. */
export interface GenerationCompactionRequest {
  kind: 'generation'
  targetMessageId: string
  retainedToolCallId: string
}

export type CompactionRequest =
  | { kind: 'automatic'; pendingMessage?: Message }
  | { kind: 'manual' }
  | GenerationCompactionRequest

export interface CompactionRunOptions {
  prompt?: string
  /** Called after admission, when this run owns the session compaction lifecycle. */
  onStart?: () => void
  onStreamUpdate?: (text: string) => void
  abortSignal?: AbortSignal
}

export type CompactionCoverage =
  | { kind: 'conversation'; boundaryMessageId: string }
  | (GenerationCompactionRequest & { boundaryMessageId: string })

export type CompactionFailureCode = 'session_not_found' | 'summary_failed' | 'no_messages' | 'update_failed'

export interface CompactionFailure {
  code: CompactionFailureCode
  message: string
  cause?: unknown
}

export type CompactionServiceResult =
  | { status: 'compacted'; summaryMessageId: string; summary: string; coverage: CompactionCoverage }
  | { status: 'skipped'; reason: 'not_needed' | 'no_model' | 'busy' | 'backup_busy' | 'stale_path' }
  | { status: 'cancelled' }
  | { status: 'failed'; failure: CompactionFailure }

export function compactionFailureError(failure: CompactionFailure): Error {
  return failure.cause instanceof Error ? failure.cause : new Error(failure.message)
}
