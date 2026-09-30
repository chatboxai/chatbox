import { migrateMessage } from '@shared/utils/message'
import { messageHasChatboxSearchSignInError } from '@shared/session/web-search-sign-in-error'
import { isContextEligibleMessage } from '@shared/context/message-eligibility'
import { toSandboxSeedAttachment } from '@shared/sandbox/attachment-path'
import { hasPendingPauseInteraction } from '../../message-approval'
import { preservesContextReadProjection } from '../../persistence/session-context-read'
import type { SessionCommand } from '../../ports/session-repository'
import type { SessionMessageWindow, SessionRowsDiff } from '../../ports/session-row-store'
import { messageRowStatus, messageRowUpdatedAt } from '../../session/session-tree'
import type { MessageRow, SessionRecordV2, ThreadRow } from '../../session/session-tree/types'
import { updateSessionTopologyFingerprint } from '../../session/session-tree/topology-fingerprint'
import type { Message, Session } from '../../types'
import { migrateSession } from './compatibility/session-load'
import { contextRecordHeader } from './session-context-source'
import { assertNoMessageDataUpdate } from './session-metadata'
import { restoreMessageTextTokens, withoutEstimatedTextTokens } from './session-text-tokens'
import { getSessionMessageTokenizationText } from './message-derived-data'

