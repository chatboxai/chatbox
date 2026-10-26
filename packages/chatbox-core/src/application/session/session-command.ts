import { cloneMessage } from '@shared/utils/message'
import type { SessionCommand } from '../../ports/session-repository'
import type { SessionRowCommit, SessionRowsDiff } from '../../ports/session-row-store'
import type { MessageRow, MessageRowMetadata, SessionRowRecord, ThreadRow } from '../../session/session-tree/types'
import { SessionHeaderSchema, type Message } from '../../types'
import { deriveMessageFacts } from '../../session/message-facts'
import { sessionRowHeader } from './session-row-header'
import { restoreMessageTextTokens } from './session-text-tokens'

export interface SessionCommandScope extends Omit<SessionRowCommit, 'record'> {
  record: SessionRowRecord
  /** The active thread; header and append commands never read a message window. */
  thread: ThreadRow
  /** Required only for append to a nonempty thread. */
  tail?: MessageRowMetadata
  /** First available direct-child order at the append anchor. */
  nextSiblingOrder?: number
}

export interface SessionCommandPlan {
  record: SessionRowRecord
  diff: SessionRowsDiff
  appendedMessageIds: string[]
}

export function emptySessionCommandPlan(record: SessionRowRecord): SessionCommandPlan {
  return {
    record,
    diff: {
      sessionId: record.id,
      threads: { upsert: [], delete: [] },
      messages: { upsert: [], delete: [] },
    },
    appendedMessageIds: [],
  }
}

function checkedOrder(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid sibling order')
  return value
}

/** Plans a mutation from its target rows. Relation and payload publication share one revision CAS. */
export function planSessionCommand(
  scope: SessionCommandScope,
  command: Exclude<SessionCommand, { type: 'structure' }>,
  selected: readonly MessageRow[] = []
): SessionCommandPlan {
  const { record, thread } = scope
  if (thread.sessionId !== record.id || thread.threadId !== record.activeThreadId)
    throw new Error('The active thread does not match the session commit')
  const plan = emptySessionCommandPlan(record)
  if (command.type === 'header') {
    const header = SessionHeaderSchema.parse({ ...sessionRowHeader(record), threadName: thread.name ?? undefined })
    const patch = typeof command.updater === 'function' ? command.updater(header) : command.updater
    SessionHeaderSchema.strict().parse({ ...header, ...patch })
    if (patch.id !== undefined && patch.id !== record.id) throw new Error('Session identity cannot change')
    const { threadName, ...fields } = patch
    if ((Object.keys(fields) as (keyof typeof fields)[]).some((key) => fields[key] !== record[key]))
      plan.record = { ...record, ...fields }
    if (Object.hasOwn(patch, 'threadName') && (thread.name ?? null) !== (threadName ?? null))
      plan.diff.threads.upsert.push({ ...thread, name: threadName ?? null })
    return plan
  }

  const byId = new Map<string, MessageRow>()
  for (const row of selected) {
    if (row.sessionId !== record.id || byId.has(row.messageId)) throw new Error('Invalid command message selection')
    byId.set(row.messageId, row)
  }
  if (command.type === 'update') {
    const row = byId.get(command.messageId)
    if (!row) return plan
    const current = cloneMessage(row.message)
    const patch = typeof command.updater === 'function' ? command.updater(current) : command.updater
    const message = restoreMessageTextTokens({ ...current, ...patch }, row.message)
    if (message.id !== row.messageId) throw new Error('Message identity cannot change')
    plan.diff.messages.upsert.push({
      ...row,
      message,
      facts: deriveMessageFacts(message),
      kind: message.isSummary ? 'summary' : 'message',
      status: message.generating ? 'generating' : 'settled',
      updatedAt: message.updatedAt ?? row.updatedAt,
    })
    return plan
  }

  const tail = scope.tail
  if (thread.activeLeafMessageId !== (tail?.messageId ?? null)) throw new Error('The append anchor changed')
  if (tail && (tail.sessionId !== record.id || tail.threadId !== thread.threadId || tail.activeChildId !== null))
    throw new Error('Invalid append anchor')
  if (!tail && thread.rootMessageId !== null) throw new Error('A nonempty thread requires an append anchor')
  if (tail && tail.pendingBranchOrder === undefined && scope.nextSiblingOrder === undefined)
    throw new Error('The append sibling order is required')
  const appended: MessageRow[] = []
  const inputs = new Map<string, Message>()
  for (const input of command.messages) {
    if (!input.id) throw new Error('Message identity is required')
    const duplicate = inputs.get(input.id)
    if (duplicate) {
      if (JSON.stringify(duplicate) !== JSON.stringify(input)) throw new Error('Conflicting appended message identity')
      continue
    }
    inputs.set(input.id, input)
    const existing = byId.get(input.id)
    if (existing) {
      if (existing.threadId !== thread.threadId || JSON.stringify(existing.message) !== JSON.stringify(input))
        throw new Error('Appended message identity already exists')
      continue
    }
    const previous = appended.at(-1)
    const message = { ...input, contentParts: [...input.contentParts] }
    const createdAt = message.timestamp ?? 0
    const row: MessageRow = {
      sessionId: record.id,
      threadId: thread.threadId,
      messageId: message.id,
      parentMessageId: previous?.messageId ?? tail?.messageId ?? null,
      activeChildId: null,
      siblingOrder: previous || !tail ? 0 : checkedOrder(tail.pendingBranchOrder ?? scope.nextSiblingOrder ?? 0),
      kind: message.isSummary ? 'summary' : 'message',
      status: message.generating ? 'generating' : 'settled',
      createdAt,
      updatedAt: message.updatedAt ?? createdAt,
      branchId: previous ? null : (tail?.pendingBranchId ?? null),
      facts: deriveMessageFacts(message),
      message,
    }
    if (previous) previous.activeChildId = row.messageId
    appended.push(row)
    plan.appendedMessageIds.push(row.messageId)
  }
  if (!appended.length) return plan
  plan.diff.messages.upsert.push(...appended)
  if (tail) {
    plan.diff.messageMetadataUpsert = [
      {
        ...tail,
        activeChildId: appended[0].messageId,
        pendingBranchId: undefined,
        pendingBranchOrder: undefined,
      },
    ]
  }
  plan.diff.threads.upsert.push({
    ...thread,
    rootMessageId: thread.rootMessageId ?? appended[0].messageId,
    activeLeafMessageId: appended.at(-1)!.messageId,
    createdAt: tail ? thread.createdAt : appended[0].createdAt,
  })
  return plan
}
