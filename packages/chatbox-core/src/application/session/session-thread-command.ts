import { SessionWriteConflictError } from '../../ports/session-repository'
import type { CurrentThreadIdentity, SessionThreadOperation } from '../../ports/session-structure-command'
import type { Message, SessionHeader } from '../../types'
import type { ThreadRow } from '../../session/session-tree/types'
import { UNTITLED_SESSION_NAME } from '../../session/auto-title'
import { getMessageText } from '../../utils/message'
import { retainedSystem } from './session-message-structure'
import {
  assertNewMessages,
  emptyStructurePlan,
  newMessageRow,
  putThread,
  type StructureCommandReader,
  type StructurePlan,
} from './session-structure-plan'

function matchesIdentity(current: CurrentThreadIdentity, expected: CurrentThreadIdentity | undefined): boolean {
  return (
    !expected ||
    (current.sessionId === expected.sessionId &&
      current.firstMessageId === expected.firstMessageId &&
      current.lastArchivedThreadId === expected.lastArchivedThreadId)
  )
}

export async function currentThreadIdentity(reader: StructureCommandReader): Promise<CurrentThreadIdentity> {
  return {
    sessionId: reader.record.id,
    firstMessageId: reader.activeThread.rootMessageId ?? undefined,
    lastArchivedThreadId: (await reader.latestArchivedThread())?.threadId,
  }
}

function restorePrompt(settings: SessionHeader['settings'], thread: ThreadRow): SessionHeader['settings'] {
  if (!settings && !thread.sessionPromptContextSnapshot) return undefined
  return { ...settings, sessionPromptContextSnapshot: thread.sessionPromptContextSnapshot }
}