export function planSessionCommand(
  window: SessionMessageWindow,
  command: Exclude<SessionCommand, { type: 'structure' }>,
  selected: readonly MessageRow[],
  acceptsTokens: boolean,
  suffix: readonly MessageRow[] = []
): { record: SessionRecordV2; diff: SessionRowsDiff; appendedMessageIds: string[] } | null {
  const { record, thread } = window
  const summary = record.presentation
  const projection = record.contextReadProjection
  if (!summary || !projection) return null
  const tail = window.messages.at(-1)
  const diff: SessionRowsDiff = {
    sessionId: record.id,
    threads: { upsert: [], delete: [] },
    messages: { upsert: [], delete: [] },
  }
  let next = record
  const appendedMessageIds: string[] = []
  const count = (message: Message) => ({
    userMessageCount: Number(message.role === 'user'),
    fileMessageCount: Number(Boolean(message.files?.length)),
    generatingMessageCount: Number(message.generating === true),
    pausedMessageCount: Number(hasPendingPauseInteraction([message])),
    webSearchSignInErrorCount: Number(messageHasChatboxSearchSignInError(message)),
  })
  const changeCounts = (before: Message | undefined, after: Message) => {
    if (summary.webSearchSignInErrorCount === undefined) return false
    const added = count(after)
    const removed = before ? count(before) : undefined
    const presentation = { ...next.presentation! }
    for (const key of Object.keys(added) as (keyof typeof added)[])
      presentation[key] = (presentation[key] ?? 0) + added[key] - (removed?.[key] ?? 0)
    if (!before) presentation.messageCount += 1
    if (!after.isSummary && (!before || tail?.messageId === after.id))
      presentation.latestMessageHasWebSearchSignInError = messageHasChatboxSearchSignInError(after)
    next = { ...next, presentation }
    return true
  }
  if (command.type === 'header') {
    const header = { ...contextRecordHeader(record), threadName: thread.name ?? undefined }
    const patch = typeof command.updater === 'function' ? command.updater(header) : command.updater
    assertNoMessageDataUpdate(patch)
    if (patch.id !== undefined && patch.id !== record.id) throw new Error('Session identity cannot change')
    const { threadName, ...fields } = patch
    if ((Object.keys(fields) as (keyof typeof fields)[]).some((key) => fields[key] !== record[key]))
      next = { ...record, ...fields }
    if (Object.hasOwn(patch, 'threadName') && (thread.name ?? null) !== (threadName ?? null))
      diff.threads.upsert.push({ ...thread, name: threadName ?? null })
  } else if (command.type === 'update') {
    const row = selected.find((row) => row.messageId === command.messageId)
    if (!row) return { record, diff, appendedMessageIds }
    if (row.threadId !== thread.threadId || (summary.hasForks && row.messageId !== tail?.messageId)) return null
    const original = migrateMessage({ ...row.message, contentParts: [...(row.message.contentParts ?? [])] })
    const patch = typeof command.updater === 'function' ? command.updater(original) : command.updater
    let message = { ...original, ...patch }
    if (message.id !== row.messageId || Boolean(message.isSummary) !== (row.kind === 'summary')) return null
    if (acceptsTokens) message = restoreMessageTextTokens(message, row.message)
    else if (
      message.contentParts !== row.message.contentParts &&
      getSessionMessageTokenizationText(message) !== getSessionMessageTokenizationText(row.message)
    )
      message = withoutEstimatedTextTokens(message)
    if (!preservesContextReadProjection(row.message, message, projection)) return null
    if (!changeCounts(row.message, message)) return null
    diff.messages.upsert.push({
      ...row,
      message,
      status: messageRowStatus(message),
      updatedAt: messageRowUpdatedAt(message, row.createdAt),
    })
  } else {
    if (tail && Object.hasOwn(record.forkCreatedAt ?? {}, tail.messageId)) return null
    if (
      selected.some(
        (row) => row.threadId !== thread.threadId || (summary.hasForks && row.messageId !== tail?.messageId)
      )
    )
      return null
    if (tail?.kind === 'summary' || tail?.activeChildId || thread.activeLeafMessageId !== (tail?.messageId ?? null))
      return null
    const ids = new Set(selected.map((row) => row.messageId))
    const added: MessageRow[] = []
    let seq = tail ? tail.seq + 1 : 0
    for (const input of command.messages) {
      if (ids.has(input.id)) continue
      const message = migrateMessage({ ...input, contentParts: [...(input.contentParts ?? [])] })
      if (!message.id || message.isSummary || !Number.isSafeInteger(seq + 1)) return null
      ids.add(message.id)
      const createdAt = message.timestamp ?? 0
      const previous = added.at(-1)
      if (previous) previous.activeChildId = message.id
      added.push({
        sessionId: record.id,
        threadId: thread.threadId,
        messageId: message.id,
        parentMessageId: previous?.messageId ?? tail?.messageId ?? null,
        activeChildId: null,
        seq: seq++,
        kind: 'message',
        status: messageRowStatus(message),
        createdAt,
        updatedAt: messageRowUpdatedAt(message, createdAt),
        branchId: null,
        message,
      })
      if (!changeCounts(undefined, message)) return null
    }
    if (!added.length) return { record, diff, appendedMessageIds }
    const updatedThread = {
      ...thread,
      rootMessageId: thread.rootMessageId ?? added[0].messageId,
      activeLeafMessageId: added.at(-1)!.messageId,
      createdAt: tail ? thread.createdAt : added[0].createdAt,
    }
    diff.threads.upsert.push(updatedThread)
    if (tail) {
      diff.messages.upsert.push({ ...tail, activeChildId: added[0].messageId })
      diff.unchangedPayloadMessageIds = [tail.messageId]
    }
    if (
      suffix.some(
        (row) =>
          row.threadId !== thread.threadId ||
          row.seq < seq - added.length ||
          !Number.isSafeInteger(row.seq + added.length + 1)
      )
    )
      return null
    diff.messages.upsert.push(...added, ...suffix.map((row) => ({ ...row, seq: row.seq + added.length })))
    diff.unchangedPayloadMessageIds = [
      ...(diff.unchangedPayloadMessageIds ?? []),
      ...suffix.map((row) => row.messageId),
    ]
    appendedMessageIds.push(...added.map((row) => row.messageId))
    const prior = projection.threads[thread.threadId]
    if (!prior) return null
    const oldEnd = tail ? tail.seq + 1 : 0
    const extend = <T extends { seq: number; subtreeEnd: number }>(endpoint: T): T => ({
      ...endpoint,
      seq: endpoint.seq >= oldEnd ? endpoint.seq + added.length : endpoint.seq,
      subtreeEnd: endpoint.subtreeEnd >= oldEnd ? endpoint.subtreeEnd + added.length : endpoint.subtreeEnd,
    })
    next = {
      ...next,
      contextReadProjection: {
        ...projection,
        threads: {
          ...projection.threads,
          [thread.threadId]: {
            ...prior,
            rootMessageId: updatedThread.rootMessageId,
            hasSteeredMessages: prior.hasSteeredMessages || added.some((row) => row.message.steered === true),
            checkpoints: prior.checkpoints.map((point) => ({
              ...point,
              boundary: extend(point.boundary),
              summary: extend(point.summary),
            })),
            attachments: [
              ...prior.attachments.map((item) => ({ ...item, owner: extend(item.owner) })),
              ...added
                .filter((row) => row.message.files?.length)
                .map((row) => ({
                  owner: {
                    messageId: row.messageId,
                    seq: row.seq,
                    subtreeEnd: seq,
                    eligible: isContextEligibleMessage(row.message),
                  },
                  files: row.message.files!.map(toSandboxSeedAttachment),
                })),
            ],
          },
        },
      },
    }
    const topologyFingerprint = updateSessionTopologyFingerprint(
      record.topologyFingerprint,
      { threads: [thread], messages: [...(tail ? [tail] : []), ...suffix] },
      { threads: [updatedThread], messages: diff.messages.upsert }
    )
    if (!topologyFingerprint) return null
    next = { ...next, topologyFingerprint }
  }
  return { record: next, diff, appendedMessageIds }
}

/** Projects an ordinary committed command onto an already canonical active conversation. */
export function projectCommittedSessionCommand(
  session: Session,
  record: SessionRecordV2,
  thread: ThreadRow,
  diff: SessionRowsDiff,
  appendedMessageIds: readonly string[]
): Session {
  const unchanged = new Set(diff.unchangedPayloadMessageIds)
  const updates = new Map(
    diff.messages.upsert.filter((row) => !unchanged.has(row.messageId)).map((row) => [row.messageId, row.message])
  )
  const project = (message: Message) => migrateMessage({ ...message, contentParts: [...(message.contentParts ?? [])] })
  const messages = session.messages.map((message) => {
    const updated = updates.get(message.id)
    return updated ? project(updated) : message
  })
  for (const id of appendedMessageIds) messages.push(project(updates.get(id)!))
  return {
    ...migrateSession({ ...contextRecordHeader(record), messages: [] }),
    messages,
    threads: session.threads,
    messageForksHash: session.messageForksHash,
    ...(thread.name === null ? {} : { threadName: thread.name }),
    ...(thread.compactionPoints.length ? { compactionPoints: thread.compactionPoints } : {}),
  }
}
