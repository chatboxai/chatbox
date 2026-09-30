import { deriveContextReadProjection } from '../../persistence/session-context-read'
import type { SessionStructureSnapshot } from '../../ports/session-row-store'
import type {
  CurrentThreadIdentity,
  SessionStructureResult,
  SessionThreadOperation,
} from '../../ports/session-structure-command'
import type { MessageRow, ThreadRow } from '../../session/session-tree/types'
import { getCurrentConversationMessages, getConversationMessages } from '../../session/generation-state'
import type { Message, Session } from '../../types'
import { getMessageText } from '../../utils/message'
import { projectStructurePresentation, structureActivePath, type StructurePlan } from './session-structure-plan'

export function currentThreadIdentity(snapshot: SessionStructureSnapshot): CurrentThreadIdentity {
  return {
    sessionId: snapshot.record.id,
    firstMessageId: snapshot.threads.find((thread) => thread.seq === -1)?.rootMessageId ?? undefined,
    lastArchivedThreadId: snapshot.threads
      .filter((thread) => thread.seq !== -1)
      .sort((a, b) => a.seq - b.seq)
      .at(-1)?.threadId,
  }
}
function matchesIdentity(current: CurrentThreadIdentity, expected: CurrentThreadIdentity | undefined): boolean {
  return (
    !expected ||
    (current.sessionId === expected.sessionId &&
      current.firstMessageId === expected.firstMessageId &&
      current.lastArchivedThreadId === expected.lastArchivedThreadId)
  )
}
const emptyResult = (): SessionStructureResult => ({ applied: false, cancelMessageIds: [] })