/** Thread identity belongs to its rows and remains stable when its display position changes. */
export async function planThreadStructure(
  reader: StructureCommandReader,
  operation: SessionThreadOperation
): Promise<StructurePlan> {
  const plan = emptyStructurePlan(reader)
  const active = reader.activeThread
  const target = 'threadId' in operation ? await reader.thread(operation.threadId) : null
  if (operation.action === 'thread-title-commit') {
    if (
      !target ||
      target.threadId !== active.threadId ||
      (target.summary?.firstNamingUserMessageId ?? null) !== operation.expectedFirstNamingUserMessageId
    )
      return plan
    if (
      operation.onlyPending &&
      (!target.summary?.hasAutoTitleContent ||
        (operation.mode === 'name-and-thread' ? reader.record.name !== UNTITLED_SESSION_NAME : Boolean(target.name)))
    )
      return plan
    putThread(plan, { ...target, name: operation.name })
    if (operation.mode === 'name-and-thread') plan.record = { ...plan.record, name: operation.name }
    plan.result.applied = true
    return plan
  }
  if (operation.action === 'thread-rename') {
    if (!target) return plan
    putThread(plan, { ...target, name: operation.name ?? (target.threadId === active.threadId ? null : target.name) })
    plan.result.applied = true
    return plan
  }
  const latest = await reader.latestArchivedThread()
  const archive = (now: number) => {
    const seq = (latest?.seq ?? -1) + 1
    if (!Number.isSafeInteger(seq)) throw new Error('Thread ordering exhausted')
    putThread(plan, {
      ...active,
      seq,
      name: active.name || reader.record.name,
      createdAt: now,
      sessionPromptContextSnapshot: reader.record.settings?.sessionPromptContextSnapshot,
    })
    plan.result.affectedScopes = [{ type: 'thread', threadId: active.threadId }]
  }
  const restore = (thread: ThreadRow) => {
    const { sessionPromptContextSnapshot: _snapshot, ...activeFields } = thread
    putThread(plan, { ...activeFields, seq: -1 })
    plan.record = {
      ...plan.record,
      activeThreadId: thread.threadId,
      settings: restorePrompt(plan.record.settings, thread),
    }
    plan.result.navigation = { type: 'thread-switch', threadId: thread.threadId }
  }
  if (operation.action === 'thread-switch') {
    if (!target || target.threadId === active.threadId) return plan
    archive(operation.now)
    restore(target)
    plan.result.currentThreadTarget = {
      sessionId: plan.record.id,
      firstMessageId: target.rootMessageId ?? undefined,
      lastArchivedThreadId: active.threadId,
    }
  } else if (operation.action === 'thread-delete') {
    if (operation.expectedRevision !== undefined && operation.expectedRevision !== reader.revision)
      throw new SessionWriteConflictError(reader.record.id, operation.expectedRevision, reader.revision)
    if (!target) return plan
    if (operation.expectedCurrent && target.threadId !== active.threadId) return plan
    if (target.threadId === active.threadId) {
      if (
        !matchesIdentity(
          {
            sessionId: reader.record.id,
            firstMessageId: active.rootMessageId ?? undefined,
            lastArchivedThreadId: latest?.threadId,
          },
          operation.expectedCurrent
        )
      )
        return plan
      if (
        operation.onlyEmpty &&
        (!latest || active.summary?.messageCount !== 1 || active.summary.firstSystemMessageId !== active.rootMessageId)
      )
        return plan
    }
    plan.diff.deleteThreadMessages = [target.threadId]
    plan.result.affectedScopes = [{ type: 'thread', threadId: target.threadId }]
    if (target.threadId !== active.threadId || latest) {
      plan.diff.threads.delete.push(target.threadId)
      if (target.threadId === active.threadId && latest) restore(latest)
    } else {
      if (!active.summary) throw new Error('Thread summary is unavailable')
      const keep = active.summary.firstSystemMessageId
        ? (await reader.messages([active.summary.firstSystemMessageId]))[0]
        : undefined
      if (active.summary.firstSystemMessageId && !keep) throw new Error('Missing retained system message')
      if (keep) plan.diff.messages.upsert.push(retainedSystem(keep))
      putThread(plan, {
        ...active,
        name: '',
        rootMessageId: keep?.messageId ?? null,
        activeLeafMessageId: keep?.messageId ?? null,
        compactionPoints: [],
        sessionPromptContextSnapshot: undefined,
      })
      if (plan.record.settings)
        plan.record = { ...plan.record, settings: { ...plan.record.settings, sessionPromptContextSnapshot: undefined } }
      plan.result.navigation = { type: 'thread-switch', threadId: active.threadId }
    }
  } else {
    if (await reader.thread(operation.archiveId)) throw new Error('Thread identity already exists')
    if (!active.summary) throw new Error('Thread summary is unavailable')
    const systemId = active.summary.firstSystemMessageId
    const system = systemId ? (await reader.messages([systemId]))[0]?.message : undefined
    if (systemId && !system) throw new Error('Missing system prompt message')
    const content = system ? getMessageText(system) : operation.summary ? '' : operation.defaultSystemPrompt
    const messages: Message[] = []
    if (!operation.summary || content)
      messages.push({
        id: operation.systemMessageId,
        role: 'system',
        contentParts: content ? [{ type: 'text', text: content }] : [],
        timestamp: operation.now,
      })
    if (operation.summary)
      messages.push({
        id: operation.summary.messageId,
        role: 'user',
        contentParts: [{ type: 'text', text: `Previous conversation summary:\n\n${operation.summary.text}` }],
        timestamp: operation.now,
      })
    await assertNewMessages(reader, messages)
    archive(operation.now)
    const threadId = operation.archiveId
    plan.diff.messages.upsert.push(
      ...messages.map((message, index) => ({
        ...newMessageRow(reader.record.id, threadId, message, messages[index - 1]?.id ?? null, 0),
        activeChildId: messages[index + 1]?.id ?? null,
      }))
    )
    plan.appendedMessageIds.push(...messages.map((message) => message.id))
    const thread: ThreadRow = {
      sessionId: reader.record.id,
      threadId,
      seq: -1,
      name: '',
      createdAt: operation.now,
      rootMessageId: messages[0]?.id ?? null,
      activeLeafMessageId: messages.at(-1)?.id ?? null,
      compactionPoints: [],
    }
    restore(thread)
    plan.result.currentThreadTarget = {
      sessionId: reader.record.id,
      firstMessageId: thread.rootMessageId ?? undefined,
      lastArchivedThreadId: active.threadId,
    }
  }
  plan.result.applied = true
  return plan
}
