import type { Message, Session } from '../../types'
import { contextSourceFromSession } from '../session/session-context-source'
import { findLastCompactionBoundaryMessage } from './compaction-boundary'
import type {
  CompactionCoverage,
  CompactionRequest,
  CompactionServiceResult,
  GenerationCompactionRequest,
} from './compaction-types'

type GenerationPath = { messages: Message[]; compactionPoints: Session['compactionPoints'] }

/** Resolve the same target path used for sending, and verify the retained round starts its assistant. */
function generationPath(session: Session, request: GenerationCompactionRequest): GenerationPath | undefined {
  try {
    const source = contextSourceFromSession(session, {
      sessionId: session.id,
      targetMessageId: request.targetMessageId,
    })
    const target = source.targetMessage
    const firstToolCall = target?.contentParts.find((part) => part.type === 'tool-call')
    if (!target?.generating || target.role !== 'assistant' || firstToolCall?.toolCallId !== request.retainedToolCallId)
      return undefined
    return { messages: source.candidateMessages, compactionPoints: source.compactionPoints }
  } catch {
    // A deleted target or detached fork cannot supply a generation context.
    return undefined
  }
}

export interface CompactionPlan {
  messages: Message[]
  coverage: CompactionCoverage
  /** Complete ancestry is checked even when message-count selection narrows the summary window. */
  pathMessageIds: readonly string[]
}

export async function createCompactionPlan(
  session: Session,
  request: CompactionRequest,
  selectContext: (session: Session, pendingMessage?: Message) => Message[] | Promise<Message[]>
): Promise<
  { status: 'ready'; plan: CompactionPlan } | Extract<CompactionServiceResult, { status: 'skipped' | 'failed' }>
> {
  const path = request.kind === 'generation' ? generationPath(session, request) : undefined
  if (request.kind === 'generation' && !path) return { status: 'skipped', reason: 'stale_path' }
  const scopedSession = path
    ? { ...session, messages: path.messages, compactionPoints: path.compactionPoints }
    : session
  const context = await selectContext(scopedSession, request.kind === 'automatic' ? request.pendingMessage : undefined)
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
      pathMessageIds: scopedSession.messages.map((message) => message.id),
    },
  }
}

/** Runs inside the session write coordinator immediately before the summary is committed. */
export function isCompactionPlanCurrent(session: Session, plan: CompactionPlan): boolean {
  if (plan.coverage.kind === 'conversation') return true
  const path = generationPath(session, plan.coverage)
  return Boolean(
    path &&
      path.messages.length === plan.pathMessageIds.length &&
      path.messages.every((message, index) => message.id === plan.pathMessageIds[index])
  )
}
