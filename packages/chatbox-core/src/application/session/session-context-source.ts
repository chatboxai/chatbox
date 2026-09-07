import { findLatestApplicableCompactionPoint } from '@shared/context/compaction-points'
import { isContextEligibleMessage } from '@shared/context/message-eligibility'
import { findMessageContext, findMessageSourceThread } from '@shared/session/message-forks'
import { contextPathFacts } from '../../persistence/session-context-read'
import type {
  SessionContextRequest,
  SessionContextRows,
  SessionContextSource,
} from '../../ports/session-context-source'
import type { SessionHeader } from '../../ports/session-read-model'
import type { SessionRecordV2 } from '../../session/session-tree/types'
import type { Session } from '../../types/session'
import { overlayTextTokenMessages } from './session-text-tokens'

export function contextRecordHeader(record: SessionRecordV2): SessionHeader {
  const {
    storageFormat: _format,
    activeThreadId: _active,
    forkCreatedAt: _forks,
    presentation: _presentation,
    contextReadProjection: _context,
    topologyFingerprint: _topology,
    ...header
  } = record
  return header
}

export function contextSourceFromRows(rows: SessionContextRows): SessionContextSource {
  return {
    header: { ...contextRecordHeader(rows.record), threadName: rows.activeThreadName },
    thread: rows.thread,
    revision: rows.revision,
    candidateMessages: overlayTextTokenMessages(
      rows.messages.map((row) => row.message),
      rows.textTokens
    ),
    textTokens: rows.textTokens,
    compactionPoints: rows.thread.compactionPoints,
    targetMessage: rows.targetMessage ? overlayTextTokenMessages([rows.targetMessage], rows.textTokens)[0] : undefined,
    mode: rows.mode,
    beforeTarget: rows.beforeTarget,
    effectiveCompactionPoint: rows.effectiveCompactionPoint,
    topologyFingerprint: rows.record.topologyFingerprint,
  }
}

/** Compatibility reads use a complete, normalized Session before projecting a read-only source. */
export function contextSourceFromSession(session: Session, request: SessionContextRequest): SessionContextSource {
  const {
    messages: _messages,
    threads: _threads,
    messageForksHash: _forks,
    compactionPoints: _points,
    ...header
  } = session
  const archived = request.targetMessageId
    ? findMessageSourceThread(session, request.targetMessageId)
    : session.threads?.find((thread) => thread.id === request.threadId)
  if (request.threadId && request.threadId !== (archived?.id ?? session.id))
    throw new Error('Context thread is missing')
  const path = request.targetMessageId
    ? findMessageContext(session, request.targetMessageId)?.list
    : (archived?.messages ?? session.messages)
  if (!path) throw new Error('Context target is missing')
  const targetIndex = request.targetMessageId
    ? path.findIndex((message) => message.id === request.targetMessageId)
    : path.length
  if (targetIndex < 0) throw new Error('Context target is missing')
  const messages = path.slice(0, targetIndex + (request.targetMessageId && request.includeTarget ? 1 : 0))
  const points = archived?.compactionPoints ?? (archived ? [] : (session.compactionPoints ?? []))
  return {
    header,
    revision: null,
    candidateMessages: messages,
    compactionPoints: points,
    targetMessage: request.targetMessageId ? path[targetIndex] : undefined,
    mode: 'full-path',
    beforeTarget: { ...contextPathFacts(path.slice(0, targetIndex)), firstMessageTimestamp: path[0]?.timestamp },
    effectiveCompactionPoint: findLatestApplicableCompactionPoint(messages.filter(isContextEligibleMessage), points),
    thread: {
      sessionId: session.id,
      threadId: archived?.id ?? session.id,
      seq: archived ? (session.threads?.indexOf(archived) ?? 0) : -1,
      name: archived?.name ?? session.threadName ?? null,
      createdAt: archived?.createdAt ?? path[0]?.timestamp ?? 0,
      rootMessageId: path[0]?.id ?? null,
      activeLeafMessageId: path.at(-1)?.id ?? null,
      compactionPoints: points,
      sessionPromptContextSnapshot: archived?.sessionPromptContextSnapshot,
    },
  }
}
