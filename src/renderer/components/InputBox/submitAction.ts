import type { SessionActionBlockReason } from '@chatbox/core/session/action-gates'
import type { SessionType } from '@shared/types'

export type SubmitAction =
  /** Send immediately through the normal submit path. */
  | 'send'
  /** A generation is running: enqueue instead of sending. */
  | 'queue'
  /** Idle but earlier messages are still queued: enqueue behind them and drain to keep send order. */
  | 'queue-resume'
  /** Submission is not possible right now. */
  | 'block'

export type SubmitControl = 'send' | 'queue' | 'stop'

export function getSubmitControl(params: {
  generating: boolean
  /** A compaction summary is streaming (see getSubmitAction). */
  compactionBlocking?: boolean
  hasDraft: boolean
  canQueueDraft: boolean
  /** Mode policy: chat mode has no queue, so streaming keeps the Stop control. */
  queueEnabled: boolean
  sessionType?: SessionType
  hasModel: boolean
}): SubmitControl {
  const queueable =
    params.queueEnabled &&
    params.hasDraft &&
    params.canQueueDraft &&
    params.sessionType !== 'picture' &&
    params.hasModel
  if (queueable && (params.generating || params.compactionBlocking)) return 'queue'
  // Nothing to stop while a compression runs, so a non-queueable draft keeps
  // the (disabled) send control instead of a dead Stop.
  if (params.generating) return 'stop'
  return 'send'
}

export function getSubmitAction(params: {
  generating: boolean
  /**
   * A compaction summary is streaming. It holds the session generation lock,
   * so a queued draft simply delivers once the summary settles — the same
   * behind-the-current-work contract as queueing during a reply.
   */
  compactionBlocking?: boolean
  needGenerating: boolean
  sessionType?: SessionType
  queueLength: number
  blockedForOtherReasons: boolean
  /**
   * Mode policy: chat mode blocks submission while replies stream instead of
   * queueing. Legacy items already in the queue still drain in order —
   * `queue-resume` stays available so an idle send cannot jump ahead of them.
   */
  queueEnabled: boolean
  hasModel: boolean
}): SubmitAction {
  const {
    generating,
    compactionBlocking,
    needGenerating,
    sessionType,
    queueLength,
    blockedForOtherReasons,
    queueEnabled,
    hasModel,
  } = params
  if (sessionType === 'picture') return 'block'
  if (blockedForOtherReasons || !hasModel) return 'block'
  if (generating) {
    // "Insert without reply" during generation keeps its historical no-op behavior.
    if (!needGenerating) return 'block'
    return queueEnabled ? 'queue' : 'block'
  }
  if (compactionBlocking) {
    if (!needGenerating) return 'block'
    if (!queueEnabled) return 'block'
    // Same order preservation as the idle branch: the draft lines up behind
    // queued items (possibly a queued compression) instead of jumping them.
    return queueLength > 0 ? 'queue-resume' : 'queue'
  }
  if (needGenerating && queueLength > 0) return 'queue-resume'
  return 'send'
}

/** What the composer placeholder should say, before copy lookup. */
export type ComposerPlaceholder =
  /** Show the session lock notice for this reason. */
  | { kind: 'locked'; reason: SessionActionBlockReason }
  /** A reply streams and the draft can be queued behind it. */
  | { kind: 'queue' }
  /** The normal idle prompt. */
  | { kind: 'idle' }

export function getComposerPlaceholder(params: {
  /** Hard block (compaction / pending approval), independent of streaming. */
  blockReason: SessionActionBlockReason | undefined
  generating: boolean
  /** Mode policy: chat mode has no queue. */
  queueEnabled: boolean
}): ComposerPlaceholder {
  if (params.blockReason === 'compaction' && params.queueEnabled) {
    // Work mode keeps the composer typable while a compression runs: the draft
    // queues behind it, so the queue hint is the honest placeholder.
    return { kind: 'queue' }
  }
  if (params.blockReason !== undefined) return { kind: 'locked', reason: params.blockReason }
  if (!params.generating) return { kind: 'idle' }
  // Chat mode keeps the composer typable while replies stream but rejects the
  // send, so the placeholder shows the same notice as the rejection toast
  // instead of promising a queue the mode does not offer.
  return params.queueEnabled ? { kind: 'queue' } : { kind: 'locked', reason: 'generating' }
}