export async function planThreadStructure(
  snapshot: SessionStructureSnapshot,
  operation: SessionThreadOperation,
  readMessages: (ids: string[]) => Promise<MessageRow[]>
): Promise<StructurePlan | null> {
  if (!snapshot.record.presentation || !snapshot.record.contextReadProjection) return null
  const active = snapshot.threads.find((thread) => thread.seq === -1)
  if (!active || active.threadId !== snapshot.record.id) return null
  const archived = snapshot.threads.filter((thread) => thread.seq !== -1).sort((a, b) => a.seq - b.seq)
  const plan: StructurePlan = {
    record: snapshot.record,
    threads: [...snapshot.threads],
    messages: [...snapshot.messages],
    upsertMessages: [],
    result: emptyResult(),
  }
  const id = snapshot.record.id
  const targetId = 'threadId' in operation ? operation.threadId : undefined
  const target = targetId === id ? active : archived.find((thread) => thread.threadId === targetId)
  const activeRows = snapshot.messages.filter((row) => row.threadId === id)
  const activePath = structureActivePath(snapshot)
  if (operation.action === 'thread-rename') {
    if (!target) return plan
    plan.threads = plan.threads.map((thread) =>
      thread === target ? { ...thread, name: operation.name ?? (thread.seq === -1 ? null : thread.name) } : thread
    )
    plan.result.applied = true
    return plan
  }
  const setContext = (oldId: string, newId: string) => {
    const projection = plan.record.contextReadProjection!
    const { [oldId]: previous, ...others } = projection.threads
    plan.record = {
      ...plan.record,
      contextReadProjection: { ...projection, threads: { ...others, ...(previous ? { [newId]: previous } : {}) } },
    }
  }
  const dropThread = (threadId: string) => {
    const removedIds = new Set(plan.messages.filter((row) => row.threadId === threadId).map((row) => row.messageId))
    plan.messages = plan.messages.filter((row) => row.threadId !== threadId)
    plan.threads = plan.threads.filter((thread) => thread.threadId !== threadId)
    const { [threadId]: _projection, ...threads } = plan.record.contextReadProjection!.threads
    plan.record = {
      ...plan.record,
      contextReadProjection: { ...plan.record.contextReadProjection!, threads },
      forkCreatedAt: Object.fromEntries(
        Object.entries(plan.record.forkCreatedAt ?? {}).filter(([pivot]) => !removedIds.has(pivot))
      ),
    }
  }
  const archiveActive = (archiveId: string, now: number) => {
    if (snapshot.threads.some((thread) => thread.threadId === archiveId) || archiveId === id)
      throw new Error('Archive identity already exists')
    plan.threads = plan.threads.filter((thread) => thread.threadId !== id)
    plan.threads.push({
      ...active,
      threadId: archiveId,
      seq: Math.max(-1, ...archived.map((thread) => thread.seq)) + 1,
      name: active.name || snapshot.record.name,
      createdAt: now,
      sessionPromptContextSnapshot: snapshot.record.settings?.sessionPromptContextSnapshot,
    })
    plan.messages = plan.messages.map((row) => (row.threadId === id ? { ...row, threadId: archiveId } : row))
    setContext(id, archiveId)
  }
  const restore = (thread: ThreadRow) => {
    const { sessionPromptContextSnapshot, ...fields } = thread
    plan.threads = plan.threads.filter((row) => row.threadId !== thread.threadId && row.threadId !== id)
    plan.threads.push({ ...fields, threadId: id, seq: -1 })
    plan.messages = plan.messages.map((row) => (row.threadId === thread.threadId ? { ...row, threadId: id } : row))
    setContext(thread.threadId, id)
    if (plan.record.settings)
      plan.record = { ...plan.record, settings: { ...plan.record.settings, sessionPromptContextSnapshot } }
  }
  if (operation.action === 'thread-delete') {
    if (!target) return plan
    if (target === active) {
      if (!matchesIdentity(currentThreadIdentity(snapshot), operation.expectedCurrent)) return plan
      if (operation.onlyEmpty) {
        if (activePath.length !== 1 || archived.length === 0) return plan
        const [root] = await readMessages([activePath[0].messageId])
        if (root?.message.role !== 'system') return plan
      }
    }
    plan.result.affectedMessageIds = snapshot.messages
      .filter((row) => row.threadId === target.threadId)
      .map((row) => row.messageId)
    plan.result.cancelMessageIds = snapshot.messages
      .filter((row) => row.threadId === target.threadId && row.status === 'generating')
      .map((row) => row.messageId)
    if (target !== active) dropThread(target.threadId)
    else {
      const last = archived.at(-1)
      let keep: MessageRow | undefined
      if (!last)
        keep = (await readMessages(activePath.map((row) => row.messageId))).find((row) => row.message.role === 'system')
      dropThread(id)
      if (last) restore(last)
      else {
        const row = keep ? { ...keep, parentMessageId: null, activeChildId: null, seq: 0, branchId: null } : undefined
        const thread: ThreadRow = {
          ...active,
          name: '',
          rootMessageId: row?.messageId ?? null,
          activeLeafMessageId: row?.messageId ?? null,
          compactionPoints: [],
        }
        plan.threads.push(thread)
        if (row) {
          const { message: _message, ...metadata } = row
          plan.messages.push(metadata)
        }
        plan.record = {
          ...plan.record,
          contextReadProjection: {
            ...plan.record.contextReadProjection!,
            threads: {
              ...plan.record.contextReadProjection!.threads,
              ...deriveContextReadProjection([thread], row ? [row] : []).threads,
            },
          },
          ...(plan.record.settings
            ? { settings: { ...plan.record.settings, sessionPromptContextSnapshot: undefined } }
            : {}),
        }
      }
    }
  } else if (operation.action === 'thread-switch') {
    if (!target || target === active) return plan
    plan.result.affectedMessageIds = activeRows.map((row) => row.messageId)
    plan.result.cancelMessageIds = activeRows.filter((row) => row.status === 'generating').map((row) => row.messageId)
    archiveActive(operation.archiveId, operation.now)
    restore(target)
  } else {
    plan.result.affectedMessageIds = activeRows.map((row) => row.messageId)
    plan.result.cancelMessageIds = activeRows.filter((row) => row.status === 'generating').map((row) => row.messageId)
    const system = (await readMessages(activePath.map((row) => row.messageId))).find(
      (row) => row.message.role === 'system'
    )?.message
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
    archiveActive(operation.archiveId, operation.now)
    const rows: MessageRow[] = messages.map((message, index) => ({
      sessionId: id,
      threadId: id,
      messageId: message.id,
      parentMessageId: messages[index - 1]?.id ?? null,
      activeChildId: messages[index + 1]?.id ?? null,
      seq: index,
      kind: 'message',
      status: 'settled',
      createdAt: operation.now,
      updatedAt: operation.now,
      branchId: null,
      message,
    }))
    if (rows.some((row) => snapshot.messages.some((old) => old.messageId === row.messageId)))
      throw new Error('New message identity already exists')
    const thread: ThreadRow = {
      sessionId: id,
      threadId: id,
      seq: -1,
      name: '',
      createdAt: operation.now,
      rootMessageId: messages[0]?.id ?? null,
      activeLeafMessageId: messages.at(-1)?.id ?? null,
      compactionPoints: [],
    }
    plan.threads.push(thread)
    plan.upsertMessages = rows
    plan.messages.push(...rows.map(({ message: _message, ...metadata }) => metadata))
    plan.record = {
      ...plan.record,
      contextReadProjection: {
        ...plan.record.contextReadProjection!,
        threads: {
          ...plan.record.contextReadProjection!.threads,
          ...deriveContextReadProjection([thread], rows).threads,
        },
      },
      ...(plan.record.settings
        ? { settings: { ...plan.record.settings, sessionPromptContextSnapshot: undefined } }
        : {}),
    }
  }
  // Keep archive order compact and its identities stable for rollback receipts.
  const order = plan.threads.filter((thread) => thread.seq !== -1).sort((a, b) => a.seq - b.seq)
  plan.threads = plan.threads.map((thread) => (thread.seq === -1 ? thread : { ...thread, seq: order.indexOf(thread) }))
  const newById = new Map(plan.upsertMessages.map((row) => [row.messageId, row.message]))
  const path = structureActivePath(plan)
  const persisted = await readMessages(path.filter((row) => !newById.has(row.messageId)).map((row) => row.messageId))
  const payloads = new Map(persisted.map((row) => [row.messageId, row.message]))
  const messages = path.map((row) => newById.get(row.messageId) ?? payloads.get(row.messageId)!).filter(Boolean)
  if (messages.length !== path.length) throw new Error('Active thread payload is missing')
  plan.record = projectStructurePresentation(plan.record, plan.threads, messages)
  plan.result.applied = true
  plan.result.currentThreadTarget = currentThreadIdentity({ ...plan, revision: snapshot.revision })
  return plan
}

