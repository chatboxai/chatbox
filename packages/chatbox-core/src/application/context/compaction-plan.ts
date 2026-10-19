import type { SessionContextSource } from '../../ports/session-context-source'
import type { Message } from '../../types'
import { findLastCompactionBoundaryMessage } from './compaction-boundary'
import type { CompactionCoverage, CompactionRequest, CompactionServiceResult } from './compaction-types'

export interface CompactionPlan {
  messages: Message[]
  coverage: CompactionCoverage
  threadId: string
  pathMessageIds: readonly string[]
}

export async function createCompactionPlan(
  source: SessionContextSource,
  request: CompactionRequest,
  selectContext: (source: SessionContextSource, pendingMessage?: Message) => Message[] | Promise<Message[]>
): Promise<
  { status: 'ready'; plan: CompactionPlan } | Extract<CompactionServiceResult, { status: 'skipped' | 'failed' }>
> {
  if (request.kind === 'generation') {
    const target = source.targetMessage
    const firstTool = target?.contentParts.find((part) => part.type === 'tool-call')
    if (!target?.generating || target.role !== 'assistant' || firstTool?.toolCallId !== request.retainedToolCallId)
      return { status: 'skipped', reason: 'stale_path' }
  }
  const context = await selectContext(source, request.kind === 'automatic' ? request.pendingMessage : undefined)
  const boundary = findLastCompactionBoundaryMessage(context)
  if (!boundary) return { status: 'failed', failure: { code: 'no_messages', message: 'No messages to compact' } }
  const boundaryIndex = context.findIndex((message) => message.id === boundary.id)
  return {
    status: 'ready',
    plan: {
      messages: context.slice(0, boundaryIndex + 1),
      coverage:
        request.kind === 'generation'
          ? { ...request, boundaryMessageId: boundary.id }
          : { kind: 'conversation', boundaryMessageId: boundary.id },
      threadId: source.thread.threadId,
      pathMessageIds: source.pathMessageIds,
    },
  }
}
