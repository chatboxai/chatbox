import type { SessionMessageStructureOperation } from '../../ports/session-structure-command'
import { deriveMessageFacts } from '../../session/message-facts'
import {
  appendNewChain,
  assertNewMessages,
  emptyStructurePlan,
  nextSiblingOrder,
  readMetadata,
  type StructureCommandReader,
} from './session-structure-plan'

export async function planBackgroundFollowUp(
  reader: StructureCommandReader,
  operation: Extract<SessionMessageStructureOperation, { action: 'background-follow-up' }>
) {
  const plan = emptyStructurePlan(reader)
  const origin = await readMetadata(reader, operation.originMessageId)
  const row = origin?.selected ? (await reader.messages([origin.messageId]))[0] : undefined
  const thread = origin ? await reader.thread(origin.threadId) : null
  if (
    !row ||
    !thread ||
    !row.message.contentParts.some(
      (part) => part.type === 'tool-call' && part.toolCallId === operation.originToolCallId
    )
  ) {
    plan.result.backgroundFollowUpStatus = 'target-missing'
    return plan
  }
  if (row.message.contentParts.some((part) => part.type === 'tool-call' && part.state === 'paused')) {
    plan.result.backgroundFollowUpStatus = 'deferred'
    return plan
  }
  const tail = await readMetadata(reader, thread.activeLeafMessageId)
  if (!tail || tail.threadId !== thread.threadId || tail.activeChildId) throw new Error('Missing follow-up thread tail')
  await assertNewMessages(reader, [operation.userMessage, operation.assistantMessage])
  const message = {
    ...row.message,
    generating: false,
    contentParts: row.message.contentParts.map((part) =>
      part.type === 'tool-call' && part.state === 'call'
        ? {
            ...part,
            state: 'error' as const,
            result: { error: 'Tool execution was interrupted before its result was persisted.' },
            pauseReason: undefined,
            duration: part.startTime ? operation.now - part.startTime : undefined,
          }
        : part
    ),
  }
  const updated = { ...row, message, status: 'settled' as const, facts: deriveMessageFacts(message) }
  plan.diff.messages.upsert.push(updated)
  appendNewChain(
    plan,
    tail.messageId === row.messageId ? updated : tail,
    [operation.userMessage, operation.assistantMessage],
    tail.pendingBranchOrder ?? (await nextSiblingOrder(reader, tail)),
    tail.pendingBranchId ?? null
  )
  plan.result.applied = true
  plan.result.backgroundFollowUpStatus = 'inserted'
  return plan
}