export function applyThreadStructure(
  session: Session,
  operation: SessionThreadOperation
): { session: Session; result: SessionStructureResult } {
  const identity = (): CurrentThreadIdentity => ({
    sessionId: session.id,
    firstMessageId: session.messages[0]?.id,
    lastArchivedThreadId: session.threads?.at(-1)?.id,
  })
  const result = emptyResult()
  const target =
    'threadId' in operation ? session.threads?.find((thread) => thread.id === operation.threadId) : undefined
  let next = session
  const archive = (archiveId: string, now: number) => ({
    id: archiveId,
    name: session.threadName || session.name,
    messages: session.messages,
    createdAt: now,
    compactionPoints: session.compactionPoints,
    sessionPromptContextSnapshot: session.settings?.sessionPromptContextSnapshot,
  })
  const cancel = (messages: Message[]) => {
    result.affectedMessageIds = messages.map((message) => message.id)
    result.cancelMessageIds = messages.filter((message) => message.generating).map((message) => message.id)
  }
  if (operation.action === 'thread-rename') {
    if (operation.threadId === session.id) next = { ...session, threadName: operation.name }
    else if (target)
      next = {
        ...session,
        threads: session.threads?.map((thread) =>
          thread === target ? { ...thread, name: operation.name ?? thread.name } : thread
        ),
      }
  } else if (operation.action === 'thread-switch') {
    if (!target) return { session, result }
    cancel(getCurrentConversationMessages(session))
    next = {
      ...session,
      threads: [
        ...(session.threads ?? []).filter((thread) => thread !== target),
        archive(operation.archiveId, operation.now),
      ],
      messages: target.messages,
      threadName: target.name,
      compactionPoints: target.compactionPoints,
      settings: session.settings
        ? { ...session.settings, sessionPromptContextSnapshot: target.sessionPromptContextSnapshot }
        : session.settings,
    }
  } else if (operation.action === 'thread-create') {
    cancel(getCurrentConversationMessages(session))
    const system = session.messages.find((message) => message.role === 'system')
    const text = system ? getMessageText(system) : operation.summary ? '' : operation.defaultSystemPrompt
    const messages: Message[] = []
    if (!operation.summary || text)
      messages.push({
        id: operation.systemMessageId,
        role: 'system',
        contentParts: text ? [{ type: 'text', text }] : [],
        timestamp: operation.now,
      })
    if (operation.summary)
      messages.push({
        id: operation.summary.messageId,
        role: 'user',
        contentParts: [{ type: 'text', text: `Previous conversation summary:\n\n${operation.summary.text}` }],
        timestamp: operation.now,
      })
    next = {
      ...session,
      threads: [...(session.threads ?? []), archive(operation.archiveId, operation.now)],
      messages,
      threadName: '',
      compactionPoints: undefined,
      settings: session.settings ? { ...session.settings, sessionPromptContextSnapshot: undefined } : session.settings,
    }
  } else if (operation.threadId !== session.id) {
    if (!target) return { session, result }
    cancel(getConversationMessages(session, target.messages))
    next = { ...session, threads: session.threads?.filter((thread) => thread !== target) }
  } else {
    if (!matchesIdentity(identity(), operation.expectedCurrent)) return { session, result }
    if (
      operation.onlyEmpty &&
      (session.messages.length !== 1 || session.messages[0]?.role !== 'system' || !session.threads?.length)
    )
      return { session, result }
    cancel(getCurrentConversationMessages(session))
    const last = session.threads?.at(-1)
    next = {
      ...session,
      messages: last?.messages ?? session.messages.filter((message) => message.role === 'system').slice(0, 1),
      threads: last ? session.threads?.slice(0, -1) : session.threads,
      threadName: last?.name ?? '',
      compactionPoints: last?.compactionPoints,
      settings: session.settings
        ? { ...session.settings, sessionPromptContextSnapshot: last?.sessionPromptContextSnapshot }
        : session.settings,
    }
  }
  result.applied = next !== session
  if (result.applied)
    result.currentThreadTarget = {
      sessionId: next.id,
      firstMessageId: next.messages[0]?.id,
      lastArchivedThreadId: next.threads?.at(-1)?.id,
    }
  return { session: next, result }
}
