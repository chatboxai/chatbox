import type { SessionContextSource } from '../../ports/session-context-source'
import type { Message } from '../../types'
import { findLastCompactionBoundaryMessage } from './compaction-boundary'
import { type CompactionRetention, selectCompactionPrefix } from './compaction-retention'
import type { CompactionCoverage, CompactionRequest, CompactionServiceResult } from './compaction-types'

export interface CompactionPlan {
  messages: Message[]
  contextMessages: Message[]
  coverage: CompactionCoverage
  threadId: string
  pathMessageIds: readonly string[]
}

export async function createCompactionPlan(
  source: SessionContextSource,
  request: CompactionRequest,
  selectContext: (source: SessionContextSource, pendingMessage?: Message) => Message[] | Promise<Message[]>,
  retention?: CompactionRetention
): Promise<
  { status: 'ready'; plan: CompactionPlan } | Extract<CompactionServiceResult, { status: 'skipped' | 'failed' }>
> {
  if (request.kind === 'generation') {
    const target = source.targetMessage
    const firstTool = target?.contentParts.find((part) => part.type === 'tool-call')
    if (!target?.generating || target.role !== 'assistant' || firstTool?.toolCallId !== request.retainedToolCallId)
      return { status: 'skipped', reason: 'stale_path' }
  }
  const pendingMessage = request.kind === 'automatic' ? request.pendingMessage : undefined
  const context = await selectContext(source, pendingMessage)
  let prefix = context
  if (request.kind !== 'generation' && retention) {
    prefix = await selectCompactionPrefix(context, pendingMessage, retention)
  }
  const boundary = findLastCompactionBoundaryMessage(prefix)
  if (!boundary) {
    if (prefix.length < context.length) return { status: 'skipped', reason: 'not_needed' }
    return { status: 'failed', failure: { code: 'no_messages', message: 'No messages to compact' } }
  }
  const boundaryIndex = context.findIndex((message) => message.id === boundary.id)
  return {
    status: 'ready',
    plan: {
      messages: context.slice(0, boundaryIndex + 1),
      contextMessages: context,
      coverage:
        request.kind === 'generation'
          ? { ...request, boundaryMessageId: boundary.id }
          : { kind: 'conversation', boundaryMessageId: boundary.id },
      threadId: source.thread.threadId,
      pathMessageIds: source.pathMessageIds,
    },
  }
}
